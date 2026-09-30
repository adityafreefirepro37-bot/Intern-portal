import { setAuthProviderForTesting } from '@/lib/auth/provider'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { dayKey } from '@/lib/hr/time'
import { addDays, formatDateOnly, todayIn } from '@/lib/interns/dates'
import type { RequestContext } from '@/server/context'
import { announcementJobs, announcementService } from '@/server/services/announcement.service'
import { attendanceService } from '@/server/services/attendance.service'
import { AUDIT_ACTIONS } from '@/server/services/audit-actions'
import { documentService } from '@/server/services/document.service'
import { holidayService } from '@/server/services/holiday.service'
import { hrDashboardService } from '@/server/services/hr-dashboard.service'
import { hrRequestService } from '@/server/services/hr-request.service'
import { internHrService } from '@/server/services/intern-hr.service'
import { internService } from '@/server/services/intern.service'
import { leaveService } from '@/server/services/leave.service'
import { offboardingService } from '@/server/services/offboarding.service'
import { hrSettingsService } from '@/server/services/settings.service'
import { contextFor, meta, prisma, uniqueSuffix, useFakeAuth } from './helpers'

beforeAll(() => {
  useFakeAuth()
})
afterAll(async () => {
  setAuthProviderForTesting(null)
  await prisma.$disconnect()
})

const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
const pdf = (name = 'doc.pdf') => ({ name, type: 'application/pdf', bytes: PDF })
const TZ = 'Asia/Kolkata'

let intern: RequestContext // Aanya — managed by Vikram (devManager), mentored by Priya
let manager: RequestContext // Arjun — manages Ishaan, Zara, Tara (not Aanya)
let mentor: RequestContext // Rohan
let hr: RequestContext
let admin: RequestContext
let aanyaInternId: string
let taraInternId: string
let taraUserId: string

beforeAll(async () => {
  intern = await contextFor('intern@ayavacreatives.com')
  manager = await contextFor('manager@ayavacreatives.com')
  mentor = await contextFor('mentor@ayavacreatives.com')
  hr = await contextFor('hr@ayavacreatives.com')
  admin = await contextFor('admin@ayavacreatives.com')
  aanyaInternId = (await internService.myInternId(intern))!
  const tara = await prisma.intern.findFirstOrThrow({
    where: { employee_code: 'AYV-INT-0005' },
    select: { id: true, user_id: true },
  })
  taraInternId = tara.id
  taraUserId = tara.user_id
})

const today = () => todayIn(TZ)

/** A Monday–Friday week at least `weeksAhead` weeks away with no holidays in it. */
async function clearWeek(weeksAhead: number) {
  let monday = addDays(today(), 7 * weeksAhead)
  while (monday.getUTCDay() !== 1) monday = addDays(monday, 1)
  for (;;) {
    const friday = addDays(monday, 4)
    const holidays = await prisma.holiday.count({ where: { date: { gte: monday, lte: friday } } })
    if (!holidays) return { monday, friday }
    monday = addDays(monday, 7)
  }
}

describe('attendance', () => {
  it('checks in and out with server timestamps, breaks and a computed status', async () => {
    await prisma.attendance.deleteMany({ where: { user_id: intern.actor.userId, date: today() } })
    const before = Date.now()
    await attendanceService.checkIn(intern, meta())
    await expect(attendanceService.checkIn(intern, meta())).rejects.toBeInstanceOf(ConflictError)

    await attendanceService.startBreak(intern)
    await expect(attendanceService.startBreak(intern)).rejects.toBeInstanceOf(ConflictError)
    await attendanceService.endBreak(intern)
    await attendanceService.checkOut(intern, meta())
    await expect(attendanceService.checkOut(intern, meta())).rejects.toBeInstanceOf(ConflictError)

    const record = await prisma.attendance.findUniqueOrThrow({
      where: { user_id_date: { user_id: intern.actor.userId, date: today() } },
      include: { breaks: true },
    })
    expect(record.check_in_at!.getTime()).toBeGreaterThanOrEqual(before - 1000)
    expect(record.check_out_at).not.toBeNull()
    expect(record.breaks).toHaveLength(1)
    expect(record.total_minutes).toBe(0) // checked out moments later
    expect(record.status).toBe('ABSENT') // less than a half day
    const audit = await prisma.auditLog.count({
      where: { resource_id: record.id, action: AUDIT_ACTIONS.ATTENDANCE_CHECKED_IN },
    })
    expect(audit).toBe(1)

    const month = await attendanceService.month(intern, {})
    expect(month.days.find((d) => d.key === dayKey(today()))?.record?.checkIn).toBeTruthy()
  })

  it('limits attendance to the viewer’s scope', async () => {
    // Interns see only their own; Arjun doesn't manage Aanya.
    await expect(attendanceService.month(intern, { userId: taraUserId })).rejects.toBeInstanceOf(NotFoundError)
    await expect(attendanceService.month(manager, { userId: intern.actor.userId })).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(attendanceService.month(manager, { userId: taraUserId })).resolves.toMatchObject({
      userId: taraUserId,
    })
    await expect(attendanceService.overview(mentor)).rejects.toBeInstanceOf(ForbiddenError)
    const overview = await attendanceService.overview(hr)
    expect(overview.rows.some((r) => r.user.id === intern.actor.userId)).toBe(true)
    const managerView = await attendanceService.overview(manager)
    expect(managerView.rows.some((r) => r.user.id === intern.actor.userId)).toBe(false)
  })

  it('corrections keep the original times, need an authorized reviewer and are audited', async () => {
    const date = formatDateOnly(today())
    const original = await prisma.attendance.findUniqueOrThrow({
      where: { user_id_date: { user_id: intern.actor.userId, date: today() } },
    })
    const correction = await attendanceService.requestCorrection(intern, {
      date,
      category: 'WRONG_TIME',
      checkIn: '09:55',
      checkOut: '18:30',
      reason: 'Checked out by mistake while testing',
    })
    await expect(
      attendanceService.requestCorrection(intern, {
        date,
        category: 'OTHER',
        checkOut: '18:00',
        reason: 'Again please',
      }),
    ).rejects.toBeInstanceOf(ConflictError)
    await expect(
      attendanceService.requestCorrection(intern, {
        date: formatDateOnly(addDays(today(), 1)),
        category: 'OTHER',
        checkIn: '10:00',
        reason: 'Future',
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    // The intern can't review; a manager of other interns can't see it; rejection needs a reason.
    await expect(
      attendanceService.reviewCorrection(intern, { correctionId: correction.id, decision: 'APPROVED' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      attendanceService.reviewCorrection(manager, { correctionId: correction.id, decision: 'APPROVED' }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      attendanceService.reviewCorrection(hr, { correctionId: correction.id, decision: 'REJECTED' }),
    ).rejects.toBeInstanceOf(ValidationError)

    await attendanceService.reviewCorrection(hr, { correctionId: correction.id, decision: 'APPROVED', comment: 'OK' })
    const stored = await prisma.attendanceCorrection.findUniqueOrThrow({ where: { id: correction.id } })
    expect(stored.status).toBe('APPROVED')
    expect(stored.original_check_in?.getTime()).toBe(original.check_in_at?.getTime())
    const updated = await prisma.attendance.findUniqueOrThrow({ where: { id: original.id } })
    expect(updated.source).toBe('CORRECTION')
    expect(updated.status).toBe('PRESENT')
    expect(updated.total_minutes).toBeGreaterThan(400)
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { resource_id: correction.id, action: AUDIT_ACTIONS.ATTENDANCE_CORRECTION_APPROVED },
    })
    expect(audit.metadata).toMatchObject({ before: expect.any(Object), after: expect.any(Object) })
    const notified = await prisma.notification.count({
      where: { user_id: intern.actor.userId, type: 'ATTENDANCE_CORRECTION_APPROVED', related_entity_id: correction.id },
    })
    expect(notified).toBe(1)
    await expect(
      attendanceService.reviewCorrection(hr, { correctionId: correction.id, decision: 'APPROVED' }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('HR manual edits require a reason and never target yourself', async () => {
    const yesterday = formatDateOnly(addDays(today(), -1))
    await expect(
      attendanceService.hrUpdate(hr, { userId: intern.actor.userId, date: yesterday, status: 'ABSENT', reason: '' }),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      attendanceService.hrUpdate(manager, {
        userId: taraUserId,
        date: yesterday,
        status: 'ABSENT',
        reason: 'x'.repeat(5),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await attendanceService.hrUpdate(hr, {
      userId: taraUserId,
      date: yesterday,
      checkIn: '10:00',
      checkOut: '18:00',
      reason: 'Badge log',
    })
    const row = await prisma.attendance.findUniqueOrThrow({
      where: { user_id_date: { user_id: taraUserId, date: addDays(today(), -1) } },
    })
    expect(row).toMatchObject({ source: 'HR', status: 'PRESENT' })
  })
})

describe('leave', () => {
  let leaveTypes: Awaited<ReturnType<typeof leaveService.types>>
  const typeId = (slug: string) => leaveTypes.find((t) => t.slug === slug)!.id
  beforeAll(async () => {
    leaveTypes = await leaveService.types(intern)
  })

  it('counts working days, blocks overlaps and enforces the balance', async () => {
    const { monday } = await clearWeek(3)
    const friday = addDays(monday, -3)
    // Friday → Monday spans a weekend: 2 working days (if the Friday isn't a holiday).
    const fridayHoliday = await prisma.holiday.count({ where: { date: friday } })
    const request = await leaveService.request(intern, {
      leaveTypeId: typeId('casual'),
      startDate: formatDateOnly(friday),
      endDate: formatDateOnly(monday),
      reason: 'Long weekend trip',
    })
    expect(request).toMatchObject({ status: 'PENDING', days: fridayHoliday ? 1 : 2 })

    await expect(
      leaveService.request(intern, {
        leaveTypeId: typeId('sick'),
        startDate: formatDateOnly(monday),
        endDate: formatDateOnly(monday),
        reason: 'Overlap',
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    const later = await clearWeek(6)
    await expect(
      leaveService.request(intern, {
        leaveTypeId: typeId('casual'),
        startDate: formatDateOnly(later.monday),
        endDate: formatDateOnly(addDays(later.monday, 3)),
        reason: 'Four more days',
      }),
    ).resolves.toMatchObject({ days: 4 })
    // 2 + 4 pending = all 6 casual days: one more fails on balance.
    const third = await clearWeek(9)
    await expect(
      leaveService.request(intern, {
        leaveTypeId: typeId('casual'),
        startDate: formatDateOnly(third.monday),
        endDate: formatDateOnly(third.monday),
        reason: 'One more',
      }),
    ).rejects.toThrow(/Not enough casual leave left: 0 day/)

    await expect(
      leaveService.request(intern, {
        leaveTypeId: typeId('casual'),
        startDate: formatDateOnly(addDays(today(), -30)),
        endDate: formatDateOnly(addDays(today(), -30)),
        reason: 'Backdated',
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    const mine = await leaveService.mine(intern)
    const casual = mine.balances.find((b) => b.type.slug === 'casual')!
    expect(casual).toMatchObject({ allocated: 6, used: 0, unlimited: false })
    expect(casual.pending).toBeGreaterThanOrEqual(6)
    expect(mine.balances.find((b) => b.type.slug === 'academic')).toMatchObject({ unlimited: true, remaining: null })
  })

  it('approval: scoped, never your own, notifies the requester; cancellation returns days', async () => {
    const pending = await prisma.leaveRequest.findFirstOrThrow({
      where: { user_id: intern.actor.userId, status: 'PENDING' },
      orderBy: { start_date: 'asc' },
    })
    await expect(leaveService.review(intern, { leaveId: pending.id, decision: 'APPROVED' })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    await expect(leaveService.review(manager, { leaveId: pending.id, decision: 'APPROVED' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(leaveService.review(hr, { leaveId: pending.id, decision: 'REJECTED' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    await leaveService.review(hr, { leaveId: pending.id, decision: 'APPROVED', comment: 'Enjoy' })
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('APPROVED')
    expect(
      await prisma.notification.count({
        where: { user_id: intern.actor.userId, type: 'LEAVE_APPROVED', related_entity_id: pending.id },
      }),
    ).toBe(1)
    await expect(leaveService.review(hr, { leaveId: pending.id, decision: 'APPROVED' })).rejects.toBeInstanceOf(
      ConflictError,
    )

    // Future approved leave can be cancelled by the requester.
    await leaveService.cancel(intern, pending.id)
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('CANCELLED')
  })

  it('blocks self-approval even for people who can approve', async () => {
    const week = await clearWeek(12)
    const own = await leaveService.request(admin, {
      leaveTypeId: typeId('sick'),
      startDate: formatDateOnly(week.monday),
      endDate: formatDateOnly(week.monday),
      reason: 'Admin leave',
    })
    await expect(leaveService.review(admin, { leaveId: own.id, decision: 'APPROVED' })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('HR can record overlapping leave only with an audited override reason', async () => {
    const approved = await prisma.leaveRequest.findFirstOrThrow({ where: { user_id: taraUserId, status: 'APPROVED' } })
    const input = {
      userId: taraUserId,
      leaveTypeId: typeId('unpaid'),
      startDate: formatDateOnly(approved.start_date),
      endDate: formatDateOnly(approved.end_date),
      reason: 'Extension',
    }
    await expect(leaveService.request(hr, input)).rejects.toBeInstanceOf(ValidationError)
    await expect(leaveService.request(manager, { ...input, overrideReason: 'Nope' })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    const { id } = await leaveService.request(hr, { ...input, overrideReason: 'Agreed with manager' })
    const row = await prisma.leaveRequest.findUniqueOrThrow({ where: { id } })
    expect(row).toMatchObject({
      overlap_override: true,
      override_reason: 'Agreed with manager',
      created_by: hr.actor.userId,
    })
    expect(
      await prisma.auditLog.count({ where: { resource_id: id, action: AUDIT_ACTIONS.LEAVE_OVERLAP_OVERRIDDEN } }),
    ).toBe(1)
  })
})

describe('documents', () => {
  it('versions uploads, verifies with an authorized reviewer and tracks completion', async () => {
    const types = await documentService.activeTypes(intern)
    const offer = types.find((t) => t.name === 'Signed offer letter')!
    const first = await documentService.upload(
      intern,
      { internId: aanyaInternId, documentTypeId: offer.id },
      pdf('offer.pdf'),
      meta(),
    )
    const second = await documentService.upload(
      intern,
      { internId: aanyaInternId, documentTypeId: offer.id },
      pdf('offer-v2.pdf'),
      meta(),
    )
    expect(second.version).toBe(2)
    const v1 = await prisma.internshipDocument.findUniqueOrThrow({ where: { id: first.id } })
    expect(v1.is_current).toBe(false)

    await expect(documentService.review(intern, { documentId: second.id, decision: 'VERIFY' })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    await expect(documentService.review(hr, { documentId: second.id, decision: 'REJECT' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    await documentService.review(hr, { documentId: second.id, decision: 'VERIFY' })
    const list = await documentService.listForIntern(intern, aanyaInternId)
    expect(list.requirements.find((r) => r.type.id === offer.id)?.status).toBe('VERIFIED')
    expect(list.history.map((d) => d.id)).toContain(first.id)
    expect(list.completion.verified).toBeGreaterThanOrEqual(1)
    expect(
      await prisma.notification.count({
        where: { user_id: intern.actor.userId, type: 'DOCUMENT_VERIFIED', related_entity_id: second.id },
      }),
    ).toBe(1)
    await expect(documentService.review(hr, { documentId: second.id, decision: 'VERIFY' })).rejects.toBeInstanceOf(
      ConflictError,
    )
  })

  it('hides sensitive document types from people without sensitive access', async () => {
    const idType = (await documentService.activeTypes(hr)).find((t) => t.is_sensitive)!
    const { id } = await documentService.upload(
      hr,
      {
        internId: taraInternId,
        documentTypeId: idType.id,
        visibility: 'INTERN',
        expiresAt: formatDateOnly(addDays(today(), 400)),
      },
      pdf('id.pdf'),
      meta(),
    )
    const managerView = await documentService.listForIntern(manager, taraInternId)
    expect(managerView.documents.map((d) => d.id)).not.toContain(id)
    await expect(documentService.download(manager, id)).rejects.toBeInstanceOf(NotFoundError)
    const hrView = await documentService.listForIntern(hr, taraInternId)
    expect(hrView.documents.map((d) => d.id)).toContain(id)
    await documentService.download(hr, id)
    expect(
      await prisma.auditLog.count({ where: { resource_id: id, action: AUDIT_ACTIONS.SENSITIVE_DOCUMENT_ACCESSED } }),
    ).toBe(1)
    // Expiry is only accepted for types that have one.
    const resume = (await documentService.activeTypes(hr)).find((t) => !t.has_expiry)!
    await expect(
      documentService.upload(
        hr,
        { internId: taraInternId, documentTypeId: resume.id, expiresAt: '2030-01-01' },
        pdf(),
        meta(),
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('keeps the verification queue to people with document.verify', async () => {
    await expect(documentService.queue(manager, {})).rejects.toBeInstanceOf(ForbiddenError)
    const queue = await documentService.queue(hr, { status: 'PENDING' })
    expect(queue.page.items.every((d) => d.status === 'UPLOADED' || d.status === 'UNDER_REVIEW')).toBe(true)
  })
})

describe('HR requests', () => {
  it('requester ↔ HR conversation with status changes; others can’t see it', async () => {
    const { id } = await hrRequestService.create(intern, {
      category: 'EXPERIENCE_LETTER',
      subject: `Letter ${uniqueSuffix()}`,
      description: 'For my college.',
    })
    await expect(hrRequestService.get(mentor, id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(hrRequestService.transition(intern, { requestId: id, to: 'RESOLVED' })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    await expect(hrRequestService.transition(hr, { requestId: id, to: 'WAITING_FOR_USER' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    await hrRequestService.transition(hr, {
      requestId: id,
      to: 'WAITING_FOR_USER',
      note: 'Which address should it go to?',
    })
    await hrRequestService.comment(intern, { requestId: id, body: 'My college office, please.' })
    expect((await prisma.hrRequest.findUniqueOrThrow({ where: { id } })).status).toBe('IN_REVIEW')
    await hrRequestService.transition(hr, { requestId: id, to: 'RESOLVED', note: 'Sent.' })
    const view = await hrRequestService.get(intern, id)
    expect(view).toMatchObject({ status: 'RESOLVED', resolution: 'Sent.' })
    expect(view.can.comment).toBe(false)
    expect(view.comments.length).toBe(3)
    expect(
      await prisma.notification.count({
        where: { user_id: intern.actor.userId, type: 'HR_REQUEST_UPDATED', related_entity_id: id },
      }),
    ).toBe(2)
  })
})

describe('announcements', () => {
  it('reaches only the targeted audience and notifies it once', async () => {
    const title = `Just for Aanya ${uniqueSuffix()}`
    const { id } = await announcementService.save(hr, {
      title,
      body: 'Hello',
      category: 'HR',
      audience: 'SPECIFIC',
      audienceIds: intern.actor.userId,
      intent: 'PUBLISH',
    })
    expect((await announcementService.listActive(intern, 50)).map((a) => a.id)).toContain(id)
    expect((await announcementService.listActive(mentor, 50)).map((a) => a.id)).not.toContain(id)
    expect(await prisma.notification.count({ where: { related_entity_id: id } })).toBe(1)
    await expect(
      announcementService.save(intern, {
        title: 'x'.repeat(5),
        body: 'y',
        category: 'HR',
        audience: 'EVERYONE',
        intent: 'PUBLISH',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('publishes scheduled announcements when they are due', async () => {
    const tomorrow = formatDateOnly(addDays(today(), 1))
    const { id } = await announcementService.save(hr, {
      title: `Scheduled ${uniqueSuffix()}`,
      body: 'Later',
      category: 'COMPANY',
      audience: 'EVERYONE',
      intent: 'SCHEDULE',
      publishAt: `${tomorrow}T09:00`,
    })
    expect((await announcementService.listActive(intern, 50)).map((a) => a.id)).not.toContain(id)
    await announcementJobs.publishDue(new Date(Date.now() + 3 * 86_400_000))
    expect((await prisma.announcement.findUniqueOrThrow({ where: { id } })).status).toBe('PUBLISHED')
  })
})

describe('holidays, settings, compensation, offboarding, exports and dashboard', () => {
  it('holidays are unique per date and HR-managed', async () => {
    const date = formatDateOnly(addDays(today(), 200))
    await holidayService.save(hr, { date, name: 'Test holiday' })
    await expect(holidayService.save(hr, { date, name: 'Duplicate' })).rejects.toBeInstanceOf(ConflictError)
    await expect(
      holidayService.save(intern, { date: formatDateOnly(addDays(today(), 201)), name: 'Mine' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('HR settings are validated, HR-only and audited with before/after', async () => {
    await expect(
      hrSettingsService.update(intern, { section: 'leave', backdateDays: '3', maxRequestDays: '20' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      hrSettingsService.update(hr, {
        section: 'attendance',
        workStart: '10:00',
        graceMinutes: '15',
        fullDayMinutes: '200',
        halfDayMinutes: '300',
        workingDays: '1,2,3,4,5',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    await hrSettingsService.update(hr, { section: 'leave', backdateDays: '5', maxRequestDays: '30' })
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: AUDIT_ACTIONS.HR_SETTING_UPDATED },
      orderBy: { created_at: 'desc' },
    })
    expect(entry.metadata).toMatchObject({ section: 'leave', before: { backdateDays: 7 }, after: { backdateDays: 5 } })
    await hrSettingsService.update(hr, { section: 'leave', backdateDays: '7', maxRequestDays: '30' })
  })

  it('compensation is restricted to compensation permissions', async () => {
    await expect(internHrService.record(manager, taraInternId)).rejects.toBeInstanceOf(ForbiddenError)
    const own = await internHrService.record(intern, aanyaInternId)
    expect(own.compensation).toBeNull()
    await expect(
      internHrService.updateCompensation(intern, { internId: aanyaInternId, amount: '99999' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await internHrService.updateCompensation(hr, {
      internId: taraInternId,
      amount: '11000',
      currency: 'INR',
      frequency: 'MONTHLY',
    })
    expect((await internHrService.record(hr, taraInternId)).compensation).toMatchObject({
      amount: 11000,
      currency: 'INR',
    })
    expect(
      await prisma.auditLog.count({ where: { action: AUDIT_ACTIONS.COMPENSATION_UPDATED } }),
    ).toBeGreaterThanOrEqual(1)
  })

  it('offboarding: one checklist per intern, HR-managed', async () => {
    await expect(offboardingService.start(hr, taraInternId)).rejects.toBeInstanceOf(ConflictError)
    await expect(offboardingService.start(intern, aanyaInternId)).rejects.toBeInstanceOf(ForbiddenError)
    const ending = await offboardingService.endingSoon(hr, '30')
    expect(ending.rows.some((r) => r.id === taraInternId && r.checklist)).toBe(true)
    await expect(offboardingService.endingSoon(intern)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('exports need export permissions and neutralize formulas', async () => {
    await expect(attendanceService.exportCsv(manager, {})).rejects.toBeInstanceOf(ForbiddenError)
    await expect(internService.exportCsv(intern, {})).rejects.toBeInstanceOf(ForbiddenError)
    await prisma.leaveRequest.updateMany({
      where: { user_id: taraUserId, status: 'APPROVED' },
      data: { reason: '=HYPERLINK("x")' },
    })
    const { csv } = await leaveService.exportCsv(hr, {})
    expect(csv.startsWith('﻿Employee code,')).toBe(true)
    expect(csv).not.toMatch(/,=HYPERLINK/)
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(await prisma.auditLog.count({ where: { action: AUDIT_ACTIONS.EXPORT_GENERATED } })).toBeGreaterThanOrEqual(1)
  })

  it('HR dashboard and analytics are HR-only and factual', async () => {
    await expect(hrDashboardService.overview(intern)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(hrDashboardService.overview(manager)).rejects.toBeInstanceOf(ForbiddenError)
    const overview = await hrDashboardService.overview(hr)
    expect(overview.kpis.total).toBeGreaterThan(0)
    expect(overview.kpis.pendingLeave).toBe(
      await prisma.leaveRequest.count({ where: { status: 'PENDING', user_id: { not: hr.actor.userId } } }),
    )
    const calendar = await hrDashboardService.calendar(hr)
    expect(calendar.days.length).toBeGreaterThanOrEqual(28)
    const analytics = await hrDashboardService.analytics(hr)
    expect(analytics.interns.byStatus.reduce((s, i) => s + i.value, 0)).toBe(overview.kpis.total)
  })
})
