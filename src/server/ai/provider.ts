import 'server-only'
import type { z } from 'zod'
import { config } from '@/lib/config'
import { logger } from '@/lib/logging'

/**
 * Provider-agnostic AI interface. The application depends on AIProvider only;
 * which vendor answers is configuration (src/lib/config: AI_PROVIDER, AI_MODEL…).
 *
 * One implementation covers every OpenAI-compatible API (NVIDIA NIM, OpenAI,
 * Groq, OpenRouter, a local Ollama…) with plain fetch — no vendor SDK. The API
 * key is read on the server only and never appears in errors, logs or results.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface GenerateOptions {
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

export interface Usage {
  input: number
  output: number
}

export interface GenerateResult {
  text: string
  provider: string
  model: string
  usage: Usage
}

export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; provider: string; model: string; usage: Usage }

export interface EmbedResult {
  vectors: number[][]
  model: string
  usage: Usage
}

export interface AIProvider {
  readonly name: string
  readonly model: string
  /** null when no embedding model is configured (keyword-only knowledge search). */
  readonly embeddingModel: string | null
  generateText(options: GenerateOptions): Promise<GenerateResult>
  streamText(options: GenerateOptions): AsyncIterable<StreamEvent>
  /** `query` for search questions, `passage` for document chunks (asymmetric models need the hint). */
  embed(texts: string[], purpose: 'query' | 'passage', signal?: AbortSignal): Promise<EmbedResult>
}

/** A provider failure. `message` is safe to log; users only ever see a generic message. */
export class AIProviderError extends Error {
  constructor(
    message: string,
    readonly code: 'TIMEOUT' | 'RATE_LIMITED' | 'UNAUTHORIZED' | 'BAD_REQUEST' | 'UNAVAILABLE' | 'INVALID_OUTPUT' | 'CANCELLED',
    readonly retriable: boolean,
  ) {
    super(message)
    this.name = 'AIProviderError'
  }
}

/** Rough token estimate for providers that don't report usage (≈ 4 characters per token). */
export function estimateTokens(text: string) {
  return Math.ceil(text.length / 4)
}

function errorForStatus(status: number): AIProviderError {
  if (status === 401 || status === 403) return new AIProviderError(`AI provider rejected the credentials (${status})`, 'UNAUTHORIZED', false)
  if (status === 429) return new AIProviderError('AI provider rate limit reached (429)', 'RATE_LIMITED', true)
  if (status >= 500) return new AIProviderError(`AI provider unavailable (${status})`, 'UNAVAILABLE', true)
  return new AIProviderError(`AI provider rejected the request (${status})`, 'BAD_REQUEST', false)
}

interface CompatibleOptions {
  name: string
  baseUrl: string
  apiKey?: string
  model: string
  fallbackModel?: string
  embeddingModel?: string
  temperature: number
  maxTokens: number
  timeoutMs: number
  /** NVIDIA's asymmetric embedding models need input_type; others reject unknown fields. */
  nvidia: boolean
  fetchImpl?: typeof fetch
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly name: string
  readonly model: string
  readonly embeddingModel: string | null

  constructor(private readonly options: CompatibleOptions) {
    this.name = options.name
    this.model = options.model
    this.embeddingModel = options.embeddingModel ?? null
  }

  private get fetch() {
    return this.options.fetchImpl ?? fetch
  }

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    let response: Response
    try {
      response = await this.fetch(`${this.options.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: combined,
      })
    } catch (error) {
      if (signal?.aborted) throw new AIProviderError('Request cancelled', 'CANCELLED', false)
      if (timeout.aborted) throw new AIProviderError('AI provider timed out', 'TIMEOUT', true)
      throw new AIProviderError(`AI provider unreachable: ${(error as Error).name}`, 'UNAVAILABLE', true)
    }
    if (!response.ok) {
      // The body may echo the request; log only its first characters, never headers.
      const detail = (await response.text().catch(() => '')).slice(0, 200)
      logger.warn('AI provider error response', { provider: this.name, path, status: response.status, detail })
      throw errorForStatus(response.status)
    }
    return response
  }

  private chatBody(options: GenerateOptions, model: string, stream: boolean) {
    return {
      model,
      messages: options.messages,
      temperature: options.temperature ?? this.options.temperature,
      max_tokens: options.maxTokens ?? this.options.maxTokens,
      stream,
    }
  }

  /** Primary model, then the configured fallback model (same provider) on retriable failures. */
  private models() {
    return this.options.fallbackModel && this.options.fallbackModel !== this.model
      ? [this.model, this.options.fallbackModel]
      : [this.model]
  }

  async generateText(options: GenerateOptions): Promise<GenerateResult> {
    let lastError: unknown
    for (const model of this.models()) {
      try {
        const response = await this.post('/chat/completions', this.chatBody(options, model, false), options.signal)
        const json = (await response.json()) as {
          model?: string
          choices?: { message?: { content?: string | null } }[]
          usage?: { prompt_tokens?: number; completion_tokens?: number }
        }
        const text = json.choices?.[0]?.message?.content ?? ''
        const promptText = options.messages.map((m) => m.content).join('\n')
        return {
          text,
          provider: this.name,
          model: json.model ?? model,
          usage: {
            input: json.usage?.prompt_tokens ?? estimateTokens(promptText),
            output: json.usage?.completion_tokens ?? estimateTokens(text),
          },
        }
      } catch (error) {
        lastError = error
        if (!(error instanceof AIProviderError) || !error.retriable) throw error
        logger.warn('AI model failed; trying fallback if configured', { provider: this.name, model, code: error.code })
      }
    }
    throw lastError
  }

  async *streamText(options: GenerateOptions): AsyncIterable<StreamEvent> {
    const models = this.models()
    let response: Response | null = null
    let model = models[0]
    for (const candidate of models) {
      try {
        response = await this.post('/chat/completions', this.chatBody(options, candidate, true), options.signal)
        model = candidate
        break
      } catch (error) {
        // Fall back only before any text has been streamed.
        if (!(error instanceof AIProviderError) || !error.retriable || candidate === models.at(-1)) throw error
        logger.warn('AI model failed; trying fallback', { provider: this.name, model: candidate, code: error.code })
      }
    }
    if (!response?.body) throw new AIProviderError('AI provider returned no stream', 'UNAVAILABLE', true)

    let text = ''
    let reportedModel = model
    let usage: Usage | null = null
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const raw of lines) {
          const line = raw.trim()
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') continue
          let chunk: {
            model?: string
            choices?: { delta?: { content?: string | null } }[]
            usage?: { prompt_tokens?: number; completion_tokens?: number } | null
          }
          try {
            chunk = JSON.parse(data)
          } catch {
            continue
          }
          if (chunk.model) reportedModel = chunk.model
          if (chunk.usage?.prompt_tokens !== undefined) {
            usage = { input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens ?? 0 }
          }
          const delta = chunk.choices?.[0]?.delta?.content
          if (delta) {
            text += delta
            yield { type: 'delta', text: delta }
          }
        }
      }
    } catch (error) {
      if (options.signal?.aborted) throw new AIProviderError('Request cancelled', 'CANCELLED', false)
      throw error instanceof AIProviderError ? error : new AIProviderError('AI stream interrupted', 'UNAVAILABLE', false)
    } finally {
      reader.releaseLock()
    }
    yield {
      type: 'done',
      provider: this.name,
      model: reportedModel,
      usage: usage ?? {
        input: estimateTokens(options.messages.map((m) => m.content).join('\n')),
        output: estimateTokens(text),
      },
    }
  }

  async embed(texts: string[], purpose: 'query' | 'passage', signal?: AbortSignal): Promise<EmbedResult> {
    if (!this.embeddingModel) throw new AIProviderError('No embedding model configured', 'BAD_REQUEST', false)
    if (texts.length === 0) return { vectors: [], model: this.embeddingModel, usage: { input: 0, output: 0 } }
    const response = await this.post(
      '/embeddings',
      {
        model: this.embeddingModel,
        input: texts,
        encoding_format: 'float',
        ...(this.options.nvidia ? { input_type: purpose, truncate: 'END' } : {}),
      },
      signal,
    )
    const json = (await response.json()) as {
      data?: { index?: number; embedding?: number[] }[]
      usage?: { prompt_tokens?: number; total_tokens?: number }
    }
    const rows = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    if (rows.length !== texts.length || rows.some((r) => !Array.isArray(r.embedding))) {
      throw new AIProviderError('AI provider returned malformed embeddings', 'INVALID_OUTPUT', false)
    }
    return {
      vectors: rows.map((r) => r.embedding!),
      model: this.embeddingModel,
      usage: { input: json.usage?.prompt_tokens ?? json.usage?.total_tokens ?? estimateTokens(texts.join(' ')), output: 0 },
    }
  }
}

/**
 * Structured output: asks for JSON, extracts the first JSON object, and
 * validates it against `schema`. One retry with the validation error. The
 * result is still untrusted input — callers re-validate before acting on it.
 */
export async function generateStructured<S extends z.ZodType>(
  provider: AIProvider,
  schema: S,
  options: GenerateOptions,
): Promise<{ data: z.infer<S>; result: GenerateResult }> {
  let messages = options.messages
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await provider.generateText({ ...options, messages, temperature: 0 })
    const parsed = parseJsonObject(result.text)
    const checked = parsed === undefined ? null : schema.safeParse(parsed)
    if (checked?.success) return { data: checked.data, result }
    messages = [
      ...options.messages,
      { role: 'assistant', content: result.text.slice(0, 2000) },
      {
        role: 'user',
        content: 'That was not valid. Reply with only one JSON object that matches the requested shape, and nothing else.',
      },
    ]
  }
  throw new AIProviderError('AI returned output that does not match the expected shape', 'INVALID_OUTPUT', false)
}

/** The first top-level JSON object in a model reply (code fences and prose around it are ignored). */
export function parseJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  if (start < 0) return undefined
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth++
    else if (char === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1))
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

let override: AIProvider | null | undefined
let cached: AIProvider | null | undefined

/** The configured provider, or null when AI is not configured. */
export function getAIProvider(): AIProvider | null {
  if (override !== undefined) return override
  if (cached !== undefined) return cached
  const ai = config.ai
  cached =
    ai.configured && ai.provider && ai.baseUrl && ai.model
      ? new OpenAICompatibleProvider({
          name: ai.provider,
          baseUrl: ai.baseUrl,
          apiKey: ai.apiKey,
          model: ai.model,
          fallbackModel: ai.fallbackModel,
          embeddingModel: ai.embeddingModel,
          temperature: ai.temperature,
          maxTokens: ai.maxTokens,
          timeoutMs: ai.timeoutMs,
          nvidia: ai.provider === 'nvidia',
        })
      : null
  return cached
}

/** Tests only: install a provider (or null for "not configured"); undefined restores config. */
export function setAIProviderForTesting(provider: AIProvider | null | undefined) {
  override = provider
}
