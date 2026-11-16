import { cn } from '@/lib/utils'

/**
 * Small, dependency-free charts (server-rendered SVG). Rules they follow:
 * one y-axis; series colours from the validated --viz tokens (identity is never
 * colour alone — a legend names every series and the latest values are labelled);
 * thin marks (bars ≤ 18px with 4px rounded tops and 2px gaps, 2px lines, 8px
 * markers); recessive grid; hover tooltips on a full-height hit area per month;
 * and every chart has a table view.
 */

export interface Series {
  name: string
  values: (number | null)[]
  tone: 'viz-1' | 'viz-2'
}

const TONE_FILL = { 'viz-1': 'fill-viz-1', 'viz-2': 'fill-viz-2' } as const
const TONE_STROKE = { 'viz-1': 'stroke-viz-1', 'viz-2': 'stroke-viz-2' } as const
const TONE_BG = { 'viz-1': 'bg-viz-1', 'viz-2': 'bg-viz-2' } as const

const W = 640
const H = 220
const PAD = { top: 16, right: 16, bottom: 28, left: 40 }

function niceMax(value: number, unit: string) {
  if (unit === '%') return 100
  if (value <= 4) return 4
  const pow = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 2, 2.5, 5, 10]) if (step * pow >= value) return step * pow
  return 10 * pow
}

function fmt(v: number | null, unit: string) {
  return v === null ? '—' : `${v}${unit}`
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground" aria-label="Legend">
      {series.map((s) => (
        <li key={s.name} className="flex items-center gap-1.5">
          <span className={cn('size-2.5 rounded-sm', TONE_BG[s.tone])} aria-hidden />
          {s.name}
        </li>
      ))}
    </ul>
  )
}

function DataTable({ labels, series, unit }: { labels: string[]; series: Series[]; unit: string }) {
  return (
    <details className="text-small">
      <summary className="cursor-pointer text-caption font-medium text-muted-foreground hover:text-foreground">Show as table</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-caption">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th scope="col" className="py-1 pr-3 font-medium">Month</th>
              {series.map((s) => (
                <th key={s.name} scope="col" className="py-1 pr-3 text-right font-medium">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {labels.map((label, i) => (
              <tr key={label}>
                <th scope="row" className="py-1 pr-3 text-left font-normal">{label}</th>
                {series.map((s) => (
                  <td key={s.name} className="tabular py-1 pr-3 text-right">
                    {fmt(s.values[i] ?? null, unit)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

/** Rounded-top bar anchored to the baseline. */
function barPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h)
  if (h <= 0) return ''
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
}

export function TrendChart({
  title,
  description,
  labels,
  series,
  kind = 'columns',
  unit = '',
}: {
  title: string
  description?: string
  labels: string[]
  series: Series[]
  kind?: 'columns' | 'line'
  unit?: '' | '%'
}) {
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null))
  const empty = all.length === 0 || all.every((v) => v === 0)
  const max = niceMax(Math.max(0, ...all), unit)
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const step = plotW / Math.max(labels.length, 1)
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH
  const ticks = [0, max / 2, max]
  const last = labels.length - 1
  const groupW = Math.min(step * 0.7, series.length * 18 + (series.length - 1) * 2)
  const barW = (groupW - (series.length - 1) * 2) / series.length

  return (
    <figure className="space-y-2">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span>
          <span className="block text-small font-medium">{title}</span>
          {description && <span className="block text-caption text-muted-foreground">{description}</span>}
        </span>
        <Legend series={series} />
      </figcaption>
      {empty ? (
        <p className="grid h-32 place-items-center rounded-md border border-dashed text-caption text-muted-foreground">
          No data in this period.
        </p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${title}. Values are in the table below.`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
                {Math.round(t)}
                {unit}
              </text>
            </g>
          ))}
          {labels.map((label, i) => (
            <text key={label} x={PAD.left + step * i + step / 2} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
              {label}
            </text>
          ))}

          {kind === 'columns' &&
            series.map((s, si) =>
              s.values.map((v, i) => {
                if (v === null || v === 0) return null
                const x = PAD.left + step * i + (step - groupW) / 2 + si * (barW + 2)
                return <path key={`${s.name}-${i}`} d={barPath(x, y(v), barW, y(0) - y(v))} className={TONE_FILL[s.tone]} />
              }),
            )}
          {kind === 'columns' &&
            series.map((s, si) => {
              const v = s.values[last]
              if (v === null || v === undefined) return null
              const x = PAD.left + step * last + (step - groupW) / 2 + si * (barW + 2) + barW / 2
              return (
                <text key={`label-${s.name}`} x={x} y={y(v) - 5} textAnchor="middle" className="fill-foreground text-[11px] font-medium">
                  {v}
                </text>
              )
            })}

          {kind === 'line' &&
            series.map((s) => {
              const points = s.values.map((v, i) => (v === null ? null : ([PAD.left + step * i + step / 2, y(v)] as const)))
              // Break the line at missing months.
              let d = ''
              let pen = false
              for (const p of points) {
                if (!p) {
                  pen = false
                  continue
                }
                d += `${pen ? 'L' : 'M'}${p[0]},${p[1]} `
                pen = true
              }
              const lastPoint = [...points].reverse().find(Boolean)
              const lastValue = [...s.values].reverse().find((v) => v !== null)
              return (
                <g key={s.name}>
                  <path d={d} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className={TONE_STROKE[s.tone]} />
                  {points.map((p, i) => (p ? <circle key={i} cx={p[0]} cy={p[1]} r={4} className={cn(TONE_FILL[s.tone], 'stroke-card')} strokeWidth={2} /> : null))}
                  {lastPoint && (
                    <text x={lastPoint[0]} y={lastPoint[1] - 9} textAnchor="middle" className="fill-foreground text-[11px] font-medium">
                      {fmt(lastValue ?? null, unit)}
                    </text>
                  )}
                </g>
              )
            })}

          {/* Hover targets: one full-height column per month with every series' value. */}
          {labels.map((label, i) => (
            <rect key={`hit-${label}`} x={PAD.left + step * i} y={PAD.top} width={step} height={plotH} fill="transparent" className="hover:fill-foreground/5">
              <title>{`${label}: ${series.map((s) => `${s.name} ${fmt(s.values[i] ?? null, unit)}`).join(', ')}`}</title>
            </rect>
          ))}
        </svg>
      )}
      <DataTable labels={labels} series={series} unit={unit} />
    </figure>
  )
}

/** Horizontal bars with the value printed (never colour-only). */
export function HBars({ items, unit = '', empty = 'No data in this period.' }: { items: { label: string; value: number }[]; unit?: string; empty?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  if (items.length === 0) return <p className="text-small text-muted-foreground">{empty}</p>
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.label} className="grid grid-cols-[minmax(6rem,11rem)_1fr_auto] items-center gap-3 text-small" title={`${item.label}: ${item.value}${unit}`}>
          <span className="truncate">{item.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            <span className="block h-full rounded-full bg-viz-1" style={{ width: `${(item.value / max) * 100}%` }} />
          </span>
          <span className="tabular text-right font-medium">
            {item.value}
            {unit}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** A headline number with its definition. */
export function Stat({ label, value, hint }: { label: string; value: string | number | null; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="tabular text-h2">{value === null ? '—' : value}</dd>
      {hint && <dd className="text-caption text-muted-foreground">{hint}</dd>}
    </div>
  )
}
