'use client'

/* eslint-disable @next/next/no-img-element -- previews of local / private images */
import * as React from 'react'
import { Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormMessage, SubmitButton } from '@/features/auth/components/form-bits'
import { ActionButton } from '@/features/hr/components/action-form'
import { useFormAction } from '@/features/interns/components/use-form-action'
import { removeCertificateSignatureAction, uploadCertificateSignatureAction } from '@/server/actions/certificates'

const MAX_WIDTH = 1200

/**
 * Turns a photo or scan of a signature on paper into a transparent PNG: the
 * paper becomes transparent (soft edges kept), the result is cropped to the ink.
 */
async function cleanSignature(file: File): Promise<{ blob: Blob; url: string }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_WIDTH / bitmap.width)
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, w, h)
  const image = ctx.getImageData(0, 0, w, h)
  const d = image.data
  // Paper brightness: the brighter end of the image (90th percentile of luminance).
  const lums: number[] = []
  for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 10) lums.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
  lums.sort((a, b) => a - b)
  const paper = lums.length ? lums[Math.floor(lums.length * 0.9)] : 255
  const ink = Math.max(0, paper - 110)
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (d[i + 3] < 10) {
        d[i + 3] = 0
        continue
      }
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      const alpha = Math.max(0, Math.min(1, (paper - 18 - lum) / (paper - 18 - ink)))
      d[i + 3] = Math.round(alpha * d[i + 3])
      if (d[i + 3] > 40) {
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
    }
  }
  if (maxX < 0) throw new Error('No signature found in the image. Use a dark pen on white paper.')
  ctx.putImageData(image, 0, 0)
  const pad = 8
  const cx = Math.max(0, minX - pad)
  const cy = Math.max(0, minY - pad)
  const cw = Math.min(w, maxX + pad) - cx
  const ch = Math.min(h, maxY + pad) - cy
  const out = document.createElement('canvas')
  out.width = cw
  out.height = ch
  out.getContext('2d')!.drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch)
  const blob = await new Promise<Blob>((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not prepare the image'))), 'image/png'))
  return { blob, url: URL.createObjectURL(blob) }
}

export function SignatureUpload({ hasSignature, signatoryName }: { hasSignature: boolean; signatoryName: string | null }) {
  const [preview, setPreview] = React.useState<string | null>(null)
  const [problem, setProblem] = React.useState<string | null>(null)
  // Bumped after each save so the current-signature image reloads.
  const [version, setVersion] = React.useState(0)
  const [state, action] = useFormAction(uploadCertificateSignatureAction, {
    onSuccess: () => {
      setPreview(null)
      setVersion((v) => v + 1)
    },
  })
  const hidden = React.useRef<HTMLInputElement>(null)
  const id = React.useId()

  async function onChoose(event: React.ChangeEvent<HTMLInputElement>) {
    setProblem(null)
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const { blob, url } = await cleanSignature(file)
      const transfer = new DataTransfer()
      transfer.items.add(new File([blob], 'signature.png', { type: 'image/png' }))
      if (hidden.current) hidden.current.files = transfer.files
      setPreview(url)
    } catch (error) {
      setPreview(null)
      setProblem(error instanceof Error ? error.message : 'That image could not be read.')
    }
  }

  return (
    <div className="grid gap-3 rounded-lg border p-3">
      <div>
        <p className="text-small font-medium">Signature</p>
        <p className="text-caption text-muted-foreground">
          {signatoryName
            ? `Printed above ${signatoryName}’s name. Sign with a dark pen on plain white paper, then upload a photo or scan — the background is removed automatically.`
            : 'Save the default signatory’s name first, then upload their signature.'}
        </p>
      </div>
      {hasSignature && !preview && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-md border bg-[#fdfcf8] p-2">
            <img src={`/api/certificates/signature?v=${version}`} alt={`Current signature of ${signatoryName ?? 'the signatory'}`} className="h-14 w-auto" />
          </span>
          <ActionButton action={removeCertificateSignatureAction} fields={{}} variant="ghost" size="sm" className="text-destructive">
            <Trash2 aria-hidden /> Remove
          </ActionButton>
        </div>
      )}
      {signatoryName && (
        <form action={action} className="grid gap-3">
          <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.fields?.signature ?? (state.status === 'error' ? state.message : undefined)} />
          <label htmlFor={`${id}-file`} className="text-caption text-muted-foreground">
            {hasSignature ? 'Replace with a new image' : 'Choose an image'} (PNG, JPEG or WebP)
          </label>
          <Input id={`${id}-file`} type="file" accept="image/png,image/jpeg,image/webp" onChange={onChoose} />
          <input ref={hidden} type="file" name="signature" className="hidden" aria-hidden tabIndex={-1} />
          {problem && (
            <p role="alert" className="text-caption font-medium text-destructive">
              {problem}
            </p>
          )}
          {preview && (
            <div className="grid gap-2">
              <p className="text-caption text-muted-foreground">Preview on the certificate paper:</p>
              <span className="inline-block w-fit rounded-md border bg-[#fdfcf8] p-3">
                <img src={preview} alt="Signature preview" className="h-16 w-auto" />
              </span>
              <div className="flex gap-2">
                <SubmitButton size="sm" pendingLabel="Saving…">
                  <Upload aria-hidden /> Save signature
                </SubmitButton>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPreview(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </form>
      )}
    </div>
  )
}
