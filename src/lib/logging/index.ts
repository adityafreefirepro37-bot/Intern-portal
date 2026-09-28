/**
 * Structured application logger.
 *
 * Emits one JSON object per line (easy to ship to any log platform) and
 * redacts sensitive keys recursively before anything is written. Never pass
 * raw request bodies, documents, or credentials as context.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

const SENSITIVE_KEY_PATTERN =
  /pass(word)?|secret|token|api[-_]?key|authorization|cookie|session|credential|private[-_]?key|service[-_]?role|signature|otp|ssn|date_of_birth|dob/i

export const REDACTED = '[REDACTED]'

export type LogContext = Record<string, unknown>

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[MAX_DEPTH]'
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack }
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1))
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(inner, depth + 1)
    }
    return output
  }
  return value
}

export interface LogSink {
  write(level: LogLevel, line: string): void
}

const consoleSink: LogSink = {
  write(level, line) {
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
  },
}

export class Logger {
  constructor(
    private readonly minLevel: LogLevel = resolveLevel(),
    private readonly sink: LogSink = consoleSink,
    private readonly bindings: LogContext = {},
  ) {}

  child(bindings: LogContext): Logger {
    return new Logger(this.minLevel, this.sink, { ...this.bindings, ...bindings })
  }

  debug(message: string, context?: LogContext) {
    this.emit('debug', message, context)
  }

  info(message: string, context?: LogContext) {
    this.emit('info', message, context)
  }

  warn(message: string, context?: LogContext) {
    this.emit('warn', message, context)
  }

  error(message: string, context?: LogContext) {
    this.emit('error', message, context)
  }

  private emit(level: LogLevel, message: string, context?: LogContext) {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return
    const entry = {
      time: new Date().toISOString(),
      level,
      message,
      ...(redact({ ...this.bindings, ...context }) as LogContext),
    }
    let line: string
    try {
      line = JSON.stringify(entry)
    } catch {
      line = JSON.stringify({ time: entry.time, level, message, note: 'context not serializable' })
    }
    this.sink.write(level, line)
  }
}

function resolveLevel(): LogLevel {
  const level = process.env.LOG_LEVEL
  if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') return level
  return process.env.NODE_ENV === 'development' ? 'debug' : 'info'
}

export const logger = new Logger()
