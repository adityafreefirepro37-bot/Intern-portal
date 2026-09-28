import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ValidationError } from '@/lib/errors'
import { LocalStorageProvider, StorageService } from '@/lib/storage'

const ORG = '6f1d3b52-8a4e-4c1f-9b2d-3e7a5c9d0a11'
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0x25, 0x45, 0x4f, 0x46])

describe('StorageService with the local provider', () => {
  let root: string
  let storage: StorageService

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ayava-storage-'))
    storage = new StorageService(new LocalStorageProvider(root), 1024 * 1024)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('stores files under a generated key, never the user filename', async () => {
    const stored = await storage.upload({
      organizationId: ORG,
      category: 'document',
      fileName: '../../../etc/offer letter.pdf',
      mimeType: 'application/pdf',
      data: PDF,
    })
    expect(stored.storagePath).toMatch(new RegExp(`^${ORG}/document/\\d{4}/[0-9a-f-]{36}\\.pdf$`))
    expect(stored.storagePath).not.toContain('offer')
    expect(stored.fileName).toBe('offer letter.pdf')
    expect(stored.fileSize).toBe(PDF.byteLength)

    const roundTrip = await storage.download(stored.storagePath)
    expect(Buffer.from(roundTrip).equals(Buffer.from(PDF))).toBe(true)

    await storage.delete(stored.storagePath)
    const yearDir = path.join(root, ORG, 'document', String(new Date().getUTCFullYear()))
    expect(await readdir(yearDir)).toHaveLength(0)
  })

  it('rejects invalid files before writing anything', async () => {
    await expect(
      storage.upload({
        organizationId: ORG,
        category: 'document',
        fileName: 'x.pdf',
        mimeType: 'application/pdf',
        data: new Uint8Array([1, 2, 3, 4]),
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(await readdir(root)).toHaveLength(0)
  })

  it('refuses storage paths that are not generated keys', async () => {
    for (const bad of [
      '../secrets.txt',
      `${ORG}/document/2026/../../x.pdf`,
      '/etc/passwd',
      `${ORG}/document/2026/abc.pdf`,
    ]) {
      await expect(storage.download(bad)).rejects.toBeInstanceOf(ValidationError)
    }
  })

  it('does not offer signed URLs for local storage', async () => {
    const stored = await storage.upload({
      organizationId: ORG,
      category: 'document',
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
      data: PDF,
    })
    await expect(storage.getSignedUrl(stored.storagePath)).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' })
  })
})
