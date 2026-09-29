import { setAuthProviderForTesting } from '@/lib/auth/provider'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { addDays, formatDateOnly, todayIn } from '@/lib/interns/dates'
import type { RequestContext } from '@/server/context'
import { domainEvents } from '@/server/events/domain-events'
import { AUDIT_ACTIONS } from '@/server/services/audit-actions'
import { documentService } from '@/server/services/document.service'
import { internLifecycleService } from '@/server/services/intern-lifecycle.service'
import { internService } from '@/server/services/intern.service'
import { onboardingService } from '@/server/services/onboarding.service'
import type { FakeAuthProvider } from './fake-auth'
import { contextFor, createUser, meta, prisma, uniqueSuffix, useFakeAuth } from './helpers'

let fake: FakeAuthProvider
beforeEach(() => {
  fake = useFakeAuth()
})

afterAll(async () => {
  setAuthProviderForTesting(null)
  domainEvents.reset()
  await prisma.$disconnect()
})

const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
const pdf = (name = 'file.pdf') => ({ name, type: 'application/pdf', bytes: PDF })

let hr: RequestContext
let placement: { departmentId: string; positionId: string; teamId: string }
let staff: { manager: string; mentor: string }

beforeAll(async () => {
  hr = await contextFor('hr@ayavacreatives.com')
  const department = await prisma.department.findFirstOrThrow({ where: { slug: 'development' } })
  const position = await prisma.position.findFirstOrThrow({ where: { slug: 'web-development-intern' } })
  const team = await prisma.team.findFirstOrThrow({ where: { slug: 'web-squad' } })
  placement = { departmentId: department.id, positionId: position.id, teamId: team.id }
  const manager = await prisma.user.findFirstOrThrow({ where: { email: 'manager@ayavacreatives.com' } })
  const mentor = await prisma.user.findFirstOrThrow({ where: { email: 'mentor@ayavacreatives.com' } })
  staff = { manager: manager.id, mentor: mentor.id }
})

function internInput(overrides: Record<string, unknown> = {}) {
  const today = todayIn('Asia/Kolkata')
  return {
    firstName: 'John',
    lastName: 'Doe',
    email: `john.doe.${uniqueSuffix()}@test.ayava.dev`,
    phone: '+91 98000 00000',
    ...placement,
    joiningDate: formatDateOnly(today),
    expectedEndDate: formatDateOnly(addDays(today, 90)),
    workMode: 'HYBRID',
    managerId: staff.manager,
    mentorId: staff.mentor,
    emergencyName: 'Jane Doe',
    emergencyRelationship: 'Sibling',
    emergencyPhone: '+91 98000 00001',
    institution: 'Test University',
    startOnboarding: 'on',
    ...overrides,
  }
}

/** Creates an intern via the service and returns ids plus a context for the intern's own user. */
async function createIntern(overrides: Record<string, unknown> = {}) {
  const result = await internService.create(hr, internInput(overrides), meta())
  const intern = await prisma.intern.findUniqueOrThrow({ where: { id: result.internId }, include: { user: true } })
  return { ...result, intern }
}

/** Activates the intern's (INVITED) account so we can act as them. */
async function actAsIntern(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  const auth = fake.addUser(user.email, `Passphrase-${uniqueSuffix()}-ok`, { confirmed: true })
  await prisma.user.update({
    where: { id: userId },
    data: { status: 'ACTIVE', auth_user_id: auth.id, email_verified_at: new Date() },
  })
  return contextFor(user.email)
}

describe('creating an intern (HR)', () => {
  it('creates every record in one transaction, with audit, timeline and events', async () => {
    const events: string[] = []
    const assigned: string[] = []
    const off = domainEvents.on('intern.created', (event) => void events.push(event.payload.internId))
    const offAssigned = domainEvents.on(
      'onboarding.item_assigned',
      (event) => void assigned.push(event.payload.assigneeId),
    )
    const result = await createIntern({ sendInvitation: 'on' })
    off()
    offAssigned()
    expect(assigned).toEqual(expect.arrayContaining([staff.manager, staff.mentor]))

    expect(result.employeeCode).toMatch(/^AYV-INT-\d{4,}$/)
    expect(result.invitation?.delivery).toBe('link')
    expect(events).toContain(result.internId)

    const intern = await prisma.intern.findUniqueOrThrow({
      where: { id: result.internId },
      include: {
        user: { include: { user_roles: { include: { role: true } } } },
        profile: true,
        emergency_contacts: true,
        internships: { include: { onboarding: { include: { items: true } } } },
      },
    })
    expect(intern.status).toBe('ONBOARDING')
    expect(intern.user.status).toBe('INVITED')
    expect(intern.user.user_roles.map((r) => r.role.slug)).toEqual(['intern'])
    expect(intern.profile?.institution).toBe('Test University')
    expect(intern.emergency_contacts).toHaveLength(1)
    expect(intern.internships).toHaveLength(1)
    const onboarding = intern.internships[0].onboarding!
    expect(onboarding.template_name).toBe('Development Intern Onboarding') // auto-picked by department
    expect(onboarding.items.length).toBeGreaterThan(5)
    // Role-based assignees are resolved from the placement.
    expect(
      onboarding.items.some((item) => item.assigned_role === 'MANAGER' && item.assigned_to === staff.manager),
    ).toBe(true)

    const invitation = await prisma.userInvitation.findFirst({
      where: { user_id: intern.user_id, accepted_at: null, revoked_at: null },
    })
    expect(invitation).not.toBeNull()
    const lifecycle = await prisma.internLifecycleEvent.findMany({ where: { intern_id: intern.id } })
    expect(lifecycle.map((e) => e.event_type).sort()).toEqual(['CREATED', 'INVITATION_SENT', 'ONBOARDING_STARTED'])
    const audit = await prisma.auditLog.findMany({ where: { resource_id: intern.id } })
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([AUDIT_ACTIONS.INTERN_CREATED, AUDIT_ACTIONS.MANAGER_ASSIGNED]),
    )
  })

  it('leaves no partial records when a step fails', async () => {
    const email = `broken.${uniqueSuffix()}@test.ayava.dev`
    const missingTemplate = '00000000-0000-4000-8000-000000000000'
    await expect(
      internService.create(hr, internInput({ email, templateId: missingTemplate }), meta()),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(await prisma.user.findFirst({ where: { email } })).toBeNull()
  })

  it('gives concurrent creations distinct, sequential employee codes', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => internService.create(hr, internInput({ startOnboarding: '' }), meta())),
    )
    const codes = results.map((r) => r.employeeCode)
    expect(new Set(codes).size).toBe(5)
    const numbers = codes.map((code) => Number(code.replace('AYV-INT-', ''))).sort((a, b) => a - b)
    expect(numbers[4] - numbers[0]).toBe(4)
  })

  it('rejects duplicate interns and existing staff emails', async () => {
    const first = await createIntern()
    await expect(
      internService.create(hr, internInput({ email: first.intern.user.email }), meta()),
    ).rejects.toBeInstanceOf(ConflictError)
    await expect(
      internService.create(hr, internInput({ email: 'manager@ayavacreatives.com' }), meta()),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('only HR/Admin can create; managers, mentors and interns cannot', async () => {
    for (const email of ['manager@ayavacreatives.com', 'mentor@ayavacreatives.com', 'intern@ayavacreatives.com']) {
      const ctx = await contextFor(email)
      await expect(internService.create(ctx, internInput(), meta())).rejects.toBeInstanceOf(ForbiddenError)
    }
  })
})

describe('editing and assignment', () => {
  it('rejects mass assignment and lets only HR edit details', async () => {
    const { intern } = await createIntern()
    const base = {
      firstName: 'John',
      lastName: 'Doe',
      ...placement,
      joiningDate: formatDateOnly(intern.joining_date!),
      expectedEndDate: formatDateOnly(addDays(intern.expected_end_date!, 7)),
      workMode: 'REMOTE',
    }
    await expect(internService.updateDetails(hr, intern.id, { ...base, status: 'ACTIVE' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    await expect(internService.updateDetails(hr, intern.id, { ...base, employeeCode: 'HACK' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    await internService.updateDetails(hr, intern.id, base)
    const events = await prisma.internLifecycleEvent.findMany({
      where: { intern_id: intern.id, event_type: 'DATES_CHANGED' },
    })
    expect(events).toHaveLength(1)

    const manager = await contextFor('manager@ayavacreatives.com')
    await expect(internService.updateDetails(manager, intern.id, base)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('assigns a mentor with audit and timeline, and moves open mentor items', async () => {
    const { intern } = await createIntern()
    const newMentor = await createUser(fake, { role: 'mentor' })
    await internService.assign(hr, { internId: intern.id, role: 'mentor', userId: newMentor.user.id })
    const updated = await prisma.intern.findUniqueOrThrow({ where: { id: intern.id } })
    expect(updated.mentor_id).toBe(newMentor.user.id)
    const mentorItems = await prisma.onboardingItem.findMany({
      where: { internship: { intern_id: intern.id }, assigned_role: 'MENTOR' },
    })
    expect(mentorItems.every((item) => item.assigned_to === newMentor.user.id)).toBe(true)
    expect(
      await prisma.auditLog.count({ where: { resource_id: intern.id, action: AUDIT_ACTIONS.MENTOR_ASSIGNED } }),
    ).toBeGreaterThanOrEqual(2)
    expect(
      await prisma.internLifecycleEvent.count({ where: { intern_id: intern.id, event_type: 'MENTOR_ASSIGNED' } }),
    ).toBe(1)
    // Interns can't be assigned as mentors.
    await expect(
      internService.assign(hr, { internId: intern.id, role: 'mentor', userId: intern.user_id }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('interns can edit only their own bio and contact fields', async () => {
    const { intern } = await createIntern()
    const self = await actAsIntern(intern.user_id)
    await internService.updateOwnProfile(self, { bio: 'Hello', city: 'Pune', phone: '+91 91111 11111' })
    const profile = await prisma.internProfile.findUniqueOrThrow({ where: { intern_id: intern.id } })
    expect(profile).toMatchObject({ bio: 'Hello', city: 'Pune' })
    await expect(
      internService.updateOwnProfile(self, { bio: 'x', departmentId: placement.departmentId }),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      internService.updateDetails(self, intern.id, {
        firstName: 'J',
        lastName: 'D',
        ...placement,
        joiningDate: '2026-01-01',
        expectedEndDate: '2026-02-01',
        workMode: 'REMOTE',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('status engine', () => {
  it('enforces the transition table and permissions', async () => {
    const { intern } = await createIntern({ startOnboarding: '' })
    expect(intern.status).toBe('SELECTED')
    await expect(
      internLifecycleService.transitionStatus(hr, { internId: intern.id, to: 'ACTIVE' }),
    ).rejects.toBeInstanceOf(ValidationError)
    const manager = await contextFor('manager@ayavacreatives.com')
    await expect(
      internLifecycleService.transitionStatus(manager, { internId: intern.id, to: 'ONBOARDING' }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    // SELECTED → ONBOARDING generates the checklist.
    await internLifecycleService.transitionStatus(hr, { internId: intern.id, to: 'ONBOARDING' })
    expect(await prisma.onboarding.count({ where: { internship: { intern_id: intern.id } } })).toBe(1)

    await expect(
      internLifecycleService.transitionStatus(hr, { internId: intern.id, to: 'TERMINATED' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('blocks activation until onboarding is complete unless HR overrides with a reason', async () => {
    const { intern } = await createIntern()
    await expect(internLifecycleService.transitionStatus(hr, { internId: intern.id, to: 'ACTIVE' })).rejects.toThrow(
      /Onboarding isn’t finished/,
    )
    await expect(
      internLifecycleService.transitionStatus(hr, { internId: intern.id, to: 'ACTIVE', override: 'on' }),
    ).rejects.toBeInstanceOf(ValidationError)
    await internLifecycleService.transitionStatus(hr, {
      internId: intern.id,
      to: 'ACTIVE',
      override: 'on',
      reason: 'Starts on client project today',
    })
    const updated = await prisma.intern.findUniqueOrThrow({ where: { id: intern.id }, include: { internships: true } })
    expect(updated.status).toBe('ACTIVE')
    expect(updated.internships[0].status).toBe('ACTIVE')
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { resource_id: intern.id, action: AUDIT_ACTIONS.STATUS_CHANGED },
    })
    expect(audit.metadata).toMatchObject({ from: 'ONBOARDING', to: 'ACTIVE', override: true })
  })

  it('ending-soon job is idempotent and respects HR extensions', async () => {
    const today = todayIn('Asia/Kolkata')
    const { intern } = await createIntern({
      joiningDate: formatDateOnly(addDays(today, -80)),
      expectedEndDate: formatDateOnly(addDays(today, 5)),
    })
    await internLifecycleService.transitionStatus(hr, {
      internId: intern.id,
      to: 'ACTIVE',
      override: 'on',
      reason: 'test',
    })

    const first = await internLifecycleService.markEndingSoon({ organizationId: intern.organization_id })
    expect(first.marked).toBeGreaterThanOrEqual(1)
    expect((await prisma.intern.findUniqueOrThrow({ where: { id: intern.id } })).status).toBe('ENDING_SOON')
    const second = await internLifecycleService.markEndingSoon({ organizationId: intern.organization_id })
    expect(second.marked).toBe(0)

    // HR moves them back (extension pending); the job must not flip them again for the same end date.
    await internLifecycleService.transitionStatus(hr, {
      internId: intern.id,
      to: 'ACTIVE',
      reason: 'Extension being discussed',
    })
    await internLifecycleService.markEndingSoon({ organizationId: intern.organization_id })
    expect((await prisma.intern.findUniqueOrThrow({ where: { id: intern.id } })).status).toBe('ACTIVE')
  })
})

describe('onboarding', () => {
  it('intern completes own items; completion records an event but does not activate', async () => {
    const { intern } = await createIntern()
    const self = await actAsIntern(intern.user_id)
    const completed: string[] = []
    const off = domainEvents.on('onboarding.completed', (event) => void completed.push(event.payload.internId))

    const checklist = await onboardingService.getChecklist(self, intern.id)
    const managerItem = checklist.items.find((item) => item.assigned_role === 'MANAGER')!
    expect(managerItem.canComplete).toBe(false)
    await expect(onboardingService.completeItem(self, managerItem.id)).rejects.toBeInstanceOf(ForbiddenError)

    for (const item of checklist.items) {
      if (item.assigned_to !== self.actor.userId) {
        await onboardingService.completeItem(hr, item.id) // HR can complete anything
      } else if (item.item_type === 'DOCUMENT') {
        await documentService.upload(
          self,
          { internId: intern.id, documentType: item.required_document_type ?? 'OTHER', onboardingItemId: item.id },
          pdf(),
          meta(),
        )
      } else if (item.item_type === 'ACKNOWLEDGEMENT') {
        await onboardingService.acknowledgeItem(self, item.id, meta())
      } else {
        await onboardingService.completeItem(self, item.id)
      }
    }
    off()

    const after = await onboardingService.getChecklist(hr, intern.id)
    expect(after.progress.complete).toBe(true)
    expect(after.onboarding?.completed_at).not.toBeNull()
    expect(completed).toContain(intern.id)
    expect((await prisma.intern.findUniqueOrThrow({ where: { id: intern.id } })).status).toBe('ONBOARDING')
    expect(
      await prisma.internLifecycleEvent.count({ where: { intern_id: intern.id, event_type: 'ONBOARDING_COMPLETED' } }),
    ).toBe(1)

    // Acknowledgements are stored per policy version.
    const acks = await prisma.documentAcknowledgement.findMany({ where: { user_id: intern.user_id } })
    expect(acks.length).toBeGreaterThanOrEqual(2)
    expect(acks.every((ack) => ack.policy_version === 1)).toBe(true)

    // Now HR can activate without an override.
    await internLifecycleService.transitionStatus(hr, { internId: intern.id, to: 'ACTIVE' })
  })

  it('only the intern acknowledges their policies; HR controls require a reason to waive', async () => {
    const { intern } = await createIntern()
    const checklist = await onboardingService.getChecklist(hr, intern.id)
    const ack = checklist.items.find((item) => item.item_type === 'ACKNOWLEDGEMENT')!
    await expect(onboardingService.acknowledgeItem(hr, ack.id, meta())).rejects.toBeInstanceOf(ForbiddenError)
    const required = checklist.items.find((item) => item.required && item.item_type === 'TASK')!
    await expect(onboardingService.setItemStatus(hr, { itemId: required.id, action: 'skip' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    await onboardingService.setItemStatus(hr, {
      itemId: required.id,
      action: 'skip',
      reason: 'Covered by previous work',
    })
    await onboardingService.setItemStatus(hr, { itemId: required.id, action: 'block', reason: 'Waiting on laptop' })
    const row = await prisma.onboardingItem.findUniqueOrThrow({ where: { id: required.id } })
    expect(row).toMatchObject({ status: 'BLOCKED', blocked_reason: 'Waiting on laptop' })
  })
})

describe('documents: visibility and access', () => {
  it('applies the visibility matrix to lists and downloads', async () => {
    const { intern } = await createIntern()
    const self = await actAsIntern(intern.user_id)
    const manager = await contextFor('manager@ayavacreatives.com')
    const mentor = await contextFor('mentor@ayavacreatives.com')
    const admin = await contextFor('admin@ayavacreatives.com')

    // Intern uploads: ID documents default to HR-only; the intern still sees what they uploaded.
    const id = await documentService.upload(
      self,
      { internId: intern.id, documentType: 'ID_DOCUMENT' },
      pdf('id.pdf'),
      meta(),
    )
    const resume = await documentService.upload(
      self,
      { internId: intern.id, documentType: 'RESUME' },
      pdf('cv.pdf'),
      meta(),
    )
    // Interns can't choose visibility.
    await expect(
      documentService.upload(self, { internId: intern.id, documentType: 'OTHER', visibility: 'INTERN' }, pdf(), meta()),
    ).resolves.toBeDefined()
    const hrOnly = await documentService.upload(
      hr,
      { internId: intern.id, documentType: 'OFFER_LETTER', visibility: 'HR' },
      pdf('offer.pdf'),
      meta(),
    )
    const adminOnly = await documentService.upload(
      admin,
      { internId: intern.id, documentType: 'OTHER', visibility: 'ADMIN' },
      pdf('restricted.pdf'),
      meta(),
    )
    await expect(
      documentService.upload(hr, { internId: intern.id, documentType: 'OTHER', visibility: 'ADMIN' }, pdf(), meta()),
    ).rejects.toBeInstanceOf(ForbiddenError)

    const idsFor = async (ctx: RequestContext) =>
      (await documentService.listForIntern(ctx, intern.id)).documents.map((doc) => doc.id)
    expect(await idsFor(self)).toEqual(expect.arrayContaining([id.id, resume.id]))
    expect(await idsFor(self)).not.toContain(hrOnly.id)
    expect(await idsFor(hr)).toEqual(expect.arrayContaining([id.id, resume.id, hrOnly.id]))
    expect(await idsFor(hr)).not.toContain(adminOnly.id)
    expect(await idsFor(admin)).toContain(adminOnly.id)
    // Managers see only their assigned interns' intern/manager-level documents.
    expect(await idsFor(manager)).toContain(resume.id)
    expect(await idsFor(manager)).not.toContain(id.id)
    // Mentors have no document access.
    await expect(documentService.listForIntern(mentor, intern.id)).rejects.toBeInstanceOf(ForbiddenError)

    // Hidden documents download as 404, not 403.
    await expect(documentService.download(manager, hrOnly.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(documentService.download(self, hrOnly.id)).rejects.toBeInstanceOf(NotFoundError)
    const file = await documentService.download(hr, hrOnly.id)
    expect(file.fileName).toBe('offer.pdf')

    // Validation: wrong magic bytes are rejected.
    await expect(
      documentService.upload(
        hr,
        { internId: intern.id, documentType: 'OTHER' },
        { name: 'fake.pdf', type: 'application/pdf', bytes: new TextEncoder().encode('not a pdf') },
        meta(),
      ),
    ).rejects.toBeInstanceOf(ValidationError)

    // Deleting: interns cannot; HR can (soft delete).
    await expect(documentService.remove(self, resume.id, meta())).rejects.toBeInstanceOf(ForbiddenError)
    await documentService.remove(hr, resume.id, meta())
    expect(await idsFor(hr)).not.toContain(resume.id)
  })
})

describe('scope and IDOR', () => {
  it('managers and mentors see only their own interns; other ids are 404', async () => {
    const other = await createIntern({ managerId: '', mentorId: '' })
    const manager = await contextFor('manager@ayavacreatives.com')
    const mentor = await contextFor('mentor@ayavacreatives.com')
    await expect(internService.getProfile(manager, other.internId)).rejects.toBeInstanceOf(NotFoundError)
    await expect(internService.getProfile(mentor, other.internId)).rejects.toBeInstanceOf(NotFoundError)
    await expect(onboardingService.getChecklist(mentor, other.internId)).rejects.toBeInstanceOf(NotFoundError)

    const managed = await internService.related(manager, 'managed')
    expect(managed.length).toBeGreaterThan(0)
    expect(managed.every((row) => row.manager?.id === manager.actor.userId)).toBe(true)
    const directory = await internService.directory(manager, {})
    expect(directory.page.items.some((row) => row.id === other.internId)).toBe(false)

    // Mentor sees contact details masked and no emergency contacts.
    const mentee = managed.find((row) => row.mentor?.id === mentor.actor.userId)
    if (mentee) {
      const view = await internService.getProfile(mentor, mentee.id)
      expect(view.emergencyContacts).toBeNull()
      expect(view.can.editDetails).toBe(false)
    }
  })

  it('interns cannot open the directory or another intern', async () => {
    const { intern } = await createIntern()
    const self = await actAsIntern(intern.user_id)
    await expect(internService.directory(self, {})).rejects.toBeInstanceOf(ForbiddenError)
    const aanya = await prisma.intern.findFirstOrThrow({ where: { user: { email: 'intern@ayavacreatives.com' } } })
    await expect(internService.getProfile(self, aanya.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(documentService.listForIntern(self, aanya.id)).rejects.toBeInstanceOf(NotFoundError)
  })
})
