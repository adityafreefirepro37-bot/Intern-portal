import 'server-only'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { config } from '@/lib/config'
import { AppError, ValidationError } from '@/lib/errors'
import { sanitizeDisplayName, validateUpload, type UploadCategory } from './validation'

export { validateUpload, sanitizeDisplayName } from './validation'
export type { UploadCategory, UploadCandidate, UploadValidationResult } from './validation'

/**
 * Storage abstraction. Business logic depends on `StorageService`, never on a
 * provider SDK. Providers only move bytes; validation and key generation live
 * here so every provider gets the same protections.
 */
export interface StorageProvider {
  readonly name: string
  put(key: string, data: Uint8Array, contentType: string): Promise<void>
  get(key: string): Promise<Uint8Array>
  remove(key: string): Promise<void>
  signedUrl(key: string, expiresInSeconds: number): Promise<string>
}

export interface UploadInput {
  organizationId: string
  category: UploadCategory
  fileName: string
  mimeType: string
  data: Uint8Array
}

export interface StoredFile {
  storagePath: string
  fileName: string
  mimeType: string
  fileSize: number
}

const KEY_PATTERN = /^[0-9a-f-]{36}\/(document|image|attachment)\/\d{4}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/

export class StorageService {
  constructor(
    private readonly provider: StorageProvider,
    private readonly maxBytes: number,
  ) {}

  validate(input: Pick<UploadInput, 'category' | 'fileName' | 'mimeType' | 'data'>) {
    return validateUpload(
      {
        fileName: input.fileName,
        mimeType: input.mimeType,
        size: input.data.byteLength,
        head: input.data.subarray(0, 16),
      },
      { category: input.category, maxBytes: this.maxBytes },
    )
  }

  async upload(input: UploadInput): Promise<StoredFile> {
    const result = this.validate(input)
    if (!result.valid || !result.extension) {
      throw new ValidationError('File rejected', { file: result.errors.join('. ') })
    }
    // Server-generated key: tenant / category / year / random id. The user's
    // filename never becomes part of the path.
    const key = `${input.organizationId}/${input.category}/${new Date().getUTCFullYear()}/${randomUUID()}${result.extension}`
    const mimeType = input.mimeType.toLowerCase().split(';')[0].trim()
    await this.provider.put(key, input.data, mimeType)
    return {
      storagePath: key,
      fileName: sanitizeDisplayName(input.fileName),
      mimeType,
      fileSize: input.data.byteLength,
    }
  }

  async download(storagePath: string): Promise<Uint8Array> {
    return this.provider.get(assertKey(storagePath))
  }

  async delete(storagePath: string): Promise<void> {
    await this.provider.remove(assertKey(storagePath))
  }

  async getSignedUrl(storagePath: string, expiresInSeconds = 300): Promise<string> {
    return this.provider.signedUrl(assertKey(storagePath), Math.min(Math.max(expiresInSeconds, 30), 3600))
  }
}

function assertKey(key: string): string {
  if (!KEY_PATTERN.test(key)) throw new ValidationError('Invalid storage path')
  return key
}

/** Local filesystem provider for development. */
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local'
  private readonly root: string

  constructor(root: string) {
    this.root = path.resolve(root)
  }

  private resolve(key: string): string {
    const target = path.resolve(this.root, key)
    if (!target.startsWith(this.root + path.sep)) throw new ValidationError('Invalid storage path')
    return target
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const target = this.resolve(key)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, data, { flag: 'wx' })
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.resolve(key)))
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true })
  }

  async signedUrl(): Promise<string> {
    // Local files are streamed through an authorized route handler, which the
    // documents feature adds in Prompt 05. There is no public URL to sign.
    throw new AppError('NOT_IMPLEMENTED', 'Signed URLs are not available for local storage')
  }
}

/** Supabase Storage provider (private bucket, server-side service role). */
export class SupabaseStorageProvider implements StorageProvider {
  readonly name = 'supabase'
  private readonly client

  constructor(
    url: string,
    serviceRoleKey: string,
    private readonly bucket = 'private',
  ) {
    this.client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).upload(key, data, { contentType, upsert: false })
    if (error) throw new AppError('INTERNAL_ERROR', 'Upload failed', { cause: error })
  }

  async get(key: string): Promise<Uint8Array> {
    const { data, error } = await this.client.storage.from(this.bucket).download(key)
    if (error || !data) throw new AppError('INTERNAL_ERROR', 'Download failed', { cause: error })
    return new Uint8Array(await data.arrayBuffer())
  }

  async remove(key: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).remove([key])
    if (error) throw new AppError('INTERNAL_ERROR', 'Delete failed', { cause: error })
  }

  async signedUrl(key: string, expiresInSeconds: number): Promise<string> {
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUrl(key, expiresInSeconds)
    if (error || !data) throw new AppError('INTERNAL_ERROR', 'Could not create download link', { cause: error })
    return data.signedUrl
  }
}

let instance: StorageService | undefined

export function getStorageService(): StorageService {
  if (instance) return instance
  const { storage, supabase } = config
  let provider: StorageProvider
  if (storage.provider === 'supabase') {
    if (!supabase.url || !supabase.serviceRoleKey) {
      throw new AppError('INTERNAL_ERROR', 'Supabase storage is selected but not configured')
    }
    provider = new SupabaseStorageProvider(supabase.url, supabase.serviceRoleKey)
  } else {
    provider = new LocalStorageProvider(storage.localPath)
  }
  instance = new StorageService(provider, storage.maxUploadBytes)
  return instance
}
