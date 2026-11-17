import { jsonError } from '@/lib/http/response'
import { privateImageResponse } from '@/lib/http/image-response'
import { requireApiContext } from '@/server/context'
import { certificateService } from '@/server/services/certificate.service'

export const dynamic = 'force-dynamic'

/** GET /api/certificates/signature — the default signatory's signature (certificate creators only). */
export async function GET() {
  try {
    return privateImageResponse(await certificateService.defaultSignature(await requireApiContext()))
  } catch (error) {
    return jsonError(error, { route: 'certificates.signature' })
  }
}
