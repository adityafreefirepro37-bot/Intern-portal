/**
 * Mention markup produced by the comment and message composers:
 * @[Display Name](user-uuid). Rendered as text only, never HTML.
 */
export const MENTION_PATTERN = /@\[([^\]]{1,80})\]\(([0-9a-f-]{36})\)/g

export function extractMentionIds(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION_PATTERN)].map((match) => match[2]))]
}

/** Mention token for a person (brackets removed from the name so the markup stays parseable). */
export function mentionToken(name: string, userId: string): string {
  return `@[${name.replace(/[[\]]/g, '')}](${userId}) `
}

/** Plain-text version (for notifications and email): "@[Asha Rao](id)" → "@Asha Rao". */
export function mentionsToText(body: string): string {
  return body.replace(MENTION_PATTERN, (_match, name: string) => `@${name}`)
}
