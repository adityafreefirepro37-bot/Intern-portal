import { setAuthProviderForTesting } from '@/lib/auth/provider'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { addDays, formatDateOnly, todayIn } from '@/lib/interns/dates'
import { AUDIT_ACTIONS } from '@/server/services/audit-actions'
import { internLifecycleService } from '@/server/services/intern-lifecycle.service'
import { internService } from '@/server/services/intern.service'
import { invitationService } from '@/server/services/invitation.service'
import { onboardingService } from '@/server/services/onboarding.service'
import { contextFor, meta, prisma, uniqueSuffix, useFakeAuth } from './helpers'

/**
 * Prompt 03 manual acceptance scenario ("John Doe"), steps 1–11, run against
 * the real services and database. Sign-in uses the in-memory auth provider;
 * the browser-level equivalents live in tests/e2e/app/interns.spec.ts.
 */
beforeAll(() => {
  useFakeAuth()
})
afterAll(async () => {
  setAuthProviderForTesting(null)
  await prisma.$disconnect()
})

test('John Doe: HR creates → invitation → John signs in → onboarding → manager scope → mentor change → lifecycle', async () => {
  // Step 1 — log in as HR
  const hr = await contextFor('hr@ayavacreatives.com')

  // Step 2 — create John Doe, Digital Marketing Intern, Marketing, manager = Marketing Manager, 90 days
  const marketing = await prisma.department.findFirstOrThrow({ where: { slug: 'marketing' } })
  const position = await prisma.position.findFirstOrThrow({ where: { slug: 'digital-marketing-intern' } })
  const marketingManager = await prisma.user.findFirstOrThrow({ where: { email: 'manager@ayavacreatives.com' } })
  const mentor = await prisma.user.findFirstOrThrow({ where: { email: 'mentor@ayavacreatives.com' } })
  const today = todayIn(hr.organization.timezone)
  const email = `john.doe.${uniqueSuffix()}@test.ayava.dev`
  const created = await internService.create(
    hr,
    {
      firstName: 'John',
      lastName: 'Doe',
      email,
      departmentId: marketing.id,
      positionId: position.id,
      managerId: marketingManager.id,
      mentorId: mentor.id,
      joiningDate: formatDateOnly(today),
      expectedEndDate: formatDateOnly(addDays(today, 89)), // 90 calendar days inclusive
      workMode: 'HYBRID',
      emergencyName: 'Mary Doe',
      emergencyRelationship: 'Parent',
      emergencyPhone: '+91 90000 12345',
      startOnboarding: 'on',
      sendInvitation: 'on',
    },
    meta(),
  )

  // Step 3 — exactly one of each record, no duplicates or partial rows
  const user = await prisma.user.findMany({ where: { email } })
  expect(user).toHaveLength(1)
  const records = await prisma.intern.findUniqueOrThrow({
    where: { id: created.internId },
    include: {
      profile: true,
      emergency_contacts: true,
      internships: { include: { onboarding: { include: { items: true } } } },
    },
  })
  expect(records.user_id).toBe(user[0].id)
  expect(records.profile).not.toBeNull()
  expect(records.emergency_contacts).toHaveLength(1)
  expect(records.internships).toHaveLength(1)
  expect(records.internships[0].onboarding?.template_name).toBe('Marketing Intern Onboarding')
  expect(records.manager_id).toBe(marketingManager.id)
  expect(created.employeeCode).toMatch(/^AYV-INT-\d{4}$/)
  const profileForHr = await internService.getProfile(hr, created.internId)
  expect(profileForHr.progress.totalDays).toBe(90)

  // Step 4 — invitation through the existing invitation system
  expect(created.invitation?.inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{20,}$/)
  const token = created.invitation!.inviteUrl!.split('/invite/')[1]
  await expect(
    invitationService.accept(
      { token, firstName: 'John', lastName: 'Doe', password: 'Strong-Passphrase-1!', confirmPassword: 'x' },
      meta(),
    ),
  ).rejects.toBeInstanceOf(ValidationError)
  const password = `Strong-Passphrase-${uniqueSuffix()}!`
  await invitationService.accept(
    { token, firstName: 'John', lastName: 'Doe', password, confirmPassword: password },
    meta(),
  )
  expect((await prisma.user.findUniqueOrThrow({ where: { id: user[0].id } })).status).toBe('ACTIVE')
  expect(
    await prisma.internLifecycleEvent.count({
      where: { intern_id: created.internId, event_type: 'INVITATION_ACCEPTED' },
    }),
  ).toBe(1)

  // Step 5 — log in as John
  const john = await contextFor(email)

  // Step 6 — John sees his profile, internship and onboarding, but not another intern
  const own = await internService.getProfile(john, created.internId)
  expect(own.relation.isSelf).toBe(true)
  expect(own.internship?.title).toBe('Digital Marketing Intern internship')
  const checklist = await onboardingService.getChecklist(john, created.internId)
  expect(checklist.items.length).toBeGreaterThan(0)
  const aanya = await prisma.intern.findFirstOrThrow({ where: { user: { email: 'intern@ayavacreatives.com' } } })
  await expect(internService.getProfile(john, aanya.id)).rejects.toBeInstanceOf(NotFoundError)
  await expect(internService.directory(john, {})).rejects.toBeInstanceOf(ForbiddenError)

  // Step 7 — complete one onboarding item; progress changes
  const before = checklist.progress
  const item = checklist.items.find(
    (i) => i.canComplete && i.required && !['DOCUMENT', 'ACKNOWLEDGEMENT'].includes(i.item_type),
  )!
  await onboardingService.completeItem(john, item.id)
  const after = (await onboardingService.getChecklist(john, created.internId)).progress
  expect(after.requiredDone).toBe(before.requiredDone + 1)
  expect(after.percent).toBeGreaterThan(before.percent)

  // Step 8 — the manager sees John
  const manager = await contextFor('manager@ayavacreatives.com')
  expect((await internService.related(manager, 'managed')).some((row) => row.id === created.internId)).toBe(true)
  await expect(internService.getProfile(manager, created.internId)).resolves.toMatchObject({ name: 'John Doe' })

  // Step 9 — the manager is denied an unrelated intern (Aanya is managed by the development manager)
  await expect(internService.getProfile(manager, aanya.id)).rejects.toBeInstanceOf(NotFoundError)

  // Step 10 — HR changes John's mentor: database, profile and audit updated
  const newMentor = await prisma.user.findFirstOrThrow({ where: { email: 'priya.kulkarni@demo.ayavacreatives.com' } })
  await internService.assign(hr, { internId: created.internId, role: 'mentor', userId: newMentor.id })
  expect((await prisma.intern.findUniqueOrThrow({ where: { id: created.internId } })).mentor_id).toBe(newMentor.id)
  expect((await internService.getProfile(hr, created.internId)).mentor?.name).toBe('Priya Kulkarni')
  const audit = await prisma.auditLog.findFirst({
    where: {
      resource_id: created.internId,
      action: AUDIT_ACTIONS.MENTOR_ASSIGNED,
      metadata: { path: ['to'], equals: newMentor.id },
    },
  })
  expect(audit).not.toBeNull()

  // Step 11 — lifecycle rules
  await expect(
    internLifecycleService.transitionStatus(hr, { internId: created.internId, to: 'COMPLETED' }),
  ).rejects.toBeInstanceOf(ValidationError)
  await expect(
    internLifecycleService.transitionStatus(hr, { internId: created.internId, to: 'ACTIVE' }),
  ).rejects.toBeInstanceOf(ValidationError)
  await expect(
    internLifecycleService.transitionStatus(john, { internId: created.internId, to: 'ACTIVE' }),
  ).rejects.toBeInstanceOf(ForbiddenError)
  await internLifecycleService.transitionStatus(hr, {
    internId: created.internId,
    to: 'ACTIVE',
    override: 'on',
    reason: 'Acceptance test',
  })
  await internLifecycleService.transitionStatus(hr, { internId: created.internId, to: 'ENDING_SOON' })
  await expect(
    internLifecycleService.transitionStatus(hr, { internId: created.internId, to: 'ACTIVE' }),
  ).rejects.toBeInstanceOf(ValidationError)
  await internLifecycleService.transitionStatus(hr, {
    internId: created.internId,
    to: 'ACTIVE',
    reason: 'Extended by two weeks',
  })
  const timeline = await prisma.internLifecycleEvent.findMany({
    where: { intern_id: created.internId, event_type: 'STATUS_CHANGED' },
  })
  expect(timeline).toHaveLength(3)
})
