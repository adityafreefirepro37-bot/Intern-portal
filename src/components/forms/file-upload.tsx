'use client'

import * as React from 'react'
import { FileUp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CATEGORY_MIME_TYPES, FILE_TYPES, validateUpload, type UploadCategory } from '@/lib/storage/validation'

/**
 * File picker with drag-and-drop and immediate feedback using the same rules
 * as the server. This is a convenience only — the server re-validates every
 * upload (type, extension, file signature, size) before storing it.
 */
export function FileUpload({
  category,
  maxBytes,
  onFileChange,
  disabled,
  name,
  id,
  'aria-describedby': describedBy,
}: {
  category: UploadCategory
  maxBytes: number
  onFileChange?: (file: File | null) => void
  disabled?: boolean
  name?: string
  id?: string
  'aria-describedby'?: string
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [file, setFile] = React.useState<File | null>(null)
  const [errors, setErrors] = React.useState<string[]>([])
  const [dragging, setDragging] = React.useState(false)
  const errorId = React.useId()

  const accept = CATEGORY_MIME_TYPES[category]
    .flatMap((mime) => [mime, ...(FILE_TYPES[mime]?.extensions ?? [])])
    .join(',')

  async function select(candidate: File | null) {
    if (!candidate) {
      setFile(null)
      setErrors([])
      onFileChange?.(null)
      return
    }
    const head = new Uint8Array(await candidate.slice(0, 16).arrayBuffer())
    const result = validateUpload(
      { fileName: candidate.name, mimeType: candidate.type, size: candidate.size, head },
      { category, maxBytes },
    )
    setErrors(result.errors)
    setFile(result.valid ? candidate : null)
    onFileChange?.(result.valid ? candidate : null)
    if (!result.valid && inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="grid gap-2">
      <div
        onDragOver={(event) => {
          event.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          if (!disabled) void select(event.dataTransfer.files[0] ?? null)
        }}
        className={cn(
          'flex flex-col items-center gap-2 rounded-lg border border-dashed border-input bg-muted/40 px-4 py-6 text-center transition-colors',
          dragging && 'border-ring bg-accent',
          disabled && 'opacity-60',
        )}
      >
        <FileUp className="size-5 text-muted-foreground" aria-hidden />
        <p className="text-small text-muted-foreground">
          Drag a file here, or{' '}
          <Button variant="link" className="h-auto p-0" disabled={disabled} onClick={() => inputRef.current?.click()}>
            browse
          </Button>
        </p>
        <p className="text-caption text-muted-foreground">
          {CATEGORY_MIME_TYPES[category]
            .flatMap((mime) => FILE_TYPES[mime]?.extensions ?? [])
            .join(', ')
            .toUpperCase()}{' '}
          · up to {Math.round(maxBytes / (1024 * 1024))} MB
        </p>
        <input
          ref={inputRef}
          id={id}
          name={name}
          type="file"
          accept={accept}
          disabled={disabled}
          className="sr-only"
          aria-describedby={[describedBy, errors.length ? errorId : undefined].filter(Boolean).join(' ') || undefined}
          aria-invalid={errors.length > 0 || undefined}
          onChange={(event) => void select(event.target.files?.[0] ?? null)}
        />
      </div>
      {file && (
        <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-small">
          <span className="truncate">{file.name}</span>
          <Button variant="ghost" size="icon-sm" onClick={() => void select(null)} aria-label={`Remove ${file.name}`}>
            <X aria-hidden />
          </Button>
        </div>
      )}
      {errors.length > 0 && (
        <p id={errorId} role="alert" className="text-caption font-medium text-destructive">
          {errors.join('. ')}
        </p>
      )}
    </div>
  )
}
