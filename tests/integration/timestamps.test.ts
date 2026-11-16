import { AYAVA_ORGANIZATION_ID, prisma } from './helpers'

/**
 * The node-postgres adapter sends DateTime values without an offset; src/lib/db/pool.ts pins
 * sessions to UTC so a database server in another timezone still stores the right instant.
 */
it('stores timestamps as the instant given, whatever the server timezone', async () => {
  const at = new Date('2026-12-26T05:30:00.000Z')
  const meeting = await prisma.meeting.create({
    data: { organization_id: AYAVA_ORGANIZATION_ID, title: 'Timestamp check', start_at: at, end_at: at },
  })
  try {
    const [row] = await prisma.$queryRaw<{ utc: string; db_now_ok: boolean }[]>`
      SELECT to_char(start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS utc,
             abs(extract(epoch FROM (created_at - now()))) < 60 AS db_now_ok
      FROM meetings WHERE id = ${meeting.id}::uuid`
    expect(row.utc).toBe('2026-12-26T05:30:00')
    const read = await prisma.meeting.findUniqueOrThrow({ where: { id: meeting.id } })
    expect(read.start_at.toISOString()).toBe(at.toISOString())
    // Database defaults (now()) read back as the real current time.
    expect(Math.abs(read.created_at.getTime() - Date.now())).toBeLessThan(60_000)
    expect(row.db_now_ok).toBe(true)
  } finally {
    await prisma.meeting.delete({ where: { id: meeting.id } })
  }
})
