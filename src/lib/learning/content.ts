/**
 * Lesson text is plain text with a tiny, safe structure: "# " headings, "- "
 * bullet lists and blank-line paragraphs. It is rendered as React text nodes —
 * never as HTML — so authored content can't inject markup or script.
 */
export type ContentBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }

export function parseLessonText(text: string | null | undefined): ContentBlock[] {
  if (!text) return []
  const blocks: ContentBlock[] = []
  let paragraph: string[] = []
  let list: string[] = []
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') })
    if (list.length) blocks.push({ type: 'list', items: list })
    paragraph = []
    list = []
  }
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    if (line.startsWith('# ')) {
      flush()
      blocks.push({ type: 'heading', text: line.slice(2).trim() })
    } else if (/^[-*] /.test(line)) {
      if (paragraph.length) {
        blocks.push({ type: 'paragraph', text: paragraph.join(' ') })
        paragraph = []
      }
      list.push(line.slice(2).trim())
    } else {
      if (list.length) {
        blocks.push({ type: 'list', items: list })
        list = []
      }
      paragraph.push(line)
    }
  }
  flush()
  return blocks
}

/** Only absolute https URLs without credentials are accepted for lesson resources. */
export function isSafeResourceUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && url.hostname.includes('.')
  } catch {
    return false
  }
}
