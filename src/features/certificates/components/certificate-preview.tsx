/* eslint-disable @next/next/no-img-element -- static brand images, sized by the layout */
import { certificateWording, formatCertificateDate, ribbonText, type CertificateText } from '@/lib/certificates/content'
import { cn } from '@/lib/utils'

/**
 * On-page rendering of a certificate in the Ayava Creatives design, laid out
 * like the PDF (which stays the official document). Colours here are the
 * certificate's own brand palette, not UI theme tokens: a certificate looks the
 * same in light and dark mode.
 */
const GRADIENT = 'linear-gradient(90deg, #01cd84 0%, #00b4f0 50%, #0189f9 100%)'

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
  const fs = (min: string, vw: string, max: string) => `clamp(${min}, ${vw}, ${max})`
  return (
    <figure
      className={cn('relative overflow-hidden border-2 border-[#1c1b1b] bg-[#fdfcf8] p-[0.6%] text-[#1c1b1b] shadow-sm', className)}
      aria-label={`${wording.heading} for ${text.recipientName}`}
    >
      {/* Gradient band */}
      <div className="p-[0.7%]" style={{ background: GRADIENT }}>
        <div className="relative flex aspect-[1.414] flex-col items-center overflow-hidden bg-[#fdfcf8] px-[7%] py-[3%] text-center font-serif">
          <div className="pointer-events-none absolute inset-[2%] border border-[#c29945]" aria-hidden />
          <img
            src="/brand/ayava-mark-light-bg.png"
            alt=""
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-[52%] w-[36%] -translate-x-1/2 -translate-y-1/2 opacity-[0.045]"
          />
          <img src="/brand/ayava-logo-light-bg.png" alt={text.organizationName} className="relative h-[17%] w-auto" />
          <p className="relative mt-[2%] font-bold tracking-[0.18em]" style={{ fontSize: fs('1rem', '3.2vw', '2.4rem') }}>
            CERTIFICATE
          </p>
          <p
            className="relative mt-[1%] px-[6%] py-[0.6%] font-sans font-bold uppercase tracking-[0.22em] text-white"
            style={{ background: GRADIENT, fontSize: fs('0.45rem', '0.95vw', '0.75rem') }}
          >
            {ribbonText(text)}
          </p>
          <p className="relative mt-[2.5%] italic text-[#5b5b61]" style={{ fontSize: fs('0.6rem', '1.3vw', '0.95rem') }}>
            {wording.lead}
          </p>
          <p className="relative mt-[1%] font-bold italic" style={{ fontSize: fs('1rem', '3.2vw', '2.3rem') }}>
            {text.recipientName || 'Recipient name'}
          </p>
          <span className="relative mt-[0.5%] h-[2px] w-[45%]" style={{ background: GRADIENT }} aria-hidden />
          <p className="relative mt-[2.2%] max-w-[82%] leading-snug" style={{ fontSize: fs('0.6rem', '1.3vw', '0.95rem') }}>
            {wording.body}
          </p>
          {text.citation && (
            <p className="relative mt-[1%] max-w-[76%] italic text-[#5b5b61]" style={{ fontSize: fs('0.55rem', '1.15vw', '0.85rem') }}>
              “{text.citation}”
            </p>
          )}
          <div className="relative mt-auto grid w-full grid-cols-3 items-end gap-2 font-sans text-left">
            <div>
              <span className="block h-px w-[85%] bg-[#1c1b1b]" aria-hidden />
              <p className="mt-1 font-bold" style={{ fontSize: fs('0.5rem', '1vw', '0.75rem') }}>
                {signatoryName ?? 'Authorised signatory'}
              </p>
              <p className="text-[#5b5b61]" style={{ fontSize: fs('0.45rem', '0.85vw', '0.65rem') }}>
                {signatoryTitle ?? text.organizationName}
              </p>
            </div>
            <div className="flex flex-col items-center">
              <span className="grid aspect-square w-[42%] min-w-9 place-items-center rounded-full p-[4%]" style={{ background: GRADIENT }} aria-hidden>
                <span className="grid size-full place-items-center rounded-full bg-[#1c1b1b]">
                  <img src="/brand/ayava-mark-dark-bg.png" alt="" className="w-[55%]" />
                </span>
              </span>
              <p className="mt-1 text-[#5b5b61]" style={{ fontSize: fs('0.45rem', '0.85vw', '0.65rem') }}>
                {issuedAt ? `Issued ${formatCertificateDate(issuedAt)}` : 'Not yet issued'}
              </p>
            </div>
            <div className="flex flex-col items-end">
              <span
                className="grid aspect-square w-[32%] min-w-8 place-items-center border border-[#c29945] bg-white text-[#5b5b61]"
                style={{ fontSize: fs('0.35rem', '0.7vw', '0.55rem') }}
                aria-hidden
              >
                QR
              </span>
              <p className="mt-1 font-bold" style={{ fontSize: fs('0.45rem', '0.85vw', '0.65rem') }}>
                No. {number}
              </p>
            </div>
          </div>
          {watermark && (
            <span
              className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-[22deg] font-sans font-black text-[#d33]/15"
              style={{ fontSize: fs('2rem', '10vw', '6rem') }}
              aria-hidden
            >
              {watermark}
            </span>
          )}
        </div>
      </div>
      {watermark && <figcaption className="sr-only">{watermark}</figcaption>}
    </figure>
  )
}
