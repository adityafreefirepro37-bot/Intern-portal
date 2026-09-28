import { setAuthProviderForTesting } from '@/lib/auth/provider'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { addDays, formatDateOnly, todayIn } from '@/lib/interns/dates'
import { hashToken } from '@/lib/security/tokens'
import type { RequestContext } from '@/server/context'
import { domainEvents, type DomainEventName } from '@/server/events/domain-events'
import { AUDIT_ACTIONS } from '@/server/services/audit-actions'
import { documentService } from '@/server/services/document.service'
import { internLifecycleService } from '@/server/services/intern-lifecycle.service'
import { internService } from '@/server/services/intern.service'
import { invitationService } from '@/server/services/invitation.service'
import { onboardingTemplateService } from '@/server/services/onboarding-template.service'
import { onboardingService } from '@/server/services/onboarding.service'
import { seedId } from '../../prisma/seed/ids'
import type { FakeAuthProvider } from './fake-auth'
import {
  AYAVA_ORGANIZATION_ID as ORG,
  contextFor,
  createUser,
  meta,
  prisma,
  uniqueSuffix,
  useFakeAuth,
} from './helpers'

/**
 * Phase 03 — intern management, lifecycle, onboarding and documents, against
 * a real database. Mirrors the manual acceptance scenario (Prompt 03 §80) and
 * the security cases (§60–§62, §74–§76).
 */

let fake: FakeAuthProvider
beforeEach(() => {
  fake = useFakeAuth()
})
afterAll(async () => {
  setAuthProviderForTesting(null)
  domainEvents.reset()
  await prisma.$disconnect()
})

const EMAILS = {
  hr: 'hr@ayavacreatives.com',
  admin: 'admin@ayavacreatives.com',
  manager: 'manager@ayavacreatives.com',
  marketingManager: 'marketing.manager@ayavacreatives.com',
  mentor: 'mentor@ayavacreatives.com',
  designMentor: 'design.mentor@ayavacreatives.com',
  intern: 'intern@ayavacreatives.com',
  neel: 'neel.joshi@demo.ayavacreatives.com',
}

const PDF = new Uint8Array(Buffer.from('%PDF-1.4\n% integration test document\n'))

async function userId(email: string) {
  return (await prisma.user.findFirstOrThrow({ where: { organization_id: ORG, email }, select: { id: true } })).id
}

async function internIdFor(email: string) {
  return (await prisma.intern.findFirstOrThrow({ where: { user: { email } }, select: { id: true } })).id
}

function captureEvents(...names: DomainEventName[]) {
  const seen: { name: DomainEventName; payload: Record<string, unknown> }[] = []
  const off = names.map((name) =>
    domainEvents.on(name, (event) => void seen.push({ name, payload: event.payload as Record<string, unknown> })),
  )
  return { seen, stop: () => off.forEach((unsubscribe) => unsubscribe()) }
}

async function auditCount(action: string, resourceId: string) {
  return prisma.auditLog.count({ where: { action, resource_id: resourceId } })
}

/** Creates "John Doe, Digital Marketing Intern" the way HR does in the form. */
async function createJohn(hr: RequestContext, overrides: Record<string, unknown> = {}) {
  const [department, position] = await Promise.all([
    prisma.department.findFirstOrThrow({ where: { organization_id: ORG, slug: 'marketing' } }),
    prisma.position.findFirstOrThrow({ where: { organization_id: ORG, slug: 'digital-marketing-intern' } }),
  ])
  const today = todayIn('Asia/Kolkata')
  const email = `john.doe.${uniqueSuffix()}@example.com`
  const result = await internService.create(
    hr,
    {
      firstName: 'John',
      lastName: 'Doe',
      email,
      phone: '+91 98450 12345',
      positionId: position.id,
      departmentId: department.id,
      joiningDate: formatDateOnly(today),
      expectedEndDate: formatDateOnly(addDays(today, 89)),
      workMode: 'HYBRID',
      location: 'Bengaluru',
      managerId: await userId(EMAILS.marketingManager),
      mentorId: await userId(EMAILS.mentor),
      educationLevel: 'Undergraduate',
      institution: 'Demo University',
      fieldOfStudy: 'Marketing',
      graduationYear: '2026',
      emergencyName: 'Jane Doe',
      emergencyRelationship: 'Parent',
      emergencyPhone: '+91 98450 99999',
      templateId: seedId('template:marketing'),
      startOnboarding: 'on',
      sendInvitation: 'on',
      ...overrides,
    },
    meta(),
  )
  return { ...result, email }
}

/** Accepts John's invitation (fake auth) and returns his request context. */
async function signInAsInvitee(inviteUrl: string, email: string) {
  const token = inviteUrl.split('/invite/')[1]
  await invitationService.accept(
    {
      token,
      firstName: 'John',
      lastName: 'Doe',
      password: 'Correct-Horse-Battery-9',
      confirmPassword: 'Correct-Horse-Battery-9',
    },
    meta(),
  )
  return contextFor(email)
}

// ── Acceptance scenario (§80) ────────────────────────────────────────────────

describe('HR creates an intern end to end', () => {
  it('creates user, intern, profile, emergency contact, internship, onboarding and invitation together', async () => {
    const hr = await contextFor(EMAILS.hr)
    const events = captureEvents(
      'intern.created',
      'onboarding.created',
      'onboarding.item_assigned',
      'invitation.created',
    )
    const john = await createJohn(hr)
    events.stop()

    expect(john.employeeCode).toMatch(/^AYV-INT-\d{4,}$/)
    expect(john.warnings).toEqual([])
    expect(john.invitation?.delivery).toBe('link')

    const intern = await prisma.intern.findUniqueOrThrow({
      where: { id: john.internId },
      include: {
        user: { include: { user_roles: { include: { role: true } } } },
        profile: true,
        emergency_contacts: true,
        internships: { include: { onboarding: { include: { items: true } } } },
      },
    })
    expect(intern.status).toBe('ONBOARDING')
    expect(intern.user).toMatchObject({ email: john.email, status: 'INVITED', first_name: 'John' })
    expect(intern.user.user_roles.map((r) => r.role.slug)).toEqual(['intern'])
    expect(intern.profile).toMatchObject({ institution: 'Demo University', graduation_year: 2026 })
    expect(intern.emergency_contacts).toHaveLength(1)
    expect(intern.internships).toHaveLength(1)
    const internship = intern.internships[0]
    expect(internship).toMatchObject({
      status: 'PLANNED',
      title: 'Digital Marketing Intern internship',
      manager_id: intern.manager_id,
    })
    expect(internship.onboarding?.template_name).toBe('Marketing Intern Onboarding')
    expect(internship.onboarding?.items.length).toBe(14)
    // Due dates come from the start date + the template offset.
    const nda = internship.onboarding!.items.find((item) => item.item_type === 'ACKNOWLEDGEMENT')!
    expect(formatDateOnly(nda.due_date!)).toBe(formatDateOnly(internship.start_date))
    // Manager items go to the manager, mentor items to the mentor.
    const managerItems = internship.onboarding!.items.filter((item) => item.assigned_role === 'MANAGER')
    expect(managerItems.every((item) => item.assigned_to === intern.manager_id)).toBe(true)

    expect(
      await prisma.userInvitation.count({ where: { user_id: intern.user_id, accepted_at: null, revoked_at: null } }),
    ).toBe(1)

    for (const action of [
      AUDIT_ACTIONS.INTERN_CREATED,
      AUDIT_ACTIONS.MANAGER_ASSIGNED,
      AUDIT_ACTIONS.MENTOR_ASSIGNED,
    ]) {
      expect(await auditCount(action, intern.id)).toBe(1)
    }
    expect(await auditCount(AUDIT_ACTIONS.INTERNSHIP_CREATED, internship.id)).toBe(1)
    expect(await auditCount(AUDIT_ACTIONS.ONBOARDING_CREATED, internship.onboarding!.id)).toBe(1)

    const lifecycle = await prisma.internLifecycleEvent.findMany({
      where: { intern_id: intern.id },
      select: { event_type: true },
    })
    expect(lifecycle.map((e) => e.event_type).sort()).toEqual(['CREATED', 'INVITATION_SENT', 'ONBOARDING_STARTED'])

    expect(events.seen.filter((e) => e.name === 'intern.created')).toHaveLength(1)
    expect(events.seen.filter((e) => e.name === 'onboarding.created')).toHaveLength(1)
    expect(events.seen.filter((e) => e.name === 'invitation.created')).toHaveLength(1)
    expect(events.seen.filter((e) => e.name === 'onboarding.item_assigned')).toHaveLength(14)
  })

  it('lets the invited intern sign in and see only their own profile and onboarding', async () => {
    const hr = await contextFor(EMAILS.hr)
    const john = await createJohn(hr)
    const johnCtx = await signInAsInvitee(john.invitation!.inviteUrl!, john.email)

    expect(await internService.myInternId(johnCtx)).toBe(john.internId)
    const profile = await internService.getProfile(johnCtx, john.internId)
    expect(profile).toMatchObject({ relation: { isSelf: true }, phone: '+91 98450 12345', status: 'ONBOARDING' })
    expect(profile.can.editDetails).toBe(false)
    expect(profile.can.transition).toBe(false)
    expect(profile.can.viewActivity).toBe(false)

    const checklist = await onboardingService.getChecklist(johnCtx, john.internId)
    expect(checklist.items).toHaveLength(14)

    const other = await internIdFor(EMAILS.intern)
    await expect(internService.getProfile(johnCtx, other)).rejects.toBeInstanceOf(NotFoundError)
    await expect(onboardingService.getChecklist(johnCtx, other)).rejects.toBeInstanceOf(NotFoundError)
    await expect(internService.directory(johnCtx, {})).rejects.toBeInstanceOf(ForbiddenError)

    const lifecycle = await prisma.internLifecycleEvent.count({
      where: { intern_id: john.internId, event_type: 'INVITATION_ACCEPTED' },
    })
    expect(lifecycle).toBe(1)
  })

  it('updates progress when the intern completes an item, without activating them', async () => {
    const hr = await contextFor(EMAILS.hr)
    const john = await createJohn(hr)
    const johnCtx = await signInAsInvitee(john.invitation!.inviteUrl!, john.email)

    const before = await onboardingService.getChecklist(johnCtx, john.internId)
    const task = before.items.find((item) => item.item_type === 'TASK' && item.canComplete)!
    await onboardingService.completeItem(johnCtx, task.id)
    const after = await onboardingService.getChecklist(johnCtx, john.internId)
    expect(after.progress.requiredDone).toBe(before.progress.requiredDone + 1)
    expect(after.progress.percent).toBeGreaterThan(before.progress.percent)
    expect(await auditCount(AUDIT_ACTIONS.ONBOARDING_ITEM_COMPLETED, task.id)).toBe(1)

    // Items owned by the manager can't be ticked off by the intern.
    const managerItem = after.items.find((item) => item.assigned_role === 'MANAGER')!
    expect(managerItem.canComplete).toBe(false)
    await expect(onboardingService.completeItem(johnCtx, managerItem.id)).rejects.toBeInstanceOf(ForbiddenError)
    // Document and acknowledgement items need the document or the policy.
    const docItem = after.items.find((item) => item.item_type === 'DOCUMENT')!
    await expect(onboardingService.completeItem(johnCtx, docItem.id)).rejects.toBeInstanceOf(ValidationError)
    const ackItem = after.items.find((item) => item.item_type === 'ACKNOWLEDGEMENT')!
    await expect(onboardingService.completeItem(johnCtx, ackItem.id)).rejects.toBeInstanceOf(ValidationError)

    expect((await prisma.intern.findUniqueOrThrow({ where: { id: john.internId } })).status).toBe('ONBOARDING')
  })

  it('lets the manager see John but not an unrelated intern', async () => {
    const hr = await contextFor(EMAILS.hr)
    const john = await createJohn(hr)
    const priya = await contextFor(EMAILS.marketingManager)

    const profile = await internService.getProfile(priya, john.internId)
    expect(profile.relation.isManager).toBe(true)
    expect(profile.phone).toBe('••••••2345') // contact details masked for managers
    expect(profile.emergencyContacts).toBeNull()
    expect(profile.can.editDetails).toBe(false)
    expect((await internService.related(priya, 'managed')).some((row) => row.id === john.internId)).toBe(true)

    // Aanya is managed by Arjun (Development), not Priya.
    await expect(internService.getProfile(priya, await internIdFor(EMAILS.intern))).rejects.toBeInstanceOf(
      NotFoundError,
    )
    const directory = await internService.directory(priya, { pageSize: '100' })
    expect(
      directory.page.items.every(
        (row) => row.manager?.id === priya.actor.userId || row.mentor?.id === priya.actor.userId,
      ),
    ).toBe(true)
  })

  it('records a mentor change in the database, profile, timeline and audit log', async () => {
    const hr = await contextFor(EMAILS.hr)
    const john = await createJohn(hr)
    const sana = await userId(EMAILS.designMentor)
    const events = captureEvents('intern.mentor_assigned', 'onboarding.item_assigned')

    await expect(internService.assign(hr, { internId: john.internId, role: 'mentor', userId: sana })).resolves.toEqual({
      changed: true,
    })
    events.stop()

    expect((await prisma.intern.findUniqueOrThrow({ where: { id: john.internId } })).mentor_id).toBe(sana)
    expect((await internService.getProfile(hr, john.internId)).mentor?.id).toBe(sana)
    const internship = await prisma.internship.findFirstOrThrow({ where: { intern_id: john.internId } })
    expect(internship.mentor_id).toBe(sana)
    const mentorItems = await prisma.onboardingItem.findMany({
      where: { internship_id: internship.id, assigned_role: 'MENTOR' },
    })
    expect(mentorItems.length).toBeGreaterThan(0)
    expect(mentorItems.every((item) => item.assigned_to === sana)).toBe(true)

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: AUDIT_ACTIONS.MENTOR_ASSIGNED, resource_id: john.internId, actor_user_id: hr.actor.userId },
      orderBy: { created_at: 'desc' },
    })
    expect(audit.metadata).toMatchObject({ to: sana })
    expect(
      await prisma.internLifecycleEvent.count({ where: { intern_id: john.internId, event_type: 'MENTOR_ASSIGNED' } }),
    ).toBe(1)
    expect(events.seen.some((e) => e.name === 'intern.mentor_assigned' && e.payload.mentorId === sana)).toBe(true)
    expect(events.seen.filter((e) => e.name === 'onboarding.item_assigned')).toHaveLength(mentorItems.length)

    // Re-assigning the same person is a no-op.
    await expect(internService.assign(hr, { internId: john.internId, role: 'mentor', userId: sana })).resolves.toEqual({
      changed: false,
    })
    // Interns can't be managers or mentors.
    await expect(
      internService.assign(hr, { internId: john.internId, role: 'mentor', userId: await userId(EMAILS.intern) }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

// ── Creation rules ───────────────────────────────────────────────────────────

describe('intern creation rules', () => {
  it('generates unique employee codes under concurrent creation', async () => {
    const hr = await contextFor(EMAILS.hr)
    const results = await Promise.all(
      Array.from({ length: 5 }, () => createJohn(hr, { sendInvitation: '', startOnboarding: '' })),
    )
    const codes = results.map((r) => r.employeeCode)
    expect(new Set(codes).size).toBe(5)
    const numbers = codes.map((code) => Number(code.replace('AYV-INT-', ''))).sort((a, b) => a - b)
    expect(numbers[4] - numbers[0]).toBe(4)
  })

  it('never reuses codes created some other way (the counter skips past them)', async () => {
    const hr = await contextFor(EMAILS.hr)
    const { employeeCode } = await createJohn(hr, { sendInvitation: '', startOnboarding: '' })
    const next = Number(employeeCode.replace('AYV-INT-', '')) + 5
    const imported = await createUser(fake, { role: 'intern' })
    await prisma.intern.create({
      data: {
        organization_id: ORG,
        user_id: imported.user.id,
        employee_code: `AYV-INT-${String(next).padStart(4, '0')}`,
      },
    })
    const after = await createJohn(hr, { sendInvitation: '', startOnboarding: '' })
    expect(Number(after.employeeCode.replace('AYV-INT-', ''))).toBe(next + 1)
  })

  it('leaves no partial records when a step fails', async () => {
    const hr = await contextFor(EMAILS.hr)
    const email = `rollback.${uniqueSuffix()}@example.com`
    // A template that doesn't exist fails inside the transaction, after the user and intern rows were written.
    await expect(createJohn(hr, { email, templateId: '00000000-0000-4000-8000-000000000000' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
    // createJohn overrides the email with the one given here.
    expect(await prisma.user.count({ where: { email } })).toBe(0)
    expect(await prisma.intern.count({ where: { user: { email } } })).toBe(0)
  })

  it('rejects duplicates: an existing intern, a staff account, a second onboarding', async () => {
    const hr = await contextFor(EMAILS.hr)
    const john = await createJohn(hr)
    await expect(createJohn(hr, { email: john.email })).rejects.toBeInstanceOf(ConflictError)
    await expect(createJohn(hr, { email: EMAILS.manager })).rejects.toBeInstanceOf(ConflictError)

    const internship = await prisma.internship.findFirstOrThrow({ where: { intern_id: john.internId } })
    await expect(
      prisma.onboarding.create({ data: { organization_id: ORG, internship_id: internship.id, template_name: 'dup' } }),
    ).rejects.toThrow(/Unique constraint/)
    // Only one open internship per intern (database-enforced).
    await expect(
      prisma.internship.create({
        data: {
          organization_id: ORG,
          intern_id: john.internId,
          title: 'Second',
          start_date: new Date(),
          status: 'ACTIVE',
        },
      }),
    ).rejects.toThrow(/internships_one_open_per_intern_key|Unique constraint/)
    // Only one pending invitation per user (database-enforced).
    const invitation = await prisma.userInvitation.findFirstOrThrow({ where: { user: { email: john.email } } })
    await expect(
      prisma.userInvitation.create({
        data: {
          organization_id: ORG,
          user_id: invitation.user_id,
          email: john.email,
          role_id: invitation.role_id,
          token_hash: hashToken(`token-${uniqueSuffix()}`),
          expires_at: new Date(Date.now() + 1e6),
        },
      }),
    ).rejects.toThrow(/Unique constraint/)
  })

  it('re-inviting revokes the previous pending invitation', async () => {
    const hr = await contextFor(EMAILS.hr)
    const john = await createJohn(hr)
    const user = await prisma.user.findFirstOrThrow({ where: { email: john.email } })
    await invitationService.inviteExistingUser(hr, user.id, meta())
    const invitations = await prisma.userInvitation.findMany({ where: { user_id: user.id } })
    expect(invitations).toHaveLength(2)
    expect(invitations.filter((i) => !i.revoked_at && !i.accepted_at)).toHaveLength(1)
  })

  it('requires intern.create (managers, mentors and interns are refused)', async () => {
    for (const email of [EMAILS.manager, EMAILS.mentor, EMAILS.intern]) {
      await expect(createJohn(await contextFor(email))).rejects.toBeInstanceOf(ForbiddenError)
    }
  })

  it('rejects privileged fields smuggled into create and update (mass assignment)', async () => {
    const hr = await contextFor(EMAILS.hr)
    for (const smuggled of [
      { role: 'SUPER_ADMIN' },
      { organization_id: '00000000-0000-4000-8000-000000000000' },
      { permissions: ['user.manage'] },
      { employeeCode: 'X-1' },
    ]) {
      await expect(createJohn(hr, smuggled)).rejects.toBeInstanceOf(ValidationError)
    }
    const john = await createJohn(hr)
    const profile = await internService.getProfile(hr, john.internId)
    const valid = {
      firstName: 'John',
      lastName: 'Doe',
      positionId: profile.position!.id,
      departmentId: profile.department!.id,
      joiningDate: formatDateOnly(profile.joiningDate!),
      expectedEndDate: formatDateOnly(profile.expectedEndDate!),
      workMode: 'HYBRID',
    }
    for (const smuggled of [
      { status: 'ACTIVE' },
      { managerId: hr.actor.userId },
      { organizationId: ORG },
      { email: 'x@y.z' },
    ]) {
      await expect(internService.updateDetails(hr, john.internId, { ...valid, ...smuggled })).rejects.toBeInstanceOf(
        ValidationError,
      )
    }
  })
})

// ── Editing and scope ────────────────────────────────────────────────────────

describe('editing and scoped access', () => {
  it('HR edits are audited and date changes land on the timeline', async () => {
    const hr = await contextFor(EMAILS.hr)
    const john = await createJohn(hr)
    const profile = await internService.getProfile(hr, john.internId)
    await internService.updateDetails(hr, john.internId, {
      firstName: 'Johnny',
      lastName: 'Doe',
      positionId: profile.position!.id,
      departmentId: profile.department!.id,
      joiningDate: formatDateOnly(profile.joiningDate!),
      expectedEndDate: formatDateOnly(addDays(profile.expectedEndDate!, 30)),
      workMode: 'REMOTE',
    })
    const updated = await internService.getProfile(hr, john.internId)
    expect(updated.name).toBe('Johnny Doe')
    expect(updated.internship?.workMode).toBe('REMOTE')
    expect(await auditCount(AUDIT_ACTIONS.INTERN_UPDATED, john.internId)).toBe(1)
    expect(
      await prisma.internLifecycleEvent.count({ where: { intern_id: john.internId, event_type: 'DATES_CHANGED' } }),
    ).toBe(1)
  })

  it('interns edit only their own permitted fields, derived from the session', async () => {
    const intern = await contextFor(EMAILS.intern)
    await internService.updateOwnProfile(intern, { phone: '+91 90000 22222', bio: 'Loves accessible design.' })
    const profile = await internService.getProfile(intern, await internIdFor(EMAILS.intern))
    expect(profile.phone).toBe('+91 90000 22222')
    expect(profile.education?.bio).toBe('Loves accessible design.')
    for (const smuggled of [
      { departmentId: ORG },
      { managerId: intern.actor.userId },
      { status: 'ALUMNI' },
      { internId: await internIdFor(EMAILS.neel) },
    ]) {
      await expect(internService.updateOwnProfile(intern, { bio: 'x', ...smuggled })).rejects.toBeInstanceOf(
        ValidationError,
      )
    }
  })

  it('an intern changing the URL id cannot read or edit another intern (IDOR)', async () => {
    const intern = await contextFor(EMAILS.intern)
    const neel = await internIdFor(EMAILS.neel)
    await expect(internService.getProfile(intern, neel)).rejects.toBeInstanceOf(NotFoundError)
    await expect(internService.updateDetails(intern, neel, {})).rejects.toBeInstanceOf(NotFoundError)
    await expect(internService.assign(intern, { internId: neel, role: 'manager', userId: '' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(internService.activity(intern, neel)).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      internLifecycleService.transitionStatus(intern, { internId: neel, to: 'ACTIVE' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('managers and mentors cannot edit, reassign or change status', async () => {
    const arjun = await contextFor(EMAILS.manager)
    const aanya = await internIdFor(EMAILS.intern)
    await expect(internService.updateDetails(arjun, aanya, {})).rejects.toBeInstanceOf(ForbiddenError)
    await expect(internService.assign(arjun, { internId: aanya, role: 'mentor', userId: '' })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    await expect(
      internLifecycleService.transitionStatus(arjun, { internId: aanya, to: 'TERMINATED', reason: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('mentors see only their mentees (mentor scope)', async () => {
    const sana = await contextFor(EMAILS.designMentor)
    const mentees = await internService.related(sana, 'mentored')
    expect(mentees.length).toBeGreaterThan(0)
    expect(mentees.every((row) => row.mentor?.id === sana.actor.userId)).toBe(true)
    await expect(internService.getProfile(sana, await internIdFor(EMAILS.intern))).rejects.toBeInstanceOf(NotFoundError)
    const directory = await internService.directory(sana, { pageSize: '100' })
    expect(directory.page.total).toBe(
      await prisma.intern.count({
        where: { deleted_at: null, OR: [{ manager_id: sana.actor.userId }, { mentor_id: sana.actor.userId }] },
      }),
    )
  })
})

// ── Directory ────────────────────────────────────────────────────────────────

describe('intern directory', () => {
  it('searches, filters, sorts and paginates in the database', async () => {
    const hr = await contextFor(EMAILS.hr)
    const byCode = await internService.directory(hr, { q: 'AYV-INT-0004' })
    expect(byCode.page.items.map((row) => row.employee_code)).toEqual(['AYV-INT-0004'])
    const byEmail = await internService.directory(hr, { q: 'ZARA.KHAN@demo' })
    expect(byEmail.page.items).toHaveLength(1)
    const byDepartment = await internService.directory(hr, { q: 'Marketing', status: 'ENDING_SOON' })
    expect(
      byDepartment.page.items.every((row) => row.status === 'ENDING_SOON' && row.department?.name === 'Marketing'),
    ).toBe(true)

    const design = await prisma.department.findFirstOrThrow({ where: { organization_id: ORG, slug: 'design' } })
    const designOnly = await internService.directory(hr, { department: design.id, pageSize: '100' })
    expect(designOnly.page.items.every((row) => row.department?.id === design.id)).toBe(true)

    const sorted = await internService.directory(hr, { sort: 'end', dir: 'desc', pageSize: '100' })
    const ends = sorted.page.items
      .map((row) => row.expected_end_date?.getTime() ?? -Infinity)
      .filter((t) => t !== -Infinity)
    expect(ends).toEqual([...ends].sort((a, b) => b - a))

    const all = await internService.directory(hr, { pageSize: '25' })
    expect(all.page.total).toBe(await prisma.intern.count({ where: { organization_id: ORG, deleted_at: null } }))
    expect(all.page.items.length).toBeLessThanOrEqual(25)
    if (all.page.total > 25) {
      const second = await internService.directory(hr, { pageSize: '25', page: '2' })
      expect(second.page.items[0]?.id).not.toBe(all.page.items[0]?.id)
    }
    expect(all.stats.total).toBe(all.page.total)
  })
})

// ── Lifecycle ────────────────────────────────────────────────────────────────

describe('internship lifecycle', () => {
  it('enforces valid transitions, reasons and the onboarding gate', async () => {
    const hr = await contextFor(EMAILS.hr)
    const john = await createJohn(hr)
    const transition = (input: Record<string, unknown>) =>
      internLifecycleService.transitionStatus(hr, { internId: john.internId, ...input })

    await expect(transition({ to: 'COMPLETED' })).rejects.toBeInstanceOf(ValidationError) // ONBOARDING → COMPLETED
    await expect(transition({ to: 'ACTIVE' })).rejects.toThrow(/Onboarding isn’t finished/)
    await expect(transition({ to: 'ACTIVE', override: 'on' })).rejects.toBeInstanceOf(ValidationError) // needs a reason
    await expect(
      transition({ to: 'ACTIVE', override: 'on', reason: 'Starting on a client project early' }),
    ).resolves.toEqual({ from: 'ONBOARDING', to: 'ACTIVE' })

    const internship = await prisma.internship.findFirstOrThrow({ where: { intern_id: john.internId } })
    expect(internship.status).toBe('ACTIVE')
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: AUDIT_ACTIONS.STATUS_CHANGED, resource_id: john.internId },
    })
    expect(audit.metadata).toMatchObject({ from: 'ONBOARDING', to: 'ACTIVE', override: true })

    await expect(transition({ to: 'TERMINATED' })).rejects.toBeInstanceOf(ValidationError)
    await transition({ to: 'TERMINATED', reason: 'Left the programme' })
    const terminated = await prisma.intern.findUniqueOrThrow({ where: { id: john.internId } })
    expect(terminated.status).toBe('TERMINATED')
    expect(terminated.actual_end_date).not.toBeNull()
    await expect(transition({ to: 'ACTIVE' })).rejects.toBeInstanceOf(ValidationError) // final state
    expect(
      await prisma.internLifecycleEvent.count({ where: { intern_id: john.internId, event_type: 'STATUS_CHANGED' } }),
    ).toBe(2)
  })

  it('SELECTED → ONBOARDING generates the checklist from the chosen template', async () => {
    const hr = await contextFor(EMAILS.hr)
    const john = await createJohn(hr, { startOnboarding: '', sendInvitation: '' })
    expect((await prisma.intern.findUniqueOrThrow({ where: { id: john.internId } })).status).toBe('SELECTED')
    await internLifecycleService.transitionStatus(hr, {
      internId: john.internId,
      to: 'ONBOARDING',
      templateId: seedId('template:general'),
    })
    const onboarding = await prisma.onboarding.findFirstOrThrow({
      where: { internship: { intern_id: john.internId } },
      include: { items: true },
    })
    expect(onboarding.template_name).toBe('General Intern Onboarding')
    expect(onboarding.items).toHaveLength(11)
  })

  it('marks internships ending soon from a scheduled job, idempotently', async () => {
    const hr = await contextFor(EMAILS.hr)
    const john = await createJohn(hr, { startOnboarding: '', sendInvitation: '' })
    const today = todayIn('Asia/Kolkata')
    await prisma.intern.update({
      where: { id: john.internId },
      data: { status: 'ACTIVE', expected_end_date: addDays(today, 5) },
    })

    const first = await internLifecycleService.markEndingSoon({ organizationId: ORG })
    expect(first.marked).toBeGreaterThanOrEqual(1)
    expect((await prisma.intern.findUniqueOrThrow({ where: { id: john.internId } })).status).toBe('ENDING_SOON')
    const again = await internLifecycleService.markEndingSoon({ organizationId: ORG })
    expect(again.marked).toBe(0)

    // HR extends the internship back to ACTIVE: the job doesn't flip it again for the same end date.
    await internLifecycleService.transitionStatus(hr, {
      internId: john.internId,
      to: 'ACTIVE',
      reason: 'Extended by two weeks',
    })
    await internLifecycleService.markEndingSoon({ organizationId: ORG })
    expect((await prisma.intern.findUniqueOrThrow({ where: { id: john.internId } })).status).toBe('ACTIVE')
  })

  it('emits overdue events once, for items that became overdue today', async () => {
    const hr = await contextFor(EMAILS.hr)
    const john = await createJohn(hr)
    const today = todayIn('Asia/Kolkata')
    const item = await prisma.onboardingItem.findFirstOrThrow({
      where: { internship: { intern_id: john.internId }, item_type: 'TASK' },
    })
    await prisma.onboardingItem.update({ where: { id: item.id }, data: { due_date: addDays(today, -1) } })
    const events = captureEvents('onboarding.item_overdue')
    await internLifecycleService.emitOverdueOnboarding({ organizationId: ORG })
    events.stop()
    expect(events.seen.filter((e) => e.payload.itemId === item.id)).toHaveLength(1)
  })
})

// ── Onboarding ───────────────────────────────────────────────────────────────

describe('onboarding', () => {
  it('records versioned policy acknowledgements and completes the onboarding when required items are done', async () => {
    const hr = await contextFor(EMAILS.hr)
    const john = await createJohn(hr)
    const johnCtx = await signInAsInvitee(john.invitation!.inviteUrl!, john.email)
    const events = captureEvents('onboarding.completed')

    const { items } = await onboardingService.getChecklist(johnCtx, john.internId)
    const ack = items.find((item) => item.item_type === 'ACKNOWLEDGEMENT')!
    await onboardingService.acknowledgeItem(johnCtx, ack.id, meta())
    const record = await prisma.documentAcknowledgement.findFirstOrThrow({
      where: { user_id: johnCtx.actor.userId, policy_id: ack.policy_id! },
    })
    expect(record.policy_version).toBe(ack.policy!.version)
    expect(record.ip_address).toBeTruthy()
    // HR can't acknowledge on the intern's behalf.
    const secondAck = items.filter((item) => item.item_type === 'ACKNOWLEDGEMENT')[1]
    await expect(onboardingService.acknowledgeItem(hr, secondAck.id, meta())).rejects.toBeInstanceOf(ForbiddenError)

    // HR finishes the rest (waiving what needs a reason); optional items stay open.
    for (const item of (await onboardingService.getChecklist(hr, john.internId)).items) {
      if (!item.required || item.status === 'COMPLETED') continue
      if (item.item_type === 'DOCUMENT' || item.item_type === 'ACKNOWLEDGEMENT') {
        await onboardingService.setItemStatus(hr, { itemId: item.id, action: 'skip', reason: 'Collected on paper' })
      } else {
        await onboardingService.completeItem(hr, item.id)
      }
    }
    events.stop()
    const done = await onboardingService.getChecklist(hr, john.internId)
    expect(done.progress.complete).toBe(true)
    expect(done.progress.optionalDone).toBeLessThan(done.progress.optionalTotal)
    expect(done.onboarding?.completed_at).not.toBeNull()
    expect(events.seen).toHaveLength(1)
    expect(
      await prisma.internLifecycleEvent.count({
        where: { intern_id: john.internId, event_type: 'ONBOARDING_COMPLETED' },
      }),
    ).toBe(1)
    // Completion doesn't activate the intern automatically.
    expect((await prisma.intern.findUniqueOrThrow({ where: { id: john.internId } })).status).toBe('ONBOARDING')
    await expect(
      internLifecycleService.transitionStatus(hr, { internId: john.internId, to: 'ACTIVE' }),
    ).resolves.toMatchObject({ to: 'ACTIVE' })

    // Reopening a required item makes the onboarding incomplete again.
    const task = done.items.find((item) => item.item_type === 'TASK' && item.required)!
    await onboardingService.setItemStatus(hr, { itemId: task.id, action: 'reopen' })
    expect((await onboardingService.getChecklist(hr, john.internId)).onboarding?.completed_at).toBeNull()
  })

  it('HR controls need reasons for blocking and waiving required items', async () => {
    const hr = await contextFor(EMAILS.hr)
    const john = await createJohn(hr)
    const { items } = await onboardingService.getChecklist(hr, john.internId)
    const required = items.find((item) => item.required && item.item_type === 'TASK')!
    await expect(onboardingService.setItemStatus(hr, { itemId: required.id, action: 'block' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    await expect(onboardingService.setItemStatus(hr, { itemId: required.id, action: 'skip' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    await onboardingService.setItemStatus(hr, { itemId: required.id, action: 'block', reason: 'Waiting for access' })
    const after = await onboardingService.getChecklist(hr, john.internId)
    expect(after.progress.blocked).toBe(1)
    expect(await auditCount(AUDIT_ACTIONS.ONBOARDING_ITEM_UPDATED, required.id)).toBe(1)
  })

  it('an intern cannot complete another intern’s items; a manager cannot manage another manager’s intern', async () => {
    const aanya = await contextFor(EMAILS.intern)
    const neelItems = await prisma.onboardingItem.findMany({
      where: { internship: { intern: { user: { email: EMAILS.neel } } }, status: 'PENDING' },
    })
    expect(neelItems.length).toBeGreaterThan(0)
    await expect(onboardingService.completeItem(aanya, neelItems[0].id)).rejects.toBeInstanceOf(NotFoundError)

    const priya = await contextFor(EMAILS.marketingManager) // Neel is Arjun's intern
    await expect(onboardingService.completeItem(priya, neelItems[0].id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      onboardingService.setItemStatus(priya, { itemId: neelItems[0].id, action: 'skip', reason: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundError)

    // Neel's own manager can see his checklist but can't use HR controls.
    const arjun = await contextFor(EMAILS.manager)
    await expect(
      onboardingService.setItemStatus(arjun, { itemId: neelItems[0].id, action: 'skip', reason: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    // …and can complete an item assigned to him.
    const mentorItem = await prisma.onboardingItem.findFirstOrThrow({
      where: { internship: { intern: { user: { email: EMAILS.neel } } }, assigned_role: 'MENTOR' },
    })
    await expect(onboardingService.completeItem(arjun, mentorItem.id)).rejects.toBeInstanceOf(ForbiddenError)
    const rohan = await contextFor(EMAILS.mentor)
    await expect(onboardingService.completeItem(rohan, mentorItem.id)).resolves.toEqual({ changed: true })
  })

  it('HR dashboard counts every onboarding in scope', async () => {
    const hr = await contextFor(EMAILS.hr)
    const dashboard = await onboardingService.dashboard(hr)
    expect(dashboard.stats.total).toBe(await prisma.onboarding.count({ where: { organization_id: ORG } }))
    expect(dashboard.stats.completed + dashboard.stats.inProgress).toBe(dashboard.stats.total)
    await expect(onboardingService.dashboard(await contextFor(EMAILS.manager))).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('generated checklists are snapshots: editing the template later does not change them', async () => {
    const hr = await contextFor(EMAILS.hr)
    const template = await onboardingTemplateService.create(hr, {
      name: `Snapshot ${uniqueSuffix()}`,
      description: 'Test',
    })
    await onboardingTemplateService.addItem(hr, template.id, {
      title: 'Original title',
      category: 'TASK',
      required: 'on',
      dueDaysAfterStart: '1',
      assignedRole: 'INTERN',
    })
    const john = await createJohn(hr, { templateId: template.id })
    const templateItem = await prisma.onboardingTemplateItem.findFirstOrThrow({ where: { template_id: template.id } })
    await onboardingTemplateService.updateItem(hr, templateItem.id, {
      title: 'Edited title',
      category: 'TASK',
      required: 'on',
      dueDaysAfterStart: '9',
      assignedRole: 'INTERN',
    })

    const [item] = (await onboardingService.getChecklist(hr, john.internId)).items
    expect(item.title).toBe('Original title')
    await expect(
      onboardingTemplateService.create(await contextFor(EMAILS.manager), { name: 'Nope' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

// ── Documents ────────────────────────────────────────────────────────────────

describe('intern documents', () => {
  it('stores privately, completes the onboarding item and enforces visibility', async () => {
    const hr = await contextFor(EMAILS.hr)
    const john = await createJohn(hr)
    const johnCtx = await signInAsInvitee(john.invitation!.inviteUrl!, john.email)
    const { items } = await onboardingService.getChecklist(johnCtx, john.internId)
    const resumeItem = items.find((item) => item.required_document_type === 'RESUME')!

    const upload = await documentService.upload(
      johnCtx,
      { internId: john.internId, documentType: 'RESUME', onboardingItemId: resumeItem.id },
      { name: '../../etc/passwd resume.pdf', type: 'application/pdf', bytes: PDF },
      meta(),
    )
    const doc = await prisma.internshipDocument.findUniqueOrThrow({ where: { id: upload.id } })
    expect(doc.storage_path).toMatch(new RegExp(`^${ORG}/document/\\d{4}/[0-9a-f-]{36}\\.pdf$`))
    expect(doc.storage_path).not.toContain('passwd')
    expect(doc.visibility).toBe('INTERN')
    expect((await prisma.onboardingItem.findUniqueOrThrow({ where: { id: resumeItem.id } })).status).toBe('COMPLETED')
    expect(await auditCount(AUDIT_ACTIONS.DOCUMENT_UPLOADED, doc.id)).toBe(1)

    // An intern's ID document defaults to HR-only visibility.
    const idDoc = await documentService.upload(
      johnCtx,
      { internId: john.internId, documentType: 'ID_DOCUMENT' },
      { name: 'id.pdf', type: 'application/pdf', bytes: PDF },
      meta(),
    )
    expect((await prisma.internshipDocument.findUniqueOrThrow({ where: { id: idDoc.id } })).visibility).toBe('HR')
    // HR uploads an HR-only offer letter.
    const offer = await documentService.upload(
      hr,
      { internId: john.internId, documentType: 'OFFER_LETTER', visibility: 'HR' },
      { name: 'offer.pdf', type: 'application/pdf', bytes: PDF },
      meta(),
    )

    const downloaded = await documentService.download(johnCtx, doc.id)
    expect(Buffer.from(downloaded.bytes).toString()).toContain('%PDF')
    await expect(documentService.download(johnCtx, offer.id)).rejects.toBeInstanceOf(NotFoundError)

    // The manager sees intern/manager-visible documents only; the mentor sees none.
    const priya = await contextFor(EMAILS.marketingManager)
    const managerList = await documentService.listForIntern(priya, john.internId)
    expect(managerList.documents.map((d) => d.id)).toEqual([doc.id])
    await expect(documentService.download(priya, offer.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(documentService.listForIntern(await contextFor(EMAILS.mentor), john.internId)).rejects.toBeInstanceOf(
      ForbiddenError,
    )

    // Another intern can't reach any of it (IDOR).
    const aanya = await contextFor(EMAILS.intern)
    await expect(documentService.download(aanya, doc.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(documentService.listForIntern(aanya, john.internId)).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      documentService.upload(
        aanya,
        { internId: john.internId, documentType: 'OTHER' },
        { name: 'x.pdf', type: 'application/pdf', bytes: PDF },
        meta(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError)

    // Interns can't delete; HR soft-deletes and the onboarding item reopens.
    await expect(documentService.remove(johnCtx, doc.id, meta())).rejects.toBeInstanceOf(ForbiddenError)
    await documentService.remove(hr, doc.id, meta())
    expect((await prisma.internshipDocument.findUniqueOrThrow({ where: { id: doc.id } })).deleted_at).not.toBeNull()
    expect((await prisma.onboardingItem.findUniqueOrThrow({ where: { id: resumeItem.id } })).status).toBe('PENDING')
    expect(await auditCount(AUDIT_ACTIONS.DOCUMENT_DELETED, doc.id)).toBe(1)
  })

  it('rejects files whose content does not match their type', async () => {
    const hr = await contextFor(EMAILS.hr)
    const john = await createJohn(hr, { sendInvitation: '' })
    await expect(
      documentService.upload(
        hr,
        { internId: john.internId, documentType: 'RESUME' },
        { name: 'resume.pdf', type: 'application/pdf', bytes: new Uint8Array(Buffer.from('MZ-not-a-pdf')) },
        meta(),
      ),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      documentService.upload(
        hr,
        { internId: john.internId, documentType: 'RESUME' },
        { name: 'run.exe', type: 'application/x-msdownload', bytes: PDF },
        meta(),
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})
