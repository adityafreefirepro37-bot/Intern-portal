import { Paperclip } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { Card } from '@/components/ui/card'
import { SUBMISSION_STATUS_LABELS } from '@/lib/work/submissions'
import { formatDay, fullName } from '@/lib/utils'
import type { SubmissionDetail } from '@/server/services/learning-assignment.service'

type Version = SubmissionDetail['submission']['versions'][number]

function size(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Immutable submission versions with their files and review decisions (newest first). */
export function SubmissionHistory({ versions, maxPoints }: { versions: Version[]; maxPoints: number | null }) {
  if (!versions.length) return null
  return (
    <ol className="grid gap-3" aria-label="Submission history">
      {versions.map((v) => (
        <li key={v.id}>
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2 text-small">
              <span className="font-medium">Version {v.version_number}</span>
              <StatusBadge status={v.status} label={SUBMISSION_STATUS_LABELS[v.status]} />
              <span className="text-caption text-muted-foreground">
                {v.submitter ? `${fullName(v.submitter)} · ` : ''}
                {formatDay(v.submitted_at)}
              </span>
            </div>
            {v.message && <p className="whitespace-pre-line text-small">{v.message}</p>}
            {v.files.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {v.files.map((f) => (
                  <li key={f.id}>
                    <a
                      href={`/api/learning/files/${f.id}`}
                      className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-caption hover:bg-muted"
                    >
                      <Paperclip className="size-3.5" aria-hidden /> {f.file_name}
                      <span className="text-muted-foreground">({size(f.file_size)})</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {v.reviewed_at && (
              <div className="rounded-md bg-muted/60 p-3 text-small">
                <p className="font-medium">
                  {v.status === 'APPROVED' ? 'Approved' : 'Changes requested'}
                  {v.reviewer ? ` by ${fullName(v.reviewer)}` : ''} · {formatDay(v.reviewed_at)}
                  {v.points_awarded !== null && maxPoints !== null ? ` · ${v.points_awarded}/${maxPoints} points` : ''}
                </p>
                {v.review_comment && <p className="mt-1 whitespace-pre-line text-muted-foreground">{v.review_comment}</p>}
              </div>
            )}
          </Card>
        </li>
      ))}
    </ol>
  )
}
