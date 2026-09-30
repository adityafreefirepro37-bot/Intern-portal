import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DocumentStatus, LeaveStatus, Prisma, PrismaClient } from '@prisma/client'
import { createClient } from '@supabase/supabase-js'
import { computeStatus, DEFAULT_ATTENDANCE_RULES, type AttendanceRules } from '../../src/lib/hr/attendance'
import { workingDaysBetween } from '../../src/lib/hr/leave'
import { dayKey, instantAt } from '../../src/lib/hr/time'
import { dateFrom, daysFrom, seedId } from './ids'

/**
 * DEVELOPMENT / DEMO DATA — HR operations (Phase 05): holidays, attendance
 * history with late days, a missing check-out and corrections, leave in every
 * state, documents in every review state (local storage only), HR requests,
 * targeted/scheduled announcements, stipends and an offboarding checklist.
 * Relative dates are recomputed on every run; nothing here runs in production.
 */

type Key = string

interface HrSeedInput {
  organizationId: string
  timeZone: string
  userIds: Record<Key, string>
  internIds: Record<Key, string>
  internshipIds: Record<Key, string>
  departmentIds: Record<Key, string>
  leaveTypeIds: Record<Key, string>
  now: Date
}

/** A minimal valid PDF so seeded documents open in the browser. */
function demoPdf(title: string) {
  const text = `Demo document: ${title}`.replace(/[()\\]/g, '')
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(body.length)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

/**
 * Writes demo files to the storage the app is configured with (same key layout
 * as the storage service). Returns null when storage isn't usable, in which
 * case document rows are skipped rather than pointing at missing files.
 */
function storageWriter(): ((key: string, bytes: Buffer) => Promise<void>) | null {
  const provider = process.env.STORAGE_PROVIDER ?? 'local'
  if (provider === 'supabase') {
    const url = process.env.SUPABASE_URL?.trim()
    const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim()
    if (!url || !key) return null
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    return async (storageKey, bytes) => {
      const { error } = await client.storage
        .from('private')
        .upload(storageKey, bytes, { contentType: 'application/pdf', upsert: true })
      if (error) throw new Error(`Demo document upload failed: ${error.message}`)
    }
  }
  const root = path.resolve(process.env.STORAGE_LOCAL_PATH ?? './.local/uploads')
  return async (storageKey, bytes) => {
    const target = path.join(root, storageKey)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, bytes)
  }
}

export async function seedHr(prisma: PrismaClient, input: HrSeedInput) {
  const { organizationId: org, timeZone: tz, userIds, internIds, internshipIds, now } = input
  const today = dateFrom(new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now)}T00:00:00Z`), 0)
  const at = (date: Date, clock: string) => instantAt(date, clock, tz)
  const rulesRow = await prisma.setting.findUnique({
    where: { organization_id_key: { organization_id: org, key: 'attendance.rules' } },
    select: { value: true },
  })
  const rules = { ...DEFAULT_ATTENDANCE_RULES, ...((rulesRow?.value as Partial<AttendanceRules> | null) ?? {}) }

  // ── Holidays (fixed dates for the current year; one per date) ─────────────
  const year = today.getUTCFullYear()
  const holidaySeeds = [
    ['01-26', 'Republic Day', false],
    ['03-04', 'Holi', false],
    ['08-15', 'Independence Day', false],
    ['10-02', 'Gandhi Jayanti', false],
    ['10-20', 'Dussehra', false],
    ['11-09', 'Diwali', false],
    ['11-10', 'Diwali (Govardhan Puja)', true],
    ['12-25', 'Christmas', false],
  ] as const
  for (const [monthDay, name, optional] of holidaySeeds) {
    const date = new Date(`${year}-${monthDay}T00:00:00Z`)
    await prisma.holiday.upsert({
      where: { organization_id_date: { organization_id: org, date } },
      update: { name, is_optional: optional },
      create: {
        id: seedId(`holiday:${year}:${monthDay}`),
        organization_id: org,
        date,
        name,
        is_optional: optional,
        created_by: userIds.hr,
      },
    })
  }
  const holidays = new Set(
    (await prisma.holiday.findMany({ where: { organization_id: org }, select: { date: true } })).map((h) =>
      dayKey(h.date),
    ),
  )
  const isWorking = (date: Date) => rules.workingDays.includes(date.getUTCDay()) && !holidays.has(dayKey(date))
  const workingDays = { workingDays: rules.workingDays, holidays }

  // ── Leave (relative dates, every state) ──────────────────────────────────
  // Leave rows are regenerated each run; balances only get demo overrides.
  const leaveSeeds: {
    key: string
    who: Key
    type: 'casual' | 'sick' | 'academic'
    from: number
    to: number
    status: LeaveStatus
    reason: string
    comment?: string
  }[] = [
    {
      key: 'ishaan:past',
      who: 'ishaan',
      type: 'casual',
      from: -18,
      to: -17,
      status: 'APPROVED',
      reason: 'Family function',
      comment: 'Enjoy!',
    },
    {
      key: 'ishaan:sick',
      who: 'ishaan',
      type: 'sick',
      from: 5,
      to: 5,
      status: 'PENDING',
      reason: 'Dental appointment',
    },
    {
      key: 'zara:casual',
      who: 'zara',
      type: 'casual',
      from: 10,
      to: 11,
      status: 'PENDING',
      reason: 'Travelling home for a wedding',
    },
    {
      key: 'neel:rejected',
      who: 'neel',
      type: 'casual',
      from: 3,
      to: 4,
      status: 'REJECTED',
      reason: 'Short trip',
      comment: 'Sprint demo that week — please pick other dates.',
    },
    { key: 'neel:exam', who: 'neel', type: 'academic', from: -6, to: -6, status: 'APPROVED', reason: 'Semester exam' },
    {
      key: 'tara:academic',
      who: 'tara',
      type: 'academic',
      from: 1,
      to: 1,
      status: 'APPROVED',
      reason: 'Final project viva',
    },
  ]
  // Only seed-owned rows (deterministic ids) are replaced; leave people create is kept.
  await prisma.leaveRequest.deleteMany({ where: { id: { in: leaveSeeds.map((l) => seedId(`leave:${l.key}`)) } } })
  for (const l of leaveSeeds) {
    const start = dateFrom(today, l.from)
    const end = dateFrom(today, l.to)
    const decided = l.status !== 'PENDING'
    await prisma.leaveRequest.create({
      data: {
        id: seedId(`leave:${l.key}`),
        organization_id: org,
        user_id: userIds[l.who],
        leave_type_id: input.leaveTypeIds[l.type],
        start_date: start,
        end_date: end,
        days: workingDaysBetween(start, end, workingDays),
        reason: l.reason,
        status: l.status,
        created_by: userIds[l.who],
        reviewed_by: decided ? userIds.hr : null,
        reviewed_at: decided ? daysFrom(today, Math.min(l.from, 0) - 2) : null,
        review_comment: l.comment ?? null,
        created_at: daysFrom(today, Math.min(l.from, 0) - 4),
      },
    })
  }
  // Demo allowances for types created before Phase 05 (the reference seed only sets them on creation).
  // Only fills a missing allowance; one HR has set is left alone.
  for (const [slug, days] of [
    ['casual', 6],
    ['sick', 6],
  ] as const) {
    await prisma.leaveType.updateMany({
      where: { id: input.leaveTypeIds[slug], quota_days: null },
      data: { quota_days: days },
    })
  }
  const balanceId = seedId('leave-balance:tara:casual')
  await prisma.leaveBalance.upsert({
    where: { user_id_leave_type_id: { user_id: userIds.tara, leave_type_id: input.leaveTypeIds.casual } },
    update: { allocated_days: 8 },
    create: {
      id: balanceId,
      organization_id: org,
      user_id: userIds.tara,
      leave_type_id: input.leaveTypeIds.casual,
      allocated_days: 8,
      notes: 'Two extra days carried over from a previous engagement (demo)',
      updated_by: userIds.hr,
    },
  })
  const onLeave = (who: Key, date: Date) =>
    leaveSeeds.some(
      (l) =>
        l.who === who && l.status === 'APPROVED' && date >= dateFrom(today, l.from) && date <= dateFrom(today, l.to),
    )

  // ── Attendance history (past working days) + a few check-ins today ───────
  const tracked: { who: Key; joinedDaysAgo: number }[] = [
    { who: 'ishaan', joinedDaysAgo: 45 },
    { who: 'zara', joinedDaysAgo: 20 },
    { who: 'neel', joinedDaysAgo: 12 },
    { who: 'tara', joinedDaysAgo: 78 },
  ]
  // Seed-owned rows use ids keyed by (person, day offset); replace only those (and corrections that point at them).
  // Records people create (e.g. today's check-in) are kept; a seeded day never overwrites one.
  const seedAttendanceIds = [
    ...[...tracked.map((t) => t.who), 'intern'].flatMap((who) =>
      Array.from({ length: 100 }, (_, i) => seedId(`attendance:${who}:${-(i + 1)}`)),
    ),
    seedId('attendance:ishaan:today'),
    seedId('attendance:neel:today'),
  ]
  await prisma.attendanceCorrection.deleteMany({
    where: {
      OR: [
        { id: { in: [seedId('correction:zara:missing'), seedId('correction:ishaan:approved')] } },
        { attendance_id: { in: seedAttendanceIds } },
      ],
    },
  })
  await prisma.attendance.deleteMany({ where: { id: { in: seedAttendanceIds } } })
  const attendanceRows: Prisma.AttendanceCreateManyInput[] = []

  // The most recent working day at least `from` days ago (so the demo lands on a real working day).
  const workingOffset = (from: number) => {
    let offset = from
    while (!isWorking(dateFrom(today, offset))) offset--
    return offset
  }
  const missingOffset = workingOffset(-2)
  const correctedOffset = workingOffset(Math.min(-4, missingOffset - 1))

  const pattern = (who: Key, offset: number): { in: string; out: string | null; breakMin: number } | 'SKIP' => {
    // Deterministic variety: mostly on time, some late, one half day, one absence, one missing check-out.
    if (who === 'zara' && offset === missingOffset) return { in: '10:05', out: null, breakMin: 0 } // missing check-out
    if (who === 'ishaan' && offset === -9) return 'SKIP' // absent
    if (who === 'neel' && offset === -2) return { in: '10:02', out: '14:10', breakMin: 0 } // half day
    if ((offset + who.length) % 5 === 0) return { in: '10:38', out: '18:45', breakMin: 40 } // late
    return { in: offset % 2 === 0 ? '09:56' : '10:09', out: '18:32', breakMin: 45 }
  }
  for (const t of tracked) {
    const first = Math.max(-21, -t.joinedDaysAgo)
    for (let offset = first; offset <= -1; offset++) {
      const date = dateFrom(today, offset)
      if (!isWorking(date) || onLeave(t.who, date)) continue
      const p = pattern(t.who, offset)
      if (p === 'SKIP') continue
      const checkIn = at(date, p.in)
      const checkOut = p.out ? at(date, p.out) : null
      const computed = computeStatus({ checkIn, checkOut, breakMinutes: p.breakMin, rules, timeZone: tz })
      attendanceRows.push({
        id: seedId(`attendance:${t.who}:${offset}`),
        organization_id: org,
        user_id: userIds[t.who],
        date,
        check_in_at: checkIn,
        check_out_at: checkOut,
        break_minutes: p.breakMin,
        total_minutes: computed.totalMinutes,
        status: computed.status,
        is_late: computed.isLate,
        late_minutes: computed.lateMinutes,
        source: 'SELF',
      })
    }
  }
  // Aanya (development intern) joined 2 days ago: her first working days.
  for (let offset = -2; offset <= -1; offset++) {
    const date = dateFrom(today, offset)
    if (!isWorking(date)) continue
    const checkIn = at(date, '09:58')
    const checkOut = at(date, '18:20')
    const computed = computeStatus({ checkIn, checkOut, breakMinutes: 45, rules, timeZone: tz })
    attendanceRows.push({
      id: seedId(`attendance:intern:${offset}`),
      organization_id: org,
      user_id: userIds.intern,
      date,
      check_in_at: checkIn,
      check_out_at: checkOut,
      break_minutes: 45,
      total_minutes: computed.totalMinutes,
      status: computed.status,
      is_late: computed.isLate,
      late_minutes: computed.lateMinutes,
    })
  }
  if (isWorking(today)) {
    for (const [who, clock] of [
      ['ishaan', '09:52'],
      ['neel', '10:41'],
    ] as const) {
      const checkIn = at(today, clock)
      if (checkIn > now) continue
      const computed = computeStatus({ checkIn, checkOut: null, breakMinutes: 0, rules, timeZone: tz })
      attendanceRows.push({
        id: seedId(`attendance:${who}:today`),
        organization_id: org,
        user_id: userIds[who],
        date: today,
        check_in_at: checkIn,
        status: computed.status,
        is_late: computed.isLate,
        late_minutes: computed.lateMinutes,
      })
    }
  }
  const { count: records } = await prisma.attendance.createMany({ data: attendanceRows, skipDuplicates: true })

  // Corrections: Zara's missing check-out (pending), an approved one for Ishaan.
  const zaraMissing = dateFrom(today, missingOffset)
  const zaraRecord = await prisma.attendance.findUnique({
    where: { id: seedId(`attendance:zara:${missingOffset}`) },
    select: { id: true, check_in_at: true },
  })
  if (zaraRecord) {
    await prisma.attendanceCorrection.create({
      data: {
        id: seedId('correction:zara:missing'),
        organization_id: org,
        user_id: userIds.zara,
        date: zaraMissing,
        attendance_id: zaraRecord.id,
        category: 'FORGOT_CHECK_OUT',
        requested_by: userIds.zara,
        reason: 'Left for a client shoot and forgot to check out.',
        requested_check_out: at(zaraMissing, '18:30'),
        original_check_in: zaraRecord.check_in_at,
        created_at: daysFrom(today, missingOffset + 1, 6),
      },
    })
  }
  const ishaanDay = dateFrom(today, correctedOffset)
  const ishaanRecord = await prisma.attendance.findUnique({
    where: { id: seedId(`attendance:ishaan:${correctedOffset}`) },
    select: { id: true, check_in_at: true, check_out_at: true, break_minutes: true },
  })
  if (ishaanRecord?.check_in_at) {
    const corrected = at(ishaanDay, '09:50')
    const computed = computeStatus({
      checkIn: corrected,
      checkOut: ishaanRecord.check_out_at,
      breakMinutes: ishaanRecord.break_minutes,
      rules,
      timeZone: tz,
    })
    await prisma.attendance.update({
      where: { id: ishaanRecord.id },
      data: {
        check_in_at: corrected,
        status: computed.status,
        is_late: computed.isLate,
        late_minutes: computed.lateMinutes,
        total_minutes: computed.totalMinutes,
        source: 'CORRECTION',
        updated_by: userIds.manager,
      },
    })
    await prisma.attendanceCorrection.create({
      data: {
        id: seedId('correction:ishaan:approved'),
        organization_id: org,
        user_id: userIds.ishaan,
        date: ishaanDay,
        attendance_id: ishaanRecord.id,
        category: 'SYSTEM_ISSUE',
        requested_by: userIds.ishaan,
        reason: 'The office Wi-Fi was down, so my check-in was delayed.',
        requested_check_in: corrected,
        original_check_in: ishaanRecord.check_in_at,
        original_check_out: ishaanRecord.check_out_at,
        status: 'APPROVED',
        reviewed_by: userIds.manager,
        reviewed_at: daysFrom(today, correctedOffset + 1),
        review_comment: 'Confirmed with IT.',
      },
    })
  }

  // ── Documents (demo PDFs written to the configured storage so they download) ──
  let documents = 0
  const writeFileTo = storageWriter()
  if (writeFileTo) {
    const types = Object.fromEntries(
      (
        await prisma.hrDocumentType.findMany({
          where: { organization_id: org },
          select: { id: true, slug: true, legacy_type: true },
        })
      ).map((t) => [t.slug, t]),
    )
    const docSeeds: {
      key: string
      who: Key
      type: string
      status: DocumentStatus
      version?: number
      current?: boolean
      reason?: string
      expiresIn?: number
      uploadedDaysAgo: number
    }[] = [
      { key: 'ishaan:offer', who: 'ishaan', type: 'offer-letter', status: 'VERIFIED', uploadedDaysAgo: 44 },
      { key: 'ishaan:nda', who: 'ishaan', type: 'nda', status: 'VERIFIED', uploadedDaysAgo: 44 },
      { key: 'ishaan:id', who: 'ishaan', type: 'id-proof', status: 'VERIFIED', expiresIn: 20, uploadedDaysAgo: 43 },
      { key: 'zara:offer', who: 'zara', type: 'offer-letter', status: 'VERIFIED', uploadedDaysAgo: 19 },
      { key: 'zara:nda', who: 'zara', type: 'nda', status: 'UPLOADED', uploadedDaysAgo: 1 },
      { key: 'neel:offer', who: 'neel', type: 'offer-letter', status: 'UPLOADED', uploadedDaysAgo: 2 },
      { key: 'neel:nda', who: 'neel', type: 'nda', status: 'UNDER_REVIEW', uploadedDaysAgo: 3 },
      {
        key: 'neel:id',
        who: 'neel',
        type: 'id-proof',
        status: 'REJECTED',
        reason: 'The photo is blurred — please upload a clear scan.',
        expiresIn: 900,
        uploadedDaysAgo: 4,
      },
      { key: 'tara:offer', who: 'tara', type: 'offer-letter', status: 'VERIFIED', uploadedDaysAgo: 77 },
      { key: 'tara:nda', who: 'tara', type: 'nda', status: 'VERIFIED', uploadedDaysAgo: 77 },
      {
        key: 'tara:id:v1',
        who: 'tara',
        type: 'id-proof',
        status: 'REJECTED',
        current: false,
        reason: 'Expired ID.',
        expiresIn: -30,
        uploadedDaysAgo: 76,
      },
      {
        key: 'tara:id:v2',
        who: 'tara',
        type: 'id-proof',
        status: 'VERIFIED',
        version: 2,
        expiresIn: 400,
        uploadedDaysAgo: 70,
      },
      { key: 'tara:noc', who: 'tara', type: 'college-noc', status: 'VERIFIED', uploadedDaysAgo: 76 },
    ]
    // Replace only the seed's own documents; uploads made by people are kept.
    const seededIds = docSeeds.map((d) => seedId(`document:${d.key}`))
    await prisma.onboardingItem.updateMany({ where: { document_id: { in: seededIds } }, data: { document_id: null } })
    await prisma.internshipDocument.deleteMany({ where: { id: { in: seededIds } } })
    const previous: Record<string, string> = {}
    for (const d of docSeeds) {
      const type = types[d.type]
      if (!type) continue
      const id = seedId(`document:${d.key}`)
      const storagePath = `${org}/document/seed/${id}.pdf`
      const bytes = demoPdf(`${d.type} for ${d.who}`)
      await writeFileTo(storagePath, bytes)
      const versionKey = `${d.who}:${d.type}`
      await prisma.internshipDocument.create({
        data: {
          id,
          organization_id: org,
          intern_id: internIds[d.who],
          internship_id: internshipIds[d.who],
          document_type: type.legacy_type,
          document_type_id: type.id,
          file_name: `${d.type}-${d.who}.pdf`,
          storage_path: storagePath,
          mime_type: 'application/pdf',
          file_size: bytes.byteLength,
          uploaded_by: userIds[d.who],
          visibility: d.type === 'id-proof' || d.type === 'college-noc' ? 'HR' : 'INTERN',
          status: d.status,
          version: d.version ?? 1,
          previous_version_id: d.version && d.version > 1 ? (previous[versionKey] ?? null) : null,
          is_current: d.current ?? true,
          verified_by: d.status === 'VERIFIED' ? userIds.hr : null,
          verified_at: d.status === 'VERIFIED' ? daysFrom(today, -d.uploadedDaysAgo + 1) : null,
          rejection_reason: d.reason ?? null,
          expires_at: d.expiresIn !== undefined ? dateFrom(today, d.expiresIn) : null,
          created_at: daysFrom(today, -d.uploadedDaysAgo),
        },
      })
      previous[versionKey] = id
      documents++
    }
  }

  // ── HR requests ───────────────────────────────────────────────────────────
  await prisma.hrRequest.deleteMany({
    where: {
      organization_id: org,
      id: { in: ['tara:letter', 'zara:profile', 'neel:cert'].map((k) => seedId(`hr-request:${k}`)) },
    },
  })
  const requestSeeds = [
    {
      key: 'tara:letter',
      who: 'tara',
      category: 'EXPERIENCE_LETTER' as const,
      subject: 'Experience letter for my college',
      description: 'My college needs an experience letter on company letterhead before my internship ends.',
      status: 'OPEN' as const,
      daysAgo: 1,
      comments: [] as [Key, string][],
    },
    {
      key: 'zara:profile',
      who: 'zara',
      category: 'PROFILE_CHANGE' as const,
      subject: 'Update my permanent address',
      description: 'I moved to a new flat in Indiranagar. Please update my address on file.',
      status: 'WAITING_FOR_USER' as const,
      daysAgo: 4,
      comments: [['hr', 'Happy to update it — please attach a copy of your rental agreement or a utility bill.']] as [
        Key,
        string,
      ][],
    },
    {
      key: 'neel:cert',
      who: 'neel',
      category: 'CERTIFICATE' as const,
      subject: 'Bonafide certificate for scholarship',
      description: 'Need a bonafide internship certificate for my scholarship renewal.',
      status: 'RESOLVED' as const,
      daysAgo: 9,
      comments: [
        ['hr', 'Shared a signed copy with you by email.'],
        ['neel', 'Received, thank you!'],
      ] as [Key, string][],
    },
  ]
  for (const r of requestSeeds) {
    const id = seedId(`hr-request:${r.key}`)
    const resolved = r.status === 'RESOLVED'
    await prisma.hrRequest.create({
      data: {
        id,
        organization_id: org,
        requester_id: userIds[r.who],
        category: r.category,
        subject: r.subject,
        description: r.description,
        status: r.status,
        assigned_to: r.status === 'OPEN' ? null : userIds.hr,
        resolution: resolved ? 'Certificate issued.' : null,
        resolved_at: resolved ? daysFrom(today, -r.daysAgo + 2) : null,
        resolved_by: resolved ? userIds.hr : null,
        created_at: daysFrom(today, -r.daysAgo),
        comments: {
          create: r.comments.map(([author, body], index) => ({
            author_id: userIds[author],
            body,
            created_at: daysFrom(today, -r.daysAgo + index + 1),
          })),
        },
      },
    })
  }

  // ── Announcements: category, targeting and lifecycle ─────────────────────
  const announcementSeeds = [
    {
      key: 'welcome',
      title: 'Welcome to AYAVA INTERN OS',
      body: 'This workspace is running on development demo data. People, projects and tasks shown here are fictional.',
      category: 'COMPANY' as const,
      audience: 'EVERYONE' as const,
      ids: [] as string[],
      status: 'PUBLISHED' as const,
      publishedDays: -1,
      priority: 'NORMAL' as const,
    },
    {
      key: 'gandhi-jayanti',
      title: 'Office closed for Gandhi Jayanti',
      body: 'The office is closed on 2 October. It won’t count against your attendance or leave.',
      category: 'HOLIDAY' as const,
      audience: 'EVERYONE' as const,
      ids: [] as string[],
      status: 'PUBLISHED' as const,
      publishedDays: -2,
      priority: 'HIGH' as const,
    },
    {
      key: 'marketing-calendar',
      title: 'Marketing: content calendar review on Friday',
      body: 'Bring your drafts for next month’s social calendar. 4 pm in the studio.',
      category: 'DEADLINE' as const,
      audience: 'DEPARTMENT' as const,
      ids: [input.departmentIds.marketing],
      status: 'PUBLISHED' as const,
      publishedDays: -1,
      priority: 'NORMAL' as const,
    },
    {
      key: 'documents-reminder',
      title: 'Reminder: upload your ID proof',
      body: 'Interns who haven’t uploaded a government ID yet, please do so from Documents.',
      category: 'HR' as const,
      audience: 'INTERNS' as const,
      ids: [] as string[],
      status: 'SCHEDULED' as const,
      publishedDays: 2,
      priority: 'NORMAL' as const,
    },
    {
      key: 'policy-draft',
      title: 'Draft: updated remote work guidelines',
      body: 'Work in progress — not visible to interns until published.',
      category: 'POLICY' as const,
      audience: 'EVERYONE' as const,
      ids: [] as string[],
      status: 'DRAFT' as const,
      publishedDays: null,
      priority: 'NORMAL' as const,
    },
  ]
  for (const a of announcementSeeds) {
    const id = seedId(`announcement:${a.key}`)
    const publishedAt = a.publishedDays === null ? null : daysFrom(now, a.publishedDays, 4)
    const data = {
      organization_id: org,
      title: a.title,
      body: a.body,
      priority: a.priority,
      category: a.category,
      audience: a.audience,
      audience_ids: a.ids,
      status: a.status,
      published_by: publishedAt ? userIds.hr : null,
      published_at: publishedAt,
      expires_at: null,
      archived_at: null,
      // Seeded announcements never fan out notifications.
      notified_at: publishedAt ?? now,
      created_by: userIds.hr,
    }
    await prisma.announcement.upsert({ where: { id }, update: data, create: { id, ...data } })
  }

  // ── Stipends, personal details, offboarding ─────────────────────────────
  const stipends: [Key, number][] = [
    ['intern', 12000],
    ['ishaan', 10000],
    ['zara', 12000],
    ['neel', 15000],
    ['tara', 10000],
    ['diya', 8000],
  ]
  for (const [who, amount] of stipends) {
    await prisma.internship.update({
      where: { id: internshipIds[who] },
      data: { stipend_amount: amount, stipend_currency: 'INR', stipend_frequency: 'MONTHLY' },
    })
  }
  await prisma.emergencyContact.update({
    where: { id: seedId('emergency:intern') },
    data: { alternate_phone: '+91 90000 00002' },
  })
  await prisma.internProfile
    .update({ where: { intern_id: internIds.intern }, data: { preferred_name: 'Aanya' } })
    .catch(() => undefined)

  await prisma.offboardingChecklist.deleteMany({ where: { intern_id: internIds.tara } })
  const checklistItems = [
    ['Confirm final task handover', 'DONE'],
    ['Collect exit feedback', 'PENDING'],
    ['Return company equipment and revoke access', 'PENDING'],
    ['Prepare experience letter', 'DONE'],
    ['Issue completion certificate', 'PENDING'],
  ] as const
  const tara = await prisma.intern.findUniqueOrThrow({
    where: { id: internIds.tara },
    select: { expected_end_date: true },
  })
  await prisma.offboardingChecklist.create({
    data: {
      id: seedId('offboarding:tara'),
      organization_id: org,
      intern_id: internIds.tara,
      internship_id: internshipIds.tara,
      started_by: userIds.hr,
      started_at: daysFrom(today, -3),
      items: {
        create: checklistItems.map(([title, status], index) => ({
          title,
          status,
          sort_order: index,
          due_date: tara.expected_end_date,
          completed_by: status === 'DONE' ? userIds.hr : null,
          completed_at: status === 'DONE' ? daysFrom(today, -2) : null,
        })),
      },
    },
  })

  // ── Notifications (a couple, so HR and interns see HR activity) ───────────
  const notificationSeeds = [
    {
      key: 'hr:leave',
      user: 'hr',
      type: 'LEAVE_REQUESTED',
      title: 'Zara Khan requested casual leave',
      entity: 'leave',
      entityId: seedId('leave:zara:casual'),
      hoursAgo: 6,
    },
    {
      key: 'hr:correction',
      user: 'hr',
      type: 'ATTENDANCE_CORRECTION_REQUESTED',
      title: 'Zara Khan asked to correct attendance',
      entity: 'attendance_correction',
      entityId: seedId('correction:zara:missing'),
      hoursAgo: 30,
    },
    {
      key: 'manager:leave',
      user: 'manager',
      type: 'LEAVE_REQUESTED',
      title: 'Ishaan Verma requested sick leave',
      entity: 'leave',
      entityId: seedId('leave:ishaan:sick'),
      hoursAgo: 10,
    },
  ]
  for (const n of notificationSeeds) {
    const id = seedId(`notification:${n.key}`)
    const data = {
      organization_id: org,
      user_id: userIds[n.user],
      type: n.type,
      title: n.title,
      related_entity_type: n.entity,
      related_entity_id: n.entityId,
      read_at: null,
      created_at: new Date(now.getTime() - n.hoursAgo * 3_600_000),
    }
    await prisma.notification.upsert({ where: { id }, update: data, create: { id, ...data } })
  }

  return { attendance: records, leave: leaveSeeds.length, documents, requests: requestSeeds.length }
}
