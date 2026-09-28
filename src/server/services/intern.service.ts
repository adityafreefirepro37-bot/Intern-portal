import type { InternStatus, Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import type { RequestMeta } from '@/lib/http/request-meta'
import { EMPLOYEE_CODE_COUNTER_KEY, formatEmployeeCode } from '@/lib/interns/employee-code'
import { addDays, parseDateOnly, todayIn } from '@/lib/interns/dates'
import { INTERN_STATUSES } from '@/lib/interns/lifecycle'
import { internshipProgress, onboardingProgress } from '@/lib/interns/progress'
import { logger } from '@/lib/logging'
import { maskValue } from '@/lib/security/masking'
import { fullName } from '@/lib/utils/format'
import { emailSchema, isoDateSchema, nameSchema, parseInput, type Pagination } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { INTERN_SORTS, internRepository, type InternDirectoryFilter } from '../repositories/intern.repository'
import { counterRepository, lifecycleRepository } from '../repositories/lifecycle.repository'
import { templateRepository } from '../repositories/template.repository'
import { internScope, projectScope, taskScope } from '../repositories/scope'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { resolveInternAccess } from './intern-access'
import { invitationIssuer } from './invitation.service'
import { announceOnboarding, emitItemAssignments, generateOnboarding } from './onboarding.service'
import { skipTake, toPage } from './pagination'
import { settingsService } from './settings.service'
import { userService } from './user.service'

/** "Upcoming joins" look this many days ahead. */
export const UPCOMING_JOIN_DAYS = 30

/** Statuses that count as "currently interning". */
export const ACTIVE_INTERN_STATUSES: InternStatus[] = ['ACTIVE', 'ENDING_SOON']

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined)
const optionalId = z
  .string()
  .optional()
  .transform((value) => value || undefined)
  .pipe(z.uuid().optional())
const phoneSchema = z
  .string()
  .trim()
  .max(20)
  .regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number')
const optionalPhone = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined)
  .pipe(phoneSchema.optional())
const checkbox = z.preprocess((value) => value === true || value === 'on' || value === 'true', z.boolean())

// ── Directory query (from untrusted URL params) ──────────────────────────────

export const directoryQuerySchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z
    .enum(INTERN_STATUSES as [InternStatus, ...InternStatus[]])
    .optional()
    .catch(undefined),
  department: z.uuid().optional().catch(undefined),
  team: z.uuid().optional().catch(undefined),
  position: z.uuid().optional().catch(undefined),
  manager: z.uuid().optional().catch(undefined),
  mentor: z.uuid().optional().catch(undefined),
  joinedFrom: isoDateSchema.optional().catch(undefined),
  joinedTo: isoDateSchema.optional().catch(undefined),
  endFrom: isoDateSchema.optional().catch(undefined),
  endTo: isoDateSchema.optional().catch(undefined),
  sort: z.enum(INTERN_SORTS).default('name').catch('name'),
  dir: z.enum(['asc', 'desc']).default('asc').catch('asc'),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
  pageSize: z.coerce
    .number()
    .pipe(z.union([z.literal(25), z.literal(50), z.literal(100)]))
    .default(25)
    .catch(25),
})
export type DirectoryQuery = z.infer<typeof directoryQuerySchema>

// ── Create / update schemas (strict: unknown fields are rejected) ────────────

const placementFields = {
  positionId: z.uuid({ message: 'Choose a position' }),
  departmentId: z.uuid({ message: 'Choose a department' }),
  teamId: optionalId,
  joiningDate: isoDateSchema,
  expectedEndDate: isoDateSchema,
  workMode: z.enum(['REMOTE', 'HYBRID', 'ONSITE']),
  location: optionalText(120),
  internshipTitle: optionalText(120),
  description: optionalText(2000),
  educationLevel: optionalText(80),
  institution: optionalText(160),
  fieldOfStudy: optionalText(120),
  graduationYear: z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : undefined))
    .pipe(z.number().int().min(1950).max(2100).optional()),
}

const datesInOrder = (value: { joiningDate: string; expectedEndDate: string }) =>
  value.expectedEndDate >= value.joiningDate
const datesMessage = { message: 'The end date must be on or after the joining date', path: ['expectedEndDate'] }

export const createInternSchema = z
  .strictObject({
    firstName: nameSchema,
    lastName: nameSchema,
    email: emailSchema,
    phone: optionalPhone,
    ...placementFields,
    managerId: optionalId,
    mentorId: optionalId,
    emergencyName: optionalText(120),
    emergencyRelationship: optionalText(60),
    emergencyPhone: optionalPhone,
    emergencyEmail: z
      .string()
      .optional()
      .transform((value) => value || undefined)
      .pipe(emailSchema.optional()),
    templateId: optionalId,
    startOnboarding: checkbox.default(false),
    sendInvitation: checkbox.default(false),
  })
  .refine(datesInOrder, datesMessage)
  .refine(
    (value) =>
      !(value.emergencyName || value.emergencyRelationship || value.emergencyPhone || value.emergencyEmail) ||
      Boolean(value.emergencyName && value.emergencyRelationship && value.emergencyPhone),
    { message: 'Give the contact’s name, relationship and phone', path: ['emergencyName'] },
  )

export const updateInternSchema = z
  .strictObject({ firstName: nameSchema, lastName: nameSchema, phone: optionalPhone, ...placementFields })
  .refine(datesInOrder, datesMessage)

/** What interns may change about themselves. Everything else is HR-managed. */
export const updateOwnInternProfileSchema = z.strictObject({
  phone: optionalPhone,
  bio: optionalText(1000),
  city: optionalText(80),
  state: optionalText(80),
  country: optionalText(80),
})

// ── Helpers ─────────────────────────────────────────────────────────────────

async function assertPlacement(
  organizationId: string,
  input: { positionId: string; departmentId: string; teamId?: string },
): Promise<{ positionTitle: string }> {
  const [position, department, team] = await Promise.all([
    prisma.position.findFirst({
      where: { id: input.positionId, organization_id: organizationId, is_active: true },
      select: { title: true },
    }),
    prisma.department.findFirst({
      where: { id: input.departmentId, organization_id: organizationId, is_active: true },
      select: { id: true },
    }),
    input.teamId
      ? prisma.team.findFirst({
          where: { id: input.teamId, organization_id: organizationId, is_active: true },
          select: { department_id: true },
        })
      : Promise.resolve(null),
  ])
  if (!position) throw new ValidationError('Choose a valid position', { positionId: 'Not found' })
  if (!department) throw new ValidationError('Choose a valid department', { departmentId: 'Not found' })
  if (input.teamId && !team) throw new ValidationError('Choose a valid team', { teamId: 'Not found' })
  if (team?.department_id && team.department_id !== input.departmentId) {
    throw new ValidationError('That team belongs to a different department', { teamId: 'Wrong department' })
  }
  return { positionTitle: position.title }
}

/** Managers and mentors must be active staff members (not interns) of the organization. */
async function assertStaff(organizationId: string, userId: string | undefined, field: string) {
  if (!userId) return
  const user = await prisma.user.findFirst({
    where: { id: userId, organization_id: organizationId, status: 'ACTIVE', deleted_at: null, intern: { is: null } },
    select: { id: true },
  })
  if (!user) throw new ValidationError('Choose an active staff member', { [field]: 'Not an active staff member' })
}

async function nextEmployeeCode(tx: Prisma.TransactionClient, organizationId: string, prefix: string) {
  const highest = await counterRepository.highestEmployeeCode(tx, organizationId, prefix)
  const value = await counterRepository.next(tx, organizationId, EMPLOYEE_CODE_COUNTER_KEY, highest + 1)
  return formatEmployeeCode(value, prefix)
}

/** Headline figures from per-status counts ("completed" includes alumni). */
function statusTotals(byStatus: Partial<Record<InternStatus, number>>) {
  const count = (status: InternStatus) => byStatus[status] ?? 0
  return {
    total: Object.values(byStatus).reduce((sum, n) => sum + (n ?? 0), 0),
    active: count('ACTIVE'),
    onboarding: count('ONBOARDING'),
    endingSoon: count('ENDING_SOON'),
    completed: count('COMPLETED') + count('ALUMNI'),
    selected: count('SELECTED'),
  }
}

// ── Service ─────────────────────────────────────────────────────────────────

export const internService = {
  /** Directory page + status stats, both limited to the viewer's `intern.read` scope. */
  async directory(ctx: RequestContext, rawQuery: unknown) {
    const scope = authorizationService.require(ctx, 'intern.read')
    const query = directoryQuerySchema.parse(rawQuery ?? {})
    const where = internScope(ctx.actor, scope)
    const filter: InternDirectoryFilter = {
      q: query.q,
      status: query.status,
      departmentId: query.department,
      teamId: query.team,
      positionId: query.position,
      managerId: query.manager,
      mentorId: query.mentor,
      joinedFrom: query.joinedFrom ? parseDateOnly(query.joinedFrom) : undefined,
      joinedTo: query.joinedTo ? parseDateOnly(query.joinedTo) : undefined,
      endFrom: query.endFrom ? parseDateOnly(query.endFrom) : undefined,
      endTo: query.endTo ? parseDateOnly(query.endTo) : undefined,
    }
    const pagination = { page: query.page, pageSize: query.pageSize }
    const [[rows, total], byStatus] = await Promise.all([
      internRepository.directoryPage(where, { filter, sort: query.sort, dir: query.dir, ...skipTake(pagination) }),
      internRepository.countByStatus(where),
    ])
    return { query, page: toPage(rows, total, pagination), stats: statusTotals(byStatus) }
  },

  async list(ctx: RequestContext, pagination: Pagination, filter: { status?: InternStatus } = {}) {
    const scope = authorizationService.require(ctx, 'intern.read')
    const [items, total] = await internRepository.listPage(internScope(ctx.actor, scope), {
      ...skipTake(pagination),
      status: filter.status,
    })
    return toPage(items, total, pagination)
  },

  async countActive(ctx: RequestContext) {
    const scope = authorizationService.require(ctx, 'intern.read')
    return internRepository.count(internScope(ctx.actor, scope), ACTIVE_INTERN_STATUSES)
  },

  /**
   * Purpose-built profile view. Fields the viewer may not see are returned as
   * null or masked on the server — never sent and hidden in the UI.
   */
  async getProfile(ctx: RequestContext, internId: string) {
    const id = parseInput(z.uuid(), internId)
    const access = await resolveInternAccess(ctx, id)
    const r = access.record
    const internship = r.internships[0] ?? null
    const today = todayIn(ctx.organization.timezone)
    const progress = internshipProgress({
      start: internship?.start_date ?? r.joining_date,
      expectedEnd: internship?.expected_end_date ?? r.expected_end_date,
      actualEnd: internship?.actual_end_date ?? r.actual_end_date,
      status: r.status,
      today,
    })
    const profile = r.profile
    return {
      id: r.id,
      userId: r.user_id,
      employeeCode: r.employee_code,
      status: r.status,
      name: fullName(r.user),
      person: {
        first_name: r.user.first_name,
        last_name: r.user.last_name,
        display_name: r.user.display_name,
        avatar_url: r.user.avatar_url,
      },
      accountStatus: r.user.status,
      email: r.user.email,
      phone: access.can.seeContact ? r.user.phone : maskValue(r.user.phone),
      position: r.position,
      department: r.department,
      team: r.team,
      manager: r.manager ? { id: r.manager.id, name: fullName(r.manager), email: r.manager.email } : null,
      mentor: r.mentor ? { id: r.mentor.id, name: fullName(r.mentor), email: r.mentor.email } : null,
      joiningDate: r.joining_date,
      expectedEndDate: r.expected_end_date,
      actualEndDate: r.actual_end_date,
      progress,
      internship: internship
        ? {
            id: internship.id,
            title: internship.title,
            status: internship.status,
            workMode: access.can.seePersonal ? internship.work_mode : null,
            location: access.can.seePersonal ? internship.location : null,
            description: internship.description,
            startDate: internship.start_date,
            expectedEndDate: internship.expected_end_date,
            onboarding: internship.onboarding,
          }
        : null,
      education:
        access.can.seePersonal && profile
          ? {
              level: profile.education_level,
              institution: profile.institution,
              fieldOfStudy: profile.field_of_study,
              graduationYear: profile.graduation_year,
              bio: profile.bio,
              city: profile.city,
              state: profile.state,
              country: profile.country,
            }
          : null,
      emergencyContacts: access.can.seeSensitive ? r.emergency_contacts : null,
      can: access.can,
      relation: {
        isSelf: access.isSelf,
        isManager: access.isManager,
        isMentor: access.isMentor,
        orgWide: access.orgWide,
      },
    }
  },

  /** The signed-in user's own intern record id — always derived from the session. */
  async myInternId(ctx: RequestContext): Promise<string | null> {
    const record = await internRepository.findByUserId(ctx.organization.id, ctx.actor.userId)
    return record?.id ?? null
  },

  /** Options for create/edit forms (org-scoped lists). */
  async formOptions(ctx: RequestContext) {
    if (!authorizationService.canAny(ctx, ['intern.create', 'intern.update', 'intern.read'])) throw new ForbiddenError()
    const org = ctx.organization.id
    const [departments, teams, positions, staff, templates] = await Promise.all([
      prisma.department.findMany({
        where: { organization_id: org, is_active: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      prisma.team.findMany({
        where: { organization_id: org, is_active: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, department_id: true },
      }),
      prisma.position.findMany({
        where: { organization_id: org, is_active: true },
        orderBy: { title: 'asc' },
        select: { id: true, title: true, department_id: true },
      }),
      prisma.user.findMany({
        where: { organization_id: org, status: 'ACTIVE', deleted_at: null, intern: { is: null } },
        orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
        select: {
          id: true,
          first_name: true,
          last_name: true,
          display_name: true,
          user_roles: { select: { role: { select: { name: true } } } },
        },
      }),
      templateRepository.list(org),
    ])
    return {
      departments,
      teams,
      positions,
      staff: staff.map((user) => ({
        id: user.id,
        name: fullName(user),
        roles: user.user_roles.map(({ role }) => role.name).join(', '),
      })),
      templates: templates
        .filter((t) => t.is_active)
        .map((t) => ({
          id: t.id,
          name: t.name,
          isDefault: t.is_default,
          departmentId: t.department?.id ?? null,
          positionId: t.position?.id ?? null,
        })),
    }
  },

  /**
   * Creates an intern end to end. All database records are written in one
   * transaction (no partial interns). The invitation email is sent after
   * commit; if delivery fails the intern still exists and HR can resend it.
   */
  async create(
    ctx: RequestContext,
    input: unknown,
    meta: RequestMeta,
    avatar?: { name: string; type: string; bytes: Uint8Array },
  ) {
    authorizationService.require(ctx, 'intern.create')
    const data = parseInput(createInternSchema, input)
    if (data.sendInvitation) authorizationService.require(ctx, 'user.invite')
    const org = ctx.organization.id
    const { positionTitle } = await assertPlacement(org, data)
    await assertStaff(org, data.managerId, 'managerId')
    await assertStaff(org, data.mentorId, 'mentorId')
    const deliverByEmail = data.sendInvitation ? invitationIssuer.assertDeliveryAvailable() : false

    const internRole = await prisma.role.findFirst({
      where: { organization_id: org, slug: 'intern' },
      select: { id: true, name: true, slug: true },
    })
    if (!internRole) throw new ValidationError('The Intern role is missing; run the seed')

    const existing = await prisma.user.findUnique({
      where: { organization_id_email: { organization_id: org, email: data.email } },
      select: {
        id: true,
        status: true,
        deleted_at: true,
        intern: { select: { id: true, employee_code: true, deleted_at: true } },
      },
    })
    if (existing?.intern) {
      // interns.user_id is unique: an archived (soft-deleted) record is kept for history, not replaced.
      throw new ConflictError(
        existing.intern.deleted_at
          ? `This email belongs to an archived intern record (${existing.intern.employee_code}). Ask an administrator to restore it.`
          : `This person is already an intern (${existing.intern.employee_code})`,
      )
    }
    if (existing && !existing.deleted_at && (existing.status === 'ACTIVE' || existing.status === 'SUSPENDED')) {
      throw new ConflictError('This email belongs to an existing staff account')
    }

    const templateId = data.startOnboarding
      ? (data.templateId ??
        (await templateRepository.pickFor(org, { departmentId: data.departmentId, positionId: data.positionId })))
      : null
    if (data.startOnboarding && !templateId)
      throw new ValidationError('Choose an onboarding template', { templateId: 'Required' })

    const prefix = await settingsService.employeeCodePrefix(org)
    const startDate = parseDateOnly(data.joiningDate)
    const endDate = parseDateOnly(data.expectedEndDate)

    const result = await prisma.$transaction(
      async (tx) => {
        const user = existing
          ? await tx.user.update({
              where: { id: existing.id },
              data: {
                first_name: data.firstName,
                last_name: data.lastName,
                phone: data.phone ?? null,
                status: 'INVITED',
                deleted_at: null,
              },
              select: { id: true, email: true },
            })
          : await tx.user.create({
              data: {
                organization_id: org,
                email: data.email,
                first_name: data.firstName,
                last_name: data.lastName,
                phone: data.phone ?? null,
                status: 'INVITED',
                timezone: ctx.organization.timezone,
              },
              select: { id: true, email: true },
            })
        await tx.userRole.deleteMany({ where: { user_id: user.id } })
        await tx.userRole.create({ data: { user_id: user.id, role_id: internRole.id, granted_by: ctx.actor.userId } })

        const employeeCode = await nextEmployeeCode(tx, org, prefix)
        const intern = await tx.intern.create({
          data: {
            organization_id: org,
            user_id: user.id,
            employee_code: employeeCode,
            status: data.startOnboarding ? 'ONBOARDING' : 'SELECTED',
            joining_date: startDate,
            expected_end_date: endDate,
            department_id: data.departmentId,
            team_id: data.teamId ?? null,
            position_id: data.positionId,
            manager_id: data.managerId ?? null,
            mentor_id: data.mentorId ?? null,
          },
          select: { id: true, user_id: true, manager_id: true, mentor_id: true },
        })
        await tx.internProfile.create({
          data: {
            intern_id: intern.id,
            education_level: data.educationLevel,
            institution: data.institution,
            field_of_study: data.fieldOfStudy,
            graduation_year: data.graduationYear,
          },
        })
        if (data.emergencyName && data.emergencyRelationship && data.emergencyPhone) {
          await tx.emergencyContact.create({
            data: {
              intern_id: intern.id,
              name: data.emergencyName,
              relationship: data.emergencyRelationship,
              phone: data.emergencyPhone,
              email: data.emergencyEmail ?? null,
            },
          })
        }
        const internship = await tx.internship.create({
          data: {
            organization_id: org,
            intern_id: intern.id,
            title: data.internshipTitle ?? `${positionTitle} internship`,
            department_id: data.departmentId,
            position_id: data.positionId,
            start_date: startDate,
            expected_end_date: endDate,
            status: 'PLANNED',
            work_mode: data.workMode,
            location: data.location ?? null,
            manager_id: data.managerId ?? null,
            mentor_id: data.mentorId ?? null,
            description: data.description ?? null,
          },
          select: { id: true, start_date: true },
        })
        await lifecycleRepository.record(tx, {
          organizationId: org,
          internId: intern.id,
          type: 'CREATED',
          description: `Intern created as ${positionTitle}`,
          actorUserId: ctx.actor.userId,
          metadata: { employeeCode },
        })
        const onboarding = templateId
          ? await generateOnboarding(tx, {
              organizationId: org,
              internship,
              intern,
              templateId,
              actorUserId: ctx.actor.userId,
            })
          : null
        const issued = data.sendInvitation ? await invitationIssuer.createRecord(tx, ctx, user, internRole.id) : null
        if (issued) {
          await lifecycleRepository.record(tx, {
            organizationId: org,
            internId: intern.id,
            type: 'INVITATION_SENT',
            description: 'Invitation to Intern OS created',
            actorUserId: ctx.actor.userId,
          })
        }
        return { user, intern, internship, employeeCode, onboarding, issued, reusedUser: Boolean(existing) }
      },
      { timeout: 20_000 },
    )

    // ── After commit: audit, events, external side effects ──
    const warnings: string[] = []
    const base = {
      resourceType: 'intern',
      resourceId: result.intern.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    }
    await auditService.logForContext(ctx, {
      ...base,
      action: AUDIT_ACTIONS.INTERN_CREATED,
      metadata: { employeeCode: result.employeeCode, reusedUser: result.reusedUser },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.INTERNSHIP_CREATED,
      resourceType: 'internship',
      resourceId: result.internship.id,
      metadata: { internId: result.intern.id },
    })
    if (data.managerId)
      await auditService.logForContext(ctx, {
        ...base,
        action: AUDIT_ACTIONS.MANAGER_ASSIGNED,
        metadata: { managerId: data.managerId },
      })
    if (data.mentorId)
      await auditService.logForContext(ctx, {
        ...base,
        action: AUDIT_ACTIONS.MENTOR_ASSIGNED,
        metadata: { mentorId: data.mentorId },
      })
    if (result.onboarding) await announceOnboarding(ctx, result.intern.id, result.onboarding)
    await domainEvents.emit('intern.created', {
      organizationId: org,
      actorUserId: ctx.actor.userId,
      payload: { internId: result.intern.id, userId: result.user.id, invited: Boolean(result.issued) },
    })

    let invitation: { delivery: 'email' | 'link'; inviteUrl: string | null } | null = null
    if (result.issued) {
      try {
        const delivered = await invitationIssuer.deliver(
          ctx,
          result.issued,
          { userId: result.user.id, email: result.user.email, roleName: internRole.name, roleSlug: internRole.slug },
          meta,
          deliverByEmail,
        )
        invitation = { delivery: delivered.delivery, inviteUrl: delivered.inviteUrl }
      } catch (error) {
        // Compensation: the intern exists; HR can resend the invitation from the profile.
        logger.error('Invitation delivery failed after intern creation', { internId: result.intern.id, error })
        warnings.push(
          'The intern was created, but the invitation email could not be sent. Use “Resend invitation” on their profile.',
        )
      }
    }
    if (avatar && avatar.bytes.byteLength > 0) {
      try {
        await userService.setAvatarFor(ctx, result.user.id, avatar)
      } catch (error) {
        warnings.push(`Photo not saved: ${error instanceof Error ? error.message : 'upload failed'}`)
      }
    }
    return { internId: result.intern.id, employeeCode: result.employeeCode, invitation, warnings }
  },

  /** HR edits of personal, placement and internship details (strict schema). */
  async updateDetails(ctx: RequestContext, internId: string, input: unknown) {
    const access = await resolveInternAccess(ctx, parseInput(z.uuid(), internId))
    if (!access.can.editDetails) throw new ForbiddenError()
    const data = parseInput(updateInternSchema, input)
    await assertPlacement(ctx.organization.id, data)
    const r = access.record
    const internship = r.internships[0]
    const start = parseDateOnly(data.joiningDate)
    const end = parseDateOnly(data.expectedEndDate)
    const datesChanged =
      r.joining_date?.getTime() !== start.getTime() || r.expected_end_date?.getTime() !== end.getTime()

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: r.user_id },
        data: { first_name: data.firstName, last_name: data.lastName, phone: data.phone ?? null },
      })
      await tx.intern.update({
        where: { id: r.id },
        data: {
          position_id: data.positionId,
          department_id: data.departmentId,
          team_id: data.teamId ?? null,
          joining_date: start,
          expected_end_date: end,
        },
      })
      await tx.internProfile.upsert({
        where: { intern_id: r.id },
        update: {
          education_level: data.educationLevel ?? null,
          institution: data.institution ?? null,
          field_of_study: data.fieldOfStudy ?? null,
          graduation_year: data.graduationYear ?? null,
        },
        create: {
          intern_id: r.id,
          education_level: data.educationLevel,
          institution: data.institution,
          field_of_study: data.fieldOfStudy,
          graduation_year: data.graduationYear,
        },
      })
      if (internship) {
        await tx.internship.update({
          where: { id: internship.id },
          data: {
            title: data.internshipTitle ?? internship.title,
            position_id: data.positionId,
            department_id: data.departmentId,
            start_date: start,
            expected_end_date: end,
            work_mode: data.workMode,
            location: data.location ?? null,
            description: data.description ?? null,
          },
        })
      }
      await lifecycleRepository.record(tx, {
        organizationId: ctx.organization.id,
        internId: r.id,
        type: datesChanged ? 'DATES_CHANGED' : 'DETAILS_UPDATED',
        description: datesChanged
          ? `Internship dates changed to ${data.joiningDate} – ${data.expectedEndDate}`
          : 'Internship details updated',
        actorUserId: ctx.actor.userId,
      })
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.INTERN_UPDATED,
      resourceType: 'intern',
      resourceId: r.id,
      metadata: { fields: Object.keys(data), datesChanged },
    })
    if (internship) {
      await auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.INTERNSHIP_UPDATED,
        resourceType: 'internship',
        resourceId: internship.id,
        metadata: { datesChanged },
      })
    }
    await domainEvents.emit('intern.updated', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { internId: r.id, fields: Object.keys(data) },
    })
  },

  /** Assigns (or clears) the manager or mentor. Audited and recorded on the timeline. */
  async assign(ctx: RequestContext, input: unknown) {
    const data = parseInput(
      z.strictObject({
        internId: z.uuid(),
        role: z.enum(['manager', 'mentor']),
        userId: z
          .string()
          .transform((value) => value || null)
          .pipe(z.uuid().nullable()),
      }),
      input,
    )
    const access = await resolveInternAccess(ctx, data.internId)
    if (!access.can.assignPeople) throw new ForbiddenError()
    if (data.userId) await assertStaff(ctx.organization.id, data.userId, 'userId')
    const r = access.record
    const previous = data.role === 'manager' ? r.manager_id : r.mentor_id
    if (previous === data.userId) return { changed: false }

    const field = data.role === 'manager' ? 'manager_id' : 'mentor_id'
    const internship = r.internships[0]
    const newName = data.userId
      ? fullName(
          await prisma.user.findUniqueOrThrow({
            where: { id: data.userId },
            select: { first_name: true, last_name: true, display_name: true },
          }),
        )
      : null
    const moved = await prisma.$transaction(async (tx) => {
      await tx.intern.update({ where: { id: r.id }, data: { [field]: data.userId } })
      if (internship) await tx.internship.update({ where: { id: internship.id }, data: { [field]: data.userId } })
      // Open onboarding items owned by the old manager/mentor move to the new one.
      const moved = internship
        ? await tx.onboardingItem.findMany({
            where: {
              internship_id: internship.id,
              assigned_role: data.role === 'manager' ? 'MANAGER' : 'MENTOR',
              status: { notIn: ['COMPLETED', 'SKIPPED'] },
            },
            select: { id: true },
          })
        : []
      if (moved.length) {
        await tx.onboardingItem.updateMany({
          where: { id: { in: moved.map((item) => item.id) } },
          data: { assigned_to: data.userId },
        })
      }
      await lifecycleRepository.record(tx, {
        organizationId: ctx.organization.id,
        internId: r.id,
        type: data.role === 'manager' ? 'MANAGER_ASSIGNED' : 'MENTOR_ASSIGNED',
        description: newName
          ? `${data.role === 'manager' ? 'Manager' : 'Mentor'} set to ${newName}`
          : `${data.role === 'manager' ? 'Manager' : 'Mentor'} removed`,
        actorUserId: ctx.actor.userId,
        metadata: { from: previous, to: data.userId },
      })
      return moved
    })
    await auditService.logForContext(ctx, {
      action: data.role === 'manager' ? AUDIT_ACTIONS.MANAGER_ASSIGNED : AUDIT_ACTIONS.MENTOR_ASSIGNED,
      resourceType: 'intern',
      resourceId: r.id,
      metadata: { from: previous, to: data.userId },
    })
    await domainEvents.emit(data.role === 'manager' ? 'intern.manager_assigned' : 'intern.mentor_assigned', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload:
        data.role === 'manager'
          ? { internId: r.id, managerId: data.userId, previousManagerId: previous }
          : { internId: r.id, mentorId: data.userId, previousMentorId: previous },
    } as never)
    if (data.userId) {
      const assigneeId = data.userId
      await emitItemAssignments(
        ctx,
        r.id,
        moved.map((item) => ({ itemId: item.id, assigneeId })),
      )
    }
    return { changed: true }
  },

  /** An intern's own editable profile fields. Resolved from the session — never from a client id. */
  async updateOwnProfile(ctx: RequestContext, input: unknown) {
    const data = parseInput(updateOwnInternProfileSchema, input)
    const internId = await this.myInternId(ctx)
    if (!internId) throw new NotFoundError('Intern')
    const access = await resolveInternAccess(ctx, internId)
    if (!access.can.editSelfProfile) throw new ForbiddenError()
    await prisma.$transaction([
      prisma.user.update({ where: { id: ctx.actor.userId }, data: { phone: data.phone ?? null } }),
      prisma.internProfile.upsert({
        where: { intern_id: internId },
        update: {
          bio: data.bio ?? null,
          city: data.city ?? null,
          state: data.state ?? null,
          country: data.country ?? null,
        },
        create: { intern_id: internId, bio: data.bio, city: data.city, state: data.state, country: data.country },
      }),
    ])
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.INTERN_UPDATED,
      resourceType: 'intern',
      resourceId: internId,
      metadata: { fields: Object.keys(data), self: true },
    })
  },

  /**
   * Interns the viewer manages or mentors, with progress summaries. Open task
   * counts are included only when the viewer may read tasks (their interns'
   * tasks are within an ASSIGNED task scope).
   */
  async related(ctx: RequestContext, relation: 'managed' | 'mentored') {
    authorizationService.require(ctx, 'intern.read')
    const today = todayIn(ctx.organization.timezone)
    const rows = await internRepository.listRelated(
      ctx.organization.id,
      relation === 'managed' ? { managerId: ctx.actor.userId } : { mentorId: ctx.actor.userId },
    )
    const taskGrant = ctx.actor.permissions.get('task.read')
    const openTasks = taskGrant
      ? await internRepository.openTaskCounts(
          taskScope(ctx.actor, taskGrant),
          rows.map((row) => row.user.id),
        )
      : null
    return rows.map(({ internships, ...row }) => {
      const internship = internships[0]
      return {
        ...row,
        progress: internshipProgress({
          start: internship?.start_date ?? row.joining_date,
          expectedEnd: internship?.expected_end_date ?? row.expected_end_date,
          actualEnd: internship?.actual_end_date,
          status: row.status,
          today,
        }),
        onboarding: internship?.onboarding ? onboardingProgress(internship.onboarding_items, today) : null,
        openTasks: openTasks ? (openTasks.get(row.user.id) ?? 0) : null,
      }
    })
  },

  /** Programme headline figures for HR/Admin dashboards (intern.create + intern.read scope). */
  async programmeTotals(ctx: RequestContext) {
    authorizationService.require(ctx, 'intern.create')
    const scope = internScope(ctx.actor, authorizationService.require(ctx, 'intern.read'))
    const today = todayIn(ctx.organization.timezone)
    const [byStatus, upcomingJoins] = await Promise.all([
      internRepository.countByStatus(scope),
      internRepository.countFiltered(scope, { joinedFrom: today, joinedTo: addDays(today, UPCOMING_JOIN_DAYS) }),
    ])
    return { ...statusTotals(byStatus), upcomingJoins }
  },

  /** Lifecycle timeline (staff with access to the record; not the intern themself). */
  async activity(ctx: RequestContext, internId: string) {
    const access = await resolveInternAccess(ctx, parseInput(z.uuid(), internId))
    if (!access.can.viewActivity) throw new ForbiddenError()
    return lifecycleRepository.listForIntern(access.record.id)
  },

  /**
   * Read-only tasks and projects for the profile, limited to what the viewer
   * could see anyway (their own task/project scopes). Null when the viewer
   * has no access to that kind of record.
   */
  async work(ctx: RequestContext, internId: string) {
    const access = await resolveInternAccess(ctx, parseInput(z.uuid(), internId))
    const userId = access.record.user_id
    const taskGrant = ctx.actor.permissions.get('task.read')
    const projectGrant = ctx.actor.permissions.get('project.read')
    const [tasks, projects] = await Promise.all([
      taskGrant
        ? prisma.task.findMany({
            where: {
              AND: [taskScope(ctx.actor, taskGrant), { deleted_at: null, assignees: { some: { user_id: userId } } }],
            },
            orderBy: [{ due_date: { sort: 'asc', nulls: 'last' } }],
            take: 50,
            select: {
              id: true,
              title: true,
              status: true,
              priority: true,
              due_date: true,
              project: { select: { name: true } },
            },
          })
        : null,
      projectGrant
        ? prisma.project.findMany({
            where: {
              AND: [
                projectScope(ctx.actor, projectGrant),
                { deleted_at: null, members: { some: { user_id: userId } } },
              ],
            },
            orderBy: { created_at: 'desc' },
            take: 50,
            select: { id: true, name: true, status: true, target_end_date: true },
          })
        : null,
    ])
    return { tasks, projects }
  },

  /** HR dashboard data (organization- or team-scoped by the viewer's intern.read grant). */
  async hrOverview(ctx: RequestContext) {
    authorizationService.require(ctx, 'intern.create')
    const scope = internScope(ctx.actor, authorizationService.require(ctx, 'intern.read'))
    const today = todayIn(ctx.organization.timezone)
    const page = (filter: InternDirectoryFilter, sort: (typeof INTERN_SORTS)[number], dir: 'asc' | 'desc') =>
      internRepository.directoryPage(scope, { filter, sort, dir, skip: 0, take: 6 }).then(([rows]) => rows)
    const joinWindow = { joinedFrom: today, joinedTo: addDays(today, UPCOMING_JOIN_DAYS) }
    const [byStatus, endingSoon, joining, recent, unassigned, upcomingJoins] = await Promise.all([
      internRepository.countByStatus(scope),
      page({ status: 'ENDING_SOON' }, 'end', 'asc'),
      page({ joinedFrom: today }, 'joining', 'asc'),
      page({}, 'created', 'desc'),
      internRepository.countUnassigned(scope, ['SELECTED', 'ONBOARDING', 'ACTIVE', 'ENDING_SOON']),
      internRepository.countFiltered(scope, joinWindow),
    ])
    return {
      byStatus,
      totals: statusTotals(byStatus),
      upcomingJoins,
      endingSoon,
      joining,
      recent,
      unassigned,
    }
  },

  async relationCounts(ctx: RequestContext) {
    const [managed, mentored] = await internRepository.countRelated(ctx.organization.id, ctx.actor.userId)
    return { managed, mentored }
  },

  /** Relationship facts for navigation (cheap counts; no permission needed to know about yourself). */
  async navFacts(ctx: RequestContext) {
    const [{ managed, mentored }, own] = await Promise.all([
      this.relationCounts(ctx),
      internRepository.findByUserId(ctx.organization.id, ctx.actor.userId),
    ])
    return { isIntern: Boolean(own), managesInterns: managed > 0, mentorsInterns: mentored > 0 }
  },
}

export type InternProfileView = Awaited<ReturnType<typeof internService.getProfile>>
export type InternDirectoryPage = Awaited<ReturnType<typeof internService.directory>>
