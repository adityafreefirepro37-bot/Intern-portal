import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import type { RequestContext } from '@/server/context'
import { AUDIT_ACTIONS } from '@/server/services/audit-actions'
import { certificateJobs, certificateService } from '@/server/services/certificate.service'
import { NOTIFICATION_TYPES } from '@/server/services/notification.service'
import { contextFor, prisma, uniqueSuffix } from './helpers'

let hr: RequestContext
let intern: RequestContext
let mentor: RequestContext
let manager: RequestContext
let internId: string

beforeAll(async () => {
  ;[hr, intern, mentor, manager] = await Promise.all([
    contextFor('hr@ayavacreatives.com'),
    contextFor('intern@ayavacreatives.com'),
    contextFor('mentor@ayavacreatives.com'),
    contextFor('manager@ayavacreatives.com'),
  ])
  internId = (await prisma.intern.findUniqueOrThrow({ where: { user_id: intern.actor.userId }, select: { id: true } })).id
})

describe('certificates', () => {
  it('drafts, issues, verifies publicly and revokes, with the right people seeing the right things', async () => {
    await certificateService.saveSettings(hr, { signatoryName: 'Kavya Nair', signatoryTitle: 'Head of People', autoCourse: 'on' })

    // HR prepares a draft; the text comes from the intern's record.
    const { id } = await certificateService.saveDraft(hr, { internId, type: 'COMPLETION' })
    const draft = await certificateService.get(hr, id)
    expect(draft).toMatchObject({
      status: 'DRAFT',
      recipient_name: 'Aanya Sharma',
      organization_name: 'Ayava Creatives',
      signatory_name: 'Kavya Nair',
      canIssue: true,
      verificationUrl: null,
    })
    expect(draft.certificate_number).toMatch(/^DRAFT-/)

    // Interns never see drafts; mentors and managers hold no certificate permission.
    await expect(certificateService.get(intern, id)).rejects.toBeInstanceOf(NotFoundError)
    expect((await certificateService.mine(intern)).some((c) => c.id === id)).toBe(false)
    await expect(certificateService.list(mentor)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(certificateService.saveDraft(manager, { internId, type: 'COMPLETION' })).rejects.toBeInstanceOf(ForbiddenError)

    // Edit the draft, then issue.
    const citation = `For the landing page rebuild ${uniqueSuffix()}`
    await certificateService.saveDraft(hr, { certificateId: id, type: 'EXCELLENCE', recipientName: 'Aanya Sharma', citation })
    const { number } = await certificateService.issue(hr, id)
    expect(number).toMatch(/^AYV-CERT-\d{4}-\d{4,}$/)
    await expect(certificateService.issue(hr, id)).rejects.toBeInstanceOf(ValidationError)
    await expect(certificateService.saveDraft(hr, { certificateId: id, type: 'COMPLETION' })).rejects.toBeInstanceOf(ValidationError)

    const issued = await certificateService.get(intern, id)
    expect(issued).toMatchObject({ status: 'ISSUED', citation, certificate_type: 'EXCELLENCE', canIssue: false, canRevoke: false })
    expect(issued.verificationCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    const [notice] = await prisma.notification.findMany({
      where: { user_id: intern.actor.userId, type: NOTIFICATION_TYPES.CERTIFICATE_ISSUED, related_entity_id: id },
    })
    expect(notice.title).toContain('excellence certificate')

    // PDF for the intern.
    const pdf = await certificateService.pdf(intern, id)
    expect(Buffer.from(pdf.bytes.subarray(0, 5)).toString()).toBe('%PDF-')
    expect(pdf.filename).toBe(`Aanya-Sharma-${number}.pdf`)

    // Public verification: any formatting of the code works; only certificate facts are returned.
    const code = issued.verificationCode!
    const check = await certificateService.verify(code.toLowerCase().replace(/-/g, ''), '198.51.100.7')
    expect(check).toMatchObject({ valid: true, number, recipientName: 'Aanya Sharma', organizationName: 'Ayava Creatives' })
    expect(Object.keys(check!)).not.toContain('citation')
    expect(await certificateService.verify('AAAA-BBBB-CCCC', '198.51.100.7')).toBeNull()
    expect((await certificateService.get(hr, id)).verificationCount).toBe(1)

    // Revoke: reason required, verification reports it, intern notified, PDF only for HR.
    await expect(certificateService.revoke(hr, { certificateId: id, reason: 'no' })).rejects.toBeInstanceOf(ValidationError)
    await expect(certificateService.revoke(intern, { certificateId: id, reason: 'Issued by mistake' })).rejects.toBeInstanceOf(ForbiddenError)
    await certificateService.revoke(hr, { certificateId: id, reason: 'Issued with the wrong type' })
    expect(await certificateService.verify(code, '198.51.100.7')).toMatchObject({ valid: false, status: 'REVOKED' })
    await expect(certificateService.pdf(intern, id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(certificateService.pdf(hr, id)).resolves.toMatchObject({ filename: expect.stringContaining(number) })
    expect(
      await prisma.notification.count({ where: { user_id: intern.actor.userId, type: NOTIFICATION_TYPES.CERTIFICATE_REVOKED } }),
    ).toBeGreaterThan(0)

    const audit = await prisma.auditLog.findMany({ where: { resource_id: id }, select: { action: true } })
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([AUDIT_ACTIONS.CERTIFICATE_DRAFT_SAVED, AUDIT_ACTIONS.CERTIFICATE_ISSUED, AUDIT_ACTIONS.CERTIFICATE_REVOKED]),
    )
  })

  it('numbers issued certificates in sequence and lets HR delete only drafts', async () => {
    const a = await certificateService.saveDraft(hr, { internId, type: 'PARTICIPATION' })
    const b = await certificateService.saveDraft(hr, { internId, type: 'EXPERIENCE' })
    const first = await certificateService.issue(hr, a.id)
    const second = await certificateService.issue(hr, b.id)
    const seq = (n: string) => Number(n.split('-').pop())
    expect(seq(second.number)).toBe(seq(first.number) + 1)

    await expect(certificateService.deleteDraft(hr, a.id)).rejects.toBeInstanceOf(NotFoundError)
    const c = await certificateService.saveDraft(hr, { internId, type: 'COMPLETION' })
    await certificateService.deleteDraft(hr, c.id)
    await expect(certificateService.get(hr, c.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('issues one course certificate automatically per completed course', async () => {
    const course = await prisma.course.findFirstOrThrow({ where: { organization_id: hr.organization.id }, select: { id: true, title: true } })
    await prisma.certificate.deleteMany({ where: { intern_id: internId, course_id: course.id } })
    const issued = await certificateJobs.issueCourseCertificate(hr.organization.id, { userId: intern.actor.userId, courseId: course.id })
    expect(issued?.number).toMatch(/^AYV-CERT-/)
    expect(await certificateJobs.issueCourseCertificate(hr.organization.id, { userId: intern.actor.userId, courseId: course.id })).toBeNull()
    const mine = await certificateService.mine(intern)
    expect(mine.find((c) => c.id === issued!.id)).toMatchObject({ status: 'ISSUED', course: { title: course.title } })

    // Staff completing a course get no certificate (certificates are for interns).
    expect(await certificateJobs.issueCourseCertificate(hr.organization.id, { userId: mentor.actor.userId, courseId: course.id })).toBeNull()

    // Turned off in settings: nothing is issued.
    await certificateService.saveSettings(hr, { signatoryName: 'Kavya Nair', signatoryTitle: 'Head of People' })
    await prisma.certificate.updateMany({ where: { id: issued!.id }, data: { status: 'REVOKED' } })
    expect(await certificateJobs.issueCourseCertificate(hr.organization.id, { userId: intern.actor.userId, courseId: course.id })).toBeNull()
    await certificateService.saveSettings(hr, { signatoryName: 'Kavya Nair', signatoryTitle: 'Head of People', autoCourse: 'on' })
  })

  it('lists interns who are due a certificate', async () => {
    const candidates = await certificateService.candidates(hr)
    for (const c of candidates) expect(['COMPLETED', 'ALUMNI', 'ENDING_SOON', 'ACTIVE']).toContain(c.status)
    expect(await certificateService.candidates(intern)).toEqual([])
  })
})
