import { certificateWording, formatCertificateDate, type CertificateText } from '@/lib/certificates/content'
import { cn } from '@/lib/utils'

/**
 * On-page rendering of a certificate, laid out like the PDF (which stays the
 * official document). Text only, so it reads well on phones and to screen readers.
 */
export function CertificatePreview({
  text,
  number,
  issuedAt,
  signatoryName,
  signatoryTitle,
  watermark,
  className,
}: {
  text: CertificateText
  number: string
  issuedAt: Date | null
  signatoryName: string | null
  signatoryTitle: string | null
  watermark?: string | null
  className?: string
}) {
  const wording = certificateWording(text)
  const mark =
    text.organizationName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || 'A'
  return (
    <figure
      className={cn(
        'relative overflow-hidden rounded-md border-[3px] border-[#4a389f] bg-[#fdfcf9] p-1.5 text-[#211f33] shadow-sm',
        className,
      )}
      aria-label={`${wording.heading} for ${text.recipientName}`}
    >
      <div className="relative flex aspect-[1.414] flex-col items-center border border-[#b88f3d] px-[6%] py-[4%] text-center font-serif">
        <span
          className="flex size-[7%] min-h-6 min-w-6 items-center justify-center rounded-full bg-[#4a389f] text-[clamp(0.55rem,1.4vw,0.95rem)] font-bold text-white"
          aria-hidden
        >
          {mark}
        </span>
        <p className="mt-[1.5%] font-sans text-[clamp(0.5rem,1.1vw,0.75rem)] font-bold uppercase tracking-[0.25em] text-[#4a389f]">
          {text.organizationName}
        </p>
        <p className="mt-[2.5%] text-[clamp(0.9rem,3vw,2rem)] font-bold uppercase tracking-wide">{wording.heading}</p>
        <span className="mt-[1%] h-px w-[16%] bg-[#b88f3d]" aria-hidden />
        <p className="mt-[2.5%] text-[clamp(0.6rem,1.4vw,0.95rem)] text-[#66667a]">{wording.lead}</p>
        <p className="mt-[1.5%] w-[60%] border-b border-[#66667a]/60 pb-[0.5%] text-[clamp(1rem,3.4vw,2.25rem)] font-bold italic text-[#4a389f]">
          {text.recipientName || 'Recipient name'}
        </p>
        <p className="mt-[2.5%] max-w-[85%] text-[clamp(0.6rem,1.4vw,0.95rem)] leading-snug">{wording.body}</p>
        {text.citation && (
          <p className="mt-[1.5%] max-w-[78%] text-[clamp(0.55rem,1.2vw,0.85rem)] font-bold italic text-[#66667a]">
            “{text.citation}”
          </p>
        )}
        <div className="mt-auto grid w-full grid-cols-3 items-end gap-2 font-sans text-left">
          <div>
            <span className="block h-px w-[85%] bg-[#211f33]" aria-hidden />
            <p className="mt-1 text-[clamp(0.5rem,1vw,0.75rem)] font-bold">{signatoryName ?? 'Authorised signatory'}</p>
            <p className="text-[clamp(0.45rem,0.9vw,0.65rem)] text-[#66667a]">{signatoryTitle ?? text.organizationName}</p>
          </div>
          <div className="flex flex-col items-center">
            <span
              className="flex aspect-square w-[34%] min-w-8 items-center justify-center rounded-full border-2 border-[#b88f3d] text-[clamp(0.35rem,0.7vw,0.55rem)] font-bold tracking-wider text-[#b88f3d]"
              aria-hidden
            >
              VERIFIED
            </span>
            <p className="mt-1 text-[clamp(0.45rem,0.9vw,0.65rem)] text-[#66667a]">
              {issuedAt ? `Issued ${formatCertificateDate(issuedAt)}` : 'Not yet issued'}
            </p>
          </div>
          <div className="flex flex-col items-end">
            <span
              className="grid aspect-square w-[34%] min-w-8 place-items-center border border-[#66667a]/50 bg-white text-[clamp(0.35rem,0.7vw,0.55rem)] text-[#66667a]"
              aria-hidden
            >
              QR
            </span>
            <p className="mt-1 text-[clamp(0.45rem,0.9vw,0.65rem)] text-[#66667a]">No. {number}</p>
          </div>
        </div>
        {watermark && (
          <span
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-[22deg] font-sans text-[clamp(2rem,10vw,6rem)] font-black text-[#d33]/15"
            aria-hidden
          >
            {watermark}
          </span>
        )}
      </div>
      {watermark && <figcaption className="sr-only">{watermark}</figcaption>}
    </figure>
  )
}
