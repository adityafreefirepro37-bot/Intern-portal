import { jsonError } from '@/lib/http/response'
import { privateImageResponse } from '@/lib/http/image-response'
import { requireApiContext } from '@/server/context'
import { certificateService } from '@/server/services/certificate.service'

export const dynamic = 'force-dynamic'

/** GET /api/certificates/:id/signature — the signature on this certificate (same access as the certificate). */
export async function GET(_request: Request, { params }: RouteContext<'/api/certificates/[id]/signature'>) {
  try {
    const { id } = await params
    return privateImageResponse(await certificateService.certificateSignature(await requireApiContext(), id))
  } catch (error) {
    return jsonError(error, { route: 'certificates.certificate_signature' })
  }
}
