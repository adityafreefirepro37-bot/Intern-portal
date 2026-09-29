import { setAuthProviderForTesting } from '@/lib/auth/provider'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { addDays, formatDateOnly, todayIn } from '@/lib/interns/dates'
import type { RequestContext } from '@/server/context'
import { AUDIT_ACTIONS } from '@/server/services/audit-actions'
import { milestoneService } from '@/server/services/milestone.service'
import { projectLifecycleService } from '@/server/services/project-lifecycle.service'
import { projectService } from '@/server/services/project.service'
import { taskCollaborationService } from '@/server/services/task-collaboration.service'
import { taskLifecycleService } from '@/server/services/task-lifecycle.service'
import { taskSubmissionService } from '@/server/services/task-submission.service'
import { taskService } from '@/server/services/task.service'
import { workJobsService } from '@/server/services/work-jobs.service'
import { workService } from '@/server/services/work.service'
import { workloadService } from '@/server/services/workload.service'
import type { FakeAuthProvider } from './fake-auth'
import { AYAVA_ORGANIZATION_ID, contextFor, createUser, prisma, uniqueSuffix, useFakeAuth } from './helpers'

let fake: FakeAuthProvider
beforeAll(() => {
  fake = useFakeAuth()
})
afterAll(async () => {
  setAuthProviderForTesting(null)
  await prisma.$disconnect()
})

const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
const pdf = (name = 'work.pdf') => ({ name, type: 'application/pdf', bytes: PDF })

let manager: RequestContext // Arjun: Marketing manager (not on the website project)
let intern: RequestContext // Aanya
let mentor: RequestContext // Rohan
let hr: RequestContext
let admin: RequestContext

beforeAll(async () => {
  manager = await contextFor('manager@ayavacreatives.com')
  intern = await contextFor('intern@ayavacreatives.com')
  mentor = await contextFor('mentor@ayavacreatives.com')
  hr = await contextFor('hr@ayavacreatives.com')
  admin = await contextFor('admin@ayavacreatives.com')
})

function dateIn(days: number) {
  return formatDateOnly(addDays(todayIn('Asia/Kolkata'), days))
}

/** Manager creates a project with the intern as contributor. */
async function projectWithIntern(name = `Client pitch ${uniqueSuffix()}`) {
  const { id } = await projectService.create(manager, {
    name,
    priority: 'HIGH',
    startDate: dateIn(0),
    targetEndDate: dateIn(30),
  })
  await projectService.setMember(manager, { projectId: id, userId: intern.actor.userId, role: 'CONTRIBUTOR' })
  return id
}

describe('work management flow (manager → intern → review)', () => {
  it('create project → members → milestone → task → start → submit → changes → resubmit → approve', async () => {
    const projectId = await projectWithIntern()
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { members: true } })
    expect(project.status).toBe('PLANNING')
    expect(project.members.map((m) => m.role).sort()).toEqual(['CONTRIBUTOR', 'OWNER'])

    await projectLifecycleService.transitionStatus(manager, { projectId, to: 'ACTIVE' })
    const milestone = await milestoneService.create(manager, projectId, { name: 'Design', dueDate: dateIn(10) })

    const { id: taskId } = await taskService.create(manager, {
      title: 'Landing page hero',
      projectId,
      milestoneId: milestone.id,
      priority: 'HIGH',
      dueDate: dateIn(5),
      estimatedHours: '6',
      assigneeIds: [intern.actor.userId],
    })
    let task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } })
    expect(task.status).toBe('ASSIGNED')

    // The intern sees it in My Work and starts it.
    const myWork = await workService.myWork(intern)
    expect(myWork!.waitingForMe.some((t) => t.id === taskId)).toBe(true)
    await taskLifecycleService.transitionStatus(intern, { taskId, to: 'IN_PROGRESS' })
    task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } })
    expect(task.started_at).not.toBeNull()
    expect(await prisma.milestone.findUniqueOrThrow({ where: { id: milestone.id } })).toMatchObject({
      status: 'ACTIVE',
    })

    // Interns can't mark their own work complete — only reviewers (via approval) or leads can.
    await expect(taskLifecycleService.transitionStatus(intern, { taskId, to: 'COMPLETED' })).rejects.toBeInstanceOf(
      ForbiddenError,
    )

    // Submit v1 with a file.
    const v1 = await taskSubmissionService.submit(intern, { taskId, message: 'First draft of the hero.' }, [
      pdf('hero-v1.pdf'),
    ])
    expect(v1.version).toBe(1)
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe('IN_REVIEW')
    await expect(taskSubmissionService.submit(intern, { taskId, message: 'again' })).rejects.toBeInstanceOf(
      ValidationError,
    )

    // Manager requests changes (a comment is required).
    await expect(taskSubmissionService.review(manager, { taskId, decision: 'REQUEST_CHANGES' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    await taskSubmissionService.review(manager, {
      taskId,
      decision: 'REQUEST_CHANGES',
      comment: 'Tighten the headline.',
    })
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe('CHANGES_REQUESTED')

    // Intern resubmits (v2) — v1 is preserved unchanged.
    await taskLifecycleService.transitionStatus(intern, { taskId, to: 'IN_PROGRESS' })
    const v2 = await taskSubmissionService.submit(intern, { taskId, message: 'Headline shortened.' }, [
      pdf('hero-v2.pdf'),
    ])
    expect(v2.version).toBe(2)
    await taskSubmissionService.review(manager, { taskId, decision: 'APPROVE' })

    task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } })
    expect(task.status).toBe('COMPLETED')
    expect(task.completed_at).not.toBeNull()

    const versions = await prisma.submissionVersion.findMany({
      where: { submission: { task_id: taskId } },
      orderBy: { version_number: 'asc' },
      include: { attachments: true },
    })
    expect(versions.map((v) => [v.version_number, v.status])).toEqual([
      [1, 'CHANGES_REQUESTED'],
      [2, 'APPROVED'],
    ])
    expect(versions[0].review_comment).toBe('Tighten the headline.')
    expect(versions[0].reviewed_by).toBe(manager.actor.userId)
    expect(versions.map((v) => v.attachments.map((a) => a.file_name))).toEqual([['hero-v1.pdf'], ['hero-v2.pdf']])
    const submission = await prisma.taskSubmission.findFirstOrThrow({ where: { task_id: taskId } })
    expect(submission.status).toBe('APPROVED')

    // Progress, activity and notifications.
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).progress_percentage).toBe(100)
    const { activity } = await projectService.listActivity(manager, projectId)
    expect(activity.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        AUDIT_ACTIONS.PROJECT_CREATED,
        AUDIT_ACTIONS.PROJECT_MEMBER_ADDED,
        AUDIT_ACTIONS.MILESTONE_CREATED,
        AUDIT_ACTIONS.TASK_CREATED,
        AUDIT_ACTIONS.TASK_ASSIGNED,
        AUDIT_ACTIONS.TASK_STATUS_CHANGED,
        AUDIT_ACTIONS.TASK_SUBMITTED,
        AUDIT_ACTIONS.TASK_REVIEWED,
      ]),
    )
    const internNotes = await prisma.notification.findMany({
      where: { user_id: intern.actor.userId, related_entity_id: { in: [taskId, projectId] } },
    })
    expect(internNotes.map((n) => n.type)).toEqual(
      expect.arrayContaining(['PROJECT_MEMBER_ADDED', 'TASK_ASSIGNED', 'TASK_CHANGES_REQUESTED', 'TASK_APPROVED']),
    )
    const managerNotes = await prisma.notification.findMany({
      where: { user_id: manager.actor.userId, related_entity_id: taskId },
    })
    expect(managerNotes.map((n) => n.type)).toContain('TASK_SUBMITTED')
  })
})

describe('task rules', () => {
  it('dependencies block starting work and cycles are rejected', async () => {
    const projectId = await projectWithIntern()
    const a = await taskService.create(manager, { title: 'Design', projectId, assigneeIds: [intern.actor.userId] })
    const b = await taskService.create(manager, { title: 'Build', projectId, assigneeIds: [intern.actor.userId] })
    await taskCollaborationService.addDependency(manager, { taskId: b.id, dependsOnTaskId: a.id })
    await expect(
      taskCollaborationService.addDependency(manager, { taskId: a.id, dependsOnTaskId: b.id }),
    ).rejects.toThrow(/circular/)
    await expect(
      taskCollaborationService.addDependency(manager, { taskId: a.id, dependsOnTaskId: a.id }),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      taskCollaborationService.addDependency(manager, { taskId: b.id, dependsOnTaskId: a.id }),
    ).rejects.toBeInstanceOf(ConflictError)
    await expect(taskLifecycleService.transitionStatus(intern, { taskId: b.id, to: 'IN_PROGRESS' })).rejects.toThrow(
      /Waiting on/,
    )
    // Once A is done, B can start.
    await taskLifecycleService.transitionStatus(manager, { taskId: a.id, to: 'IN_PROGRESS' })
    await taskLifecycleService.transitionStatus(manager, { taskId: a.id, to: 'COMPLETED' })
    await taskLifecycleService.transitionStatus(intern, { taskId: b.id, to: 'IN_PROGRESS' })
  })

  it('blocking needs a reason; review statuses can’t be set directly; subtasks nest one level', async () => {
    const projectId = await projectWithIntern()
    const { id } = await taskService.create(manager, {
      title: 'Copy deck',
      projectId,
      assigneeIds: [intern.actor.userId],
    })
    await taskLifecycleService.transitionStatus(intern, { taskId: id, to: 'IN_PROGRESS' })
    await expect(taskLifecycleService.transitionStatus(intern, { taskId: id, to: 'BLOCKED' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    await taskLifecycleService.transitionStatus(intern, {
      taskId: id,
      to: 'BLOCKED',
      reason: 'Waiting for brand assets',
    })
    const blocked = await prisma.task.findUniqueOrThrow({ where: { id } })
    expect(blocked).toMatchObject({
      status: 'BLOCKED',
      previous_status: 'IN_PROGRESS',
      blocked_reason: 'Waiting for brand assets',
    })
    await taskLifecycleService.transitionStatus(intern, { taskId: id, to: 'IN_PROGRESS' })
    await expect(taskLifecycleService.transitionStatus(manager, { taskId: id, to: 'IN_REVIEW' })).rejects.toThrow(
      /Submit the work/,
    )

    const sub = await taskService.create(manager, { title: 'Headline', parentTaskId: id })
    await expect(taskService.create(manager, { title: 'Too deep', parentTaskId: sub.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    // A parent can't be completed while a subtask is open.
    await expect(taskLifecycleService.transitionStatus(manager, { taskId: id, to: 'COMPLETED' })).rejects.toThrow(
      /subtasks/,
    )
  })

  it('assignees must be project members; duplicates collapse; interns can’t assign', async () => {
    const projectId = await projectWithIntern()
    const { id } = await taskService.create(manager, { title: 'Moodboard', projectId })
    const outsider = await prisma.user.findFirstOrThrow({ where: { email: 'zara.khan@demo.ayavacreatives.com' } })
    await expect(taskService.setAssignees(manager, { taskId: id, assigneeIds: [outsider.id] })).rejects.toThrow(
      /project members/,
    )
    await taskService.setAssignees(manager, { taskId: id, assigneeIds: [intern.actor.userId, intern.actor.userId] })
    expect(await prisma.taskAssignee.count({ where: { task_id: id } })).toBe(1)
    expect((await prisma.task.findUniqueOrThrow({ where: { id } })).status).toBe('ASSIGNED') // backlog → assigned
    await expect(
      taskService.setAssignees(intern, { taskId: id, assigneeIds: [intern.actor.userId] }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(taskService.create(intern, { title: 'Sneaky', projectId })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('bulk actions check every task individually', async () => {
    const projectId = await projectWithIntern()
    const mine = await taskService.create(manager, { title: 'Mine', projectId })
    const website = await prisma.task.findFirstOrThrow({
      where: { project: { slug: 'ayava-website-redesign' }, deleted_at: null },
    })
    const result = await taskService.bulk(manager, {
      taskIds: [mine.id, website.id],
      action: 'priority',
      value: 'URGENT',
    })
    expect(result.succeeded).toBe(1)
    expect(result.failed.map((f) => f.id)).toEqual([website.id])
    expect((await prisma.task.findUniqueOrThrow({ where: { id: mine.id } })).priority).toBe('URGENT')
    expect((await prisma.task.findUniqueOrThrow({ where: { id: website.id } })).priority).not.toBe('URGENT')
  })

  it('comments notify mentioned participants only; closed tasks are read-only', async () => {
    const projectId = await projectWithIntern()
    const { id } = await taskService.create(manager, {
      title: 'Pitch deck',
      projectId,
      assigneeIds: [intern.actor.userId],
    })
    const stranger = await prisma.user.findFirstOrThrow({ where: { email: 'zara.khan@demo.ayavacreatives.com' } })
    await taskCollaborationService.addComment(manager, {
      taskId: id,
      body: `@[Aanya Sharma](${intern.actor.userId}) please start with slide 3. cc @[Zara](${stranger.id})`,
    })
    const mentions = await prisma.taskCommentMention.findMany({ where: { comment: { task_id: id } } })
    expect(mentions.map((m) => m.user_id)).toEqual([intern.actor.userId])
    expect(
      await prisma.notification.count({
        where: { user_id: intern.actor.userId, related_entity_id: id, type: 'TASK_COMMENT_MENTION' },
      }),
    ).toBe(1)
    expect(await prisma.notification.count({ where: { user_id: stranger.id, related_entity_id: id } })).toBe(0)

    await taskCollaborationService.addChecklistItem(intern, { taskId: id, title: 'Outline' })
    await taskLifecycleService.transitionStatus(manager, { taskId: id, to: 'CANCELLED', reason: 'Client paused' })
    await expect(taskCollaborationService.addChecklistItem(intern, { taskId: id, title: 'More' })).rejects.toThrow(
      /closed/,
    )
  })

  it('projects and milestones can’t complete with open work', async () => {
    const projectId = await projectWithIntern()
    await projectLifecycleService.transitionStatus(manager, { projectId, to: 'ACTIVE' })
    const milestone = await milestoneService.create(manager, projectId, { name: 'Phase 1' })
    await taskService.create(manager, { title: 'Open task', projectId, milestoneId: milestone.id })
    await expect(milestoneService.command(manager, { milestoneId: milestone.id, command: 'complete' })).rejects.toThrow(
      /still open/,
    )
    await expect(projectLifecycleService.transitionStatus(manager, { projectId, to: 'COMPLETED' })).rejects.toThrow(
      /open task/,
    )
    await expect(
      projectLifecycleService.transitionStatus(manager, { projectId, to: 'CANCELLED' }),
    ).rejects.toBeInstanceOf(ValidationError)
    await projectLifecycleService.transitionStatus(manager, { projectId, to: 'ON_HOLD', reason: 'Waiting on budget' })
    await expect(
      projectLifecycleService.transitionStatus(manager, { projectId, to: 'COMPLETED' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('security', () => {
  async function foreignOrg() {
    const org = await prisma.organization.create({
      data: { name: `Other ${uniqueSuffix()}`, slug: `other-${uniqueSuffix()}` },
    })
    const owner = await prisma.user.create({
      data: { organization_id: org.id, email: `o-${uniqueSuffix()}@elsewhere.dev`, first_name: 'O', last_name: 'W' },
    })
    const project = await prisma.project.create({
      data: { organization_id: org.id, name: 'Foreign', slug: `foreign-${uniqueSuffix()}`, owner_id: owner.id },
    })
    const task = await prisma.task.create({
      data: { organization_id: org.id, project_id: project.id, title: 'Foreign task', created_by: owner.id },
    })
    return { project, task }
  }

  it('nobody can reach another organization’s projects or tasks', async () => {
    const { project, task } = await foreignOrg()
    for (const ctx of [admin, hr, manager, intern]) {
      await expect(projectService.getOverview(ctx, project.id)).rejects.toBeInstanceOf(NotFoundError)
      await expect(taskService.getDetail(ctx, task.id)).rejects.toBeInstanceOf(NotFoundError)
      await expect(
        taskLifecycleService.transitionStatus(ctx, { taskId: task.id, to: 'CANCELLED', reason: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundError)
    }
  })

  it('interns can’t open projects they aren’t on, or their tasks and files', async () => {
    const privateProject = await projectService.create(manager, { name: `Private ${uniqueSuffix()}` })
    const { id: taskId } = await taskService.create(manager, { title: 'Private task', projectId: privateProject.id })
    await taskCollaborationService.uploadAttachment(manager, taskId, pdf('secret.pdf'))
    const file = await projectService.uploadFile(manager, privateProject.id, pdf('brief.pdf'))
    const attachment = await prisma.taskAttachment.findFirstOrThrow({ where: { task_id: taskId } })

    await expect(projectService.getOverview(intern, privateProject.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(taskService.getDetail(intern, taskId)).rejects.toBeInstanceOf(NotFoundError)
    await expect(taskCollaborationService.downloadAttachment(intern, attachment.id)).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(projectService.downloadFile(intern, file.id)).rejects.toBeInstanceOf(NotFoundError)
    const list = await taskService.directory(intern, { closed: '1' })
    expect(list.page.items.some((t) => t.id === taskId)).toBe(false)
    // The manager (owner) can.
    await expect(projectService.downloadFile(manager, file.id)).resolves.toMatchObject({ fileName: 'brief.pdf' })
  })

  it('interns can’t approve their own work; nobody reviews their own submission', async () => {
    const projectId = await projectWithIntern()
    const { id } = await taskService.create(manager, {
      title: 'Self review',
      projectId,
      assigneeIds: [intern.actor.userId, manager.actor.userId],
    })
    await taskLifecycleService.transitionStatus(intern, { taskId: id, to: 'IN_PROGRESS' })
    await taskSubmissionService.submit(intern, { taskId: id, message: 'Done' })
    await expect(taskSubmissionService.review(intern, { taskId: id, decision: 'APPROVE' })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    // The manager is also an assignee here, so they can't review it either.
    await expect(taskSubmissionService.review(manager, { taskId: id, decision: 'APPROVE' })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    // HR (organization-wide reviewer, not involved) can.
    await taskSubmissionService.review(hr, { taskId: id, decision: 'APPROVE' })
  })

  it('managers and mentors can’t modify projects they don’t lead', async () => {
    const website = await prisma.project.findFirstOrThrow({ where: { slug: 'ayava-website-redesign' } })
    const edit = { name: 'Hijacked', priority: 'LOW' }
    await expect(projectService.update(manager, website.id, edit)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(projectService.update(mentor, website.id, edit)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(projectService.update(intern, website.id, edit)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      projectLifecycleService.transitionStatus(manager, { projectId: website.id, to: 'ON_HOLD', reason: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      projectService.setMember(intern, { projectId: website.id, userId: intern.actor.userId, role: 'MANAGER' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    // Viewing is allowed (organization-wide read for managers).
    await expect(projectService.getOverview(manager, website.id)).resolves.toBeDefined()
    // Interns can't be given lead roles.
    const own = await projectWithIntern()
    await expect(
      projectService.setMember(manager, { projectId: own, userId: intern.actor.userId, role: 'MANAGER' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('Admin and Super Admin manage any project organization-wide', async () => {
    const { email } = await createUser(fake, { role: 'admin' })
    const plainAdmin = await contextFor(email)
    expect(plainAdmin.actor.roles.map((r) => r.slug)).toEqual(['admin'])
    const website = await prisma.project.findFirstOrThrow({ where: { slug: 'ayava-website-redesign' } })
    for (const ctx of [plainAdmin, admin]) {
      const overview = await projectService.getOverview(ctx, website.id)
      expect(overview.access.can).toMatchObject({ edit: true, manageMembers: true, createTasks: true })
      await projectService.update(ctx, website.id, {
        name: website.name,
        priority: 'HIGH',
        managerId: website.manager_id ?? '',
      })
    }
  })

  it('smuggled fields are rejected', async () => {
    const projectId = await projectWithIntern()
    await expect(taskService.create(manager, { title: 'x x', projectId, status: 'COMPLETED' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    await expect(
      taskService.create(manager, { title: 'x x', projectId, organizationId: AYAVA_ORGANIZATION_ID }),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      projectService.create(manager, { name: 'Owner swap', ownerId: intern.actor.userId }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('workload, deadlines and search', () => {
  it('computes workload from open assignments', async () => {
    const rows = await workloadService.forUsers(admin, [intern.actor.userId])
    const open = await prisma.taskAssignee.count({
      where: {
        user_id: intern.actor.userId,
        task: { deleted_at: null, status: { in: ['ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'CHANGES_REQUESTED'] } },
      },
    })
    expect(rows[0].active).toBe(open)
    expect(['LOW', 'NORMAL', 'HIGH', 'OVERLOADED']).toContain(rows[0].level)
  })

  it('the daily job emits due-soon and overdue events once per day window', async () => {
    const projectId = await projectWithIntern()
    const { id } = await taskService.create(manager, {
      title: 'Due tomorrow',
      projectId,
      dueDate: dateIn(1),
      assigneeIds: [intern.actor.userId],
    })
    const result = await workJobsService.emitTaskDeadlines({ organizationId: AYAVA_ORGANIZATION_ID })
    expect(result.dueSoon).toBeGreaterThan(0)
    expect(
      await prisma.notification.count({
        where: { user_id: intern.actor.userId, related_entity_id: id, type: 'TASK_DUE_SOON' },
      }),
    ).toBe(1)
  })

  it('task list filters and sorts server-side within scope', async () => {
    const result = await taskService.directory(manager, { status: 'IN_REVIEW', sort: 'priority' })
    expect(result.page.items.length).toBeGreaterThan(0)
    expect(result.page.items.every((t) => t.status === 'IN_REVIEW')).toBe(true)
    const overdue = await taskService.directory(manager, { due: 'overdue' })
    expect(overdue.page.items.every((t) => t.deadline.state === 'OVERDUE')).toBe(true)
  })
})
