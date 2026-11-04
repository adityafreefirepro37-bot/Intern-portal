import * as React from 'react'
import Link from 'next/link'

/**
 * Renders the small Markdown subset AYAVA AI uses, as React elements. Model
 * output is never treated as HTML, and links are limited to internal paths and
 * http(s) (so `javascript:` and similar can't be produced).
 */

export interface CitationTarget {
  n: number
  title: string
  href: string
}

/** Internal path or http(s) URL; anything else isn't a link. */
export function safeHref(href: string): string | null {
  const value = href.trim()
  if (/^\/(?!\/)[^\s]*$/.test(value)) return value
  if (/^https?:\/\/[^\s]+$/i.test(value)) return value
  return null
}

function inline(text: string, keyPrefix: string, citations: CitationTarget[]): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))|(\[\d{1,2}\])/g
  let last = 0
  let match: RegExpExecArray | null
  let i = 0
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index))
    const token = match[0]
    const key = `${keyPrefix}-${i++}`
    if (match[1]) {
      out.push(
        <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>,
      )
    } else if (match[2]) {
      out.push(<strong key={key}>{inline(token.slice(2, -2), key, citations)}</strong>)
    } else if (match[3]) {
      out.push(<em key={key}>{inline(token.slice(1, -1), key, citations)}</em>)
    } else if (match[4]) {
      const [, label, target] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token) ?? []
      const href = target ? safeHref(target) : null
      if (href?.startsWith('/')) {
        out.push(
          <Link key={key} href={href} className="font-medium text-primary underline underline-offset-2">
            {label}
          </Link>,
        )
      } else if (href) {
        out.push(
          <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-primary underline underline-offset-2">
            {label}
          </a>,
        )
      } else {
        out.push(label ?? token)
      }
    } else {
      const n = Number(token.slice(1, -1))
      const source = citations.find((c) => c.n === n)
      out.push(
        source ? (
          <Link
            key={key}
            href={source.href}
            aria-label={`Source ${n}: ${source.title}`}
            className="mx-0.5 inline-flex min-w-4 items-center justify-center rounded bg-primary/10 px-1 text-[0.75em] font-semibold text-primary no-underline hover:bg-primary/20"
          >
            {n}
          </Link>
        ) : (
          token
        ),
      )
    }
    last = match.index + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line)
const isTableRule = (line: string) => /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-')
const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())

export function Markdown({ text, citations = [] }: { text: string; citations?: CitationTarget[] }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: React.ReactNode[] = []
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const k = `b${key++}`
    if (line.startsWith('```')) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++])
      i++
      blocks.push(
        <pre key={k} className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-caption" tabIndex={0}>
          <code>{code.join('\n')}</code>
        </pre>,
      )
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      blocks.push(
        <p key={k} role="heading" aria-level={Math.min(heading[1].length + 2, 6)} className="mt-1 font-semibold">
          {inline(heading[2], k, citations)}
        </p>,
      )
      i++
      continue
    }
    if (isTableRow(line) && i + 1 < lines.length && isTableRule(lines[i + 1])) {
      const header = cells(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]))
      blocks.push(
        <div key={k} className="overflow-x-auto" tabIndex={0}>
          <table className="w-full border-collapse text-small">
            <thead>
              <tr>
                {header.map((cell, c) => (
                  <th key={c} className="border-b px-2 py-1.5 text-left font-semibold">
                    {inline(cell, `${k}h${c}`, citations)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="border-b px-2 py-1.5 align-top">
                      {inline(cell, `${k}r${r}c${c}`, citations)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }
    const listItem = /^\s*([-*•]|\d+[.)])\s+(.*)$/
    if (listItem.test(line)) {
      const ordered = /^\s*\d/.test(line)
      const items: string[] = []
      while (i < lines.length && listItem.test(lines[i]) && /^\s*\d/.test(lines[i]) === ordered) {
        items.push(listItem.exec(lines[i])![2])
        i++
      }
      const List = ordered ? 'ol' : 'ul'
      blocks.push(
        <List key={k} className={`space-y-1 pl-5 ${ordered ? 'list-decimal' : 'list-disc'}`}>
          {items.map((item, n) => (
            <li key={n}>{inline(item, `${k}i${n}`, citations)}</li>
          ))}
        </List>,
      )
      continue
    }
    if (line.startsWith('>')) {
      const quote: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) quote.push(lines[i++].replace(/^>\s?/, ''))
      blocks.push(
        <blockquote key={k} className="border-l-2 pl-3 text-muted-foreground">
          {inline(quote.join(' '), k, citations)}
        </blockquote>,
      )
      continue
    }
    const paragraph: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith('```') &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !listItem.test(lines[i]) &&
      !lines[i].startsWith('>') &&
      !(isTableRow(lines[i]) && i + 1 < lines.length && isTableRule(lines[i + 1]))
    ) {
      paragraph.push(lines[i++])
    }
    blocks.push(<p key={k}>{inline(paragraph.join(' '), k, citations)}</p>)
  }
  return <div className="space-y-2.5 text-small leading-relaxed [overflow-wrap:anywhere]">{blocks}</div>
}
