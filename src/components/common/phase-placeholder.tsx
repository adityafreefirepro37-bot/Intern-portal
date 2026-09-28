import type { LucideIcon } from 'lucide-react'
import { CheckCircle2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { PhaseBadge } from './badges'

/**
 * Intentional placeholder for a feature scheduled in a later phase. States
 * plainly that the feature is not available yet and what it will include —
 * it never simulates working functionality.
 */
export function PhasePlaceholder({
  icon: Icon,
  phase,
  title,
  description,
  planned,
  foundation,
}: {
  icon: LucideIcon
  phase: string
  title: string
  description: string
  /** What the feature will do when it ships. */
  planned: string[]
  /** What already exists in this foundation to support it. */
  foundation?: string[]
}) {
  const key = `phase-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-6 p-6 sm:p-8 md:flex-row md:items-start">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-6" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-h2">{title}</h2>
              <PhaseBadge phase={phase} />
            </div>
            <p className="max-w-2xl text-body text-muted-foreground">
              {description} This feature is coming in Phase {phase}; nothing on this page is functional yet.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <section aria-labelledby={`${key}-planned`}>
              <h3 id={`${key}-planned`} className="mb-2 text-label text-muted-foreground">
                Planned for Phase {phase}
              </h3>
              <ul className="space-y-1.5 text-small">
                {planned.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/60" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </section>
            {foundation && foundation.length > 0 && (
              <section aria-labelledby={`${key}-foundation`}>
                <h3 id={`${key}-foundation`} className="mb-2 text-label text-muted-foreground">
                  Already in place
                </h3>
                <ul className="space-y-1.5 text-small">
                  {foundation.map((item) => (
                    <li key={item} className="flex gap-2">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}
