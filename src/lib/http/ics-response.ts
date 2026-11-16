/** A downloadable iCalendar file that is never cached by shared caches. */
export function icsResponse(file: { filename: string; body: string }) {
  return new Response(file.body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.filename.replace(/[^\w.-]/g, '_')}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
