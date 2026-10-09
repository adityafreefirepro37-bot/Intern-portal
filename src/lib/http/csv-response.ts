import { NextResponse } from 'next/server'

/** A private, non-cached CSV download (the CSV itself is built with toCsv, which neutralizes formulas). */
export function csvResponse(file: { csv: string; fileName: string }) {
  return new NextResponse(file.csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
