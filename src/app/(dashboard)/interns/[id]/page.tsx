import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BookOpen, Clock, Gauge, Palmtree } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { AccessDenied } from '@/components/common/states'
import { UserAvatar } from '@/components/common/user-avatar'
import { Breadcrumbs } from '@/components/navigation/breadcrumbs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DocumentsPanel } from '@/features/interns/components/documents-panel'
import { OnboardingChecklist } from '@/features/interns/components/onboarding-checklist'
import { OwnInternProfileForm } from '@/features/interns/components/own-profile-form'
import { ProfileActions } from '@/features/interns/components/profile-actions'
import {
  ActivityTimeline,
  Detail,
  ModuleComingSoon,
  ProfileTabs,
  ProjectsList,
  TasksList,
  type ProfileTab,
} from '@/features/interns/components/profile-view'
import { InternshipProgressBar, OnboardingProgressBar } from '@/features/interns/components/progress'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { formatDateOnly } from '@/lib/interns/dates'
import { formatDay, humanizeEnum } from '@/lib/utils'
import { idSchema } from '@/lib/validation'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { DOCUMENT_TYPE_LABELS, documentService, VISIBILITY_LABELS } from '@/server/services/document.service'
import { internService } from '@/server/services/intern.service'
import { onboardingService } from '@/server/services/onboarding.service'

export const metadata: Metadata = { title: 'Intern' }

/**
 * Intern profile. Access is resolved once (intern-access.ts): records outside
 * the viewer's scope are 404, and each field/tab is included only when the
 * viewer may see it — hidden data is never sent to the browser.
 */
export default async function InternProfilePage({ params, searchParams }: PageProps<'/interns/[id]'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  if (!idSchema.safeParse(id).success) notFound()

  let profile: Awaited<ReturnType<typeof internService.getProfile>>
  try {
    profile = await internService.getProfile(ctx, id)
  } catch (error) {
    if (error instanceof NotFoundError) notFound()
    if (error instanceof ForbiddenError) return <AccessDenied what="intern profiles" />
    throw error
  }
  const { can, relation } = profile
  const hasTasks = ctx.actor.permissions.has('task.read')
  const hasProjects = ctx.actor.permissions.has('project.read')

  const tabs: ProfileTab[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'internship', label: 'Internship' },
    ...(can.viewOnboarding || can.manageOnboarding ? [{ key: 'onboarding', label: 'Onboarding' }] : []),
    ...(hasTasks ? [{ key: 'tasks', label: 'Tasks' }] : []),
    ...(hasProjects ? [{ key: 'projects', label: 'Projects' }] : []),
    { key: 'attendance', label: 'Attendance' },
    { key: 'leave', label: 'Leave' },
    { key: 'learning', label: 'Learning' },
    { key: 'performance', label: 'Performance' },
    ...(can.viewDocuments ? [{ key: 'documents', label: 'Documents' }] : []),
    ...(can.viewActivity ? [{ key: 'activity', label: 'Activity' }] : []),
  ]
  const requested = (await searchParams).tab
  const tab = tabs.find((t) => t.key === requested)?.key ?? 'overview'
  const basePath = `/interns/${profile.id}`

  const showActions = can.editDetails || can.assignPeople || can.transition || can.close
  const options = showActions ? await internService.formOptions(ctx) : null
  const canInvite = can.editDetails && authorizationService.can(ctx, 'user.invite')

  return (
    <>
      {!relation.isSelf && (
        <Breadcrumbs
          items={[
            relation.orgWide
              ? { label: 'Interns', href: '/interns' }
              : relation.isManager
                ? { label: 'My Interns', href: '/my-interns' }
                : relation.isMentor
                  ? { label: 'My Mentees', href: '/my-mentees' }
                  : { label: 'Interns', href: '/interns' },
            { label: profile.name },
          ]}
        />
      )}
      <header className="mb-6 mt-2 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <UserAvatar person={profile.person} className="size-16" />
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-h1">{relation.isSelf ? 'My internship' : profile.name}</h1>
              <StatusBadge status={profile.status} />
            </div>
            <p className="text-small text-muted-foreground">
              <span className="font-mono">{profile.employeeCode}</span>
              {' · '}
              {profile.position?.title ?? 'No position'}
              {profile.department && ` · ${profile.department.name}`}
            </p>
          </div>
        </div>
        {showActions && options && (
          <ProfileActions
            intern={{
              id: profile.id,
              name: profile.name,
              status: profile.status,
              firstName: profile.person.first_name,
              lastName: profile.person.last_name,
              phone: profile.phone,
              departmentId: profile.department?.id ?? null,
              teamId: profile.team?.id ?? null,
              positionId: profile.position?.id ?? null,
              managerId: profile.manager?.id ?? null,
              mentorId: profile.mentor?.id ?? null,
              joiningDate: profile.joiningDate ? formatDateOnly(profile.joiningDate) : '',
              expectedEndDate: profile.expectedEndDate ? formatDateOnly(profile.expectedEndDate) : '',
              workMode: profile.internship?.workMode ?? null,
              location: profile.internship?.location ?? null,
              internshipTitle: profile.internship?.title ?? null,
              description: profile.internship?.description ?? null,
              education: profile.education
                ? {
                    level: profile.education.level,
                    institution: profile.education.institution,
                    fieldOfStudy: profile.education.fieldOfStudy,
                    graduationYear: profile.education.graduationYear,
                  }
                : null,
              onboardingComplete: profile.internship?.onboarding ? Boolean(profile.internship.onboarding.completed_at) : null,
              accountInvited: profile.accountStatus === 'INVITED',
            }}
            options={options}
            can={{ edit: can.editDetails, assign: can.assignPeople, transition: can.transition, close: can.close, invite: canInvite }}
          />
        )}
      </header>

      <Card className="mb-6">
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-[1fr_auto] sm:items-center">
          <InternshipProgressBar progress={profile.progress} />
          <p className="text-small text-muted-foreground sm:text-right">
            {formatDay(profile.joiningDate)} – {formatDay(profile.actualEndDate ?? profile.expectedEndDate)}
          </p>
        </CardContent>
      </Card>

      <ProfileTabs tabs={tabs} active={tab} basePath={basePath} />

      {tab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2">
                <Detail label="Email" value={profile.email} />
                <Detail label="Phone" value={profile.phone} />
                <Detail label="Department" value={profile.department?.name} />
                <Detail label="Team" value={profile.team?.name} />
                <Detail label="Position" value={profile.position?.title} />
                <Detail label="Manager" value={profile.manager?.name} />
                <Detail label="Mentor" value={profile.mentor?.name} />
                <Detail label="Account" value={humanizeEnum(profile.accountStatus)} />
              </dl>
            </CardContent>
          </Card>
          <div className="space-y-6">
            {profile.education && (
              <Card>
                <CardHeader>
                  <CardTitle>Education</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid gap-4">
                    <Detail label="Institution" value={profile.education.institution} />
                    <Detail label="Field of study" value={profile.education.fieldOfStudy} />
                    <Detail
                      label="Level"
                      value={[profile.education.level, profile.education.graduationYear].filter(Boolean).join(' · ')}
                    />
                    <Detail
                      label="Location"
                      value={[profile.education.city, profile.education.state, profile.education.country].filter(Boolean).join(', ')}
                    />
                  </dl>
                </CardContent>
              </Card>
            )}
            {profile.emergencyContacts && (
              <Card>
                <CardHeader>
                  <CardTitle>Emergency contacts</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {profile.emergencyContacts.length === 0 && <p className="text-small text-muted-foreground">None recorded.</p>}
                  {profile.emergencyContacts.map((contact) => (
                    <div key={contact.id} className="text-small">
                      <p className="font-medium">
                        {contact.name} <span className="font-normal text-muted-foreground">({contact.relationship})</span>
                      </p>
                      <p className="text-muted-foreground">{[contact.phone, contact.email].filter(Boolean).join(' · ')}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
          {profile.education?.bio && !can.editSelfProfile && (
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>About</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-line text-small">{profile.education.bio}</p>
              </CardContent>
            </Card>
          )}
          {can.editSelfProfile && (
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Your contact details</CardTitle>
                <CardDescription>You can update these. HR manages your placement, dates and other records.</CardDescription>
              </CardHeader>
              <CardContent>
                <OwnInternProfileForm
                  initial={{
                    phone: profile.phone,
                    bio: profile.education?.bio ?? null,
                    city: profile.education?.city ?? null,
                    state: profile.education?.state ?? null,
                    country: profile.education?.country ?? null,
                  }}
                />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {tab === 'internship' && (
        <Card>
          <CardHeader>
            <CardTitle>{profile.internship?.title ?? 'Internship'}</CardTitle>
            {profile.internship?.description && <CardDescription className="whitespace-pre-line">{profile.internship.description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-3">
              <Detail label="Status" value={<StatusBadge status={profile.status} />} />
              <Detail label="Joining date" value={formatDay(profile.joiningDate)} />
              <Detail label="Expected end" value={formatDay(profile.expectedEndDate)} />
              <Detail label="Actual end" value={profile.actualEndDate ? formatDay(profile.actualEndDate) : null} />
              <Detail label="Work mode" value={profile.internship?.workMode ? humanizeEnum(profile.internship.workMode) : null} />
              <Detail label="Location" value={profile.internship?.location} />
              <Detail label="Total days" value={profile.progress.totalDays || null} />
              <Detail label="Current day" value={profile.progress.state === 'in_progress' ? profile.progress.day : null} />
              <Detail label="Days remaining" value={profile.progress.state === 'in_progress' ? profile.progress.daysRemaining : null} />
            </dl>
          </CardContent>
        </Card>
      )}

      {tab === 'onboarding' && <OnboardingTab ctx={ctx} internId={profile.id} isSelf={relation.isSelf} />}

      {tab === 'tasks' && <WorkTab ctx={ctx} internId={profile.id} kind="tasks" />}
      {tab === 'projects' && <WorkTab ctx={ctx} internId={profile.id} kind="projects" />}

      {tab === 'attendance' && (
        <ModuleComingSoon icon={Clock} title="Attendance" phase="05" description="Daily check-ins, attendance history and corrections." />
      )}
      {tab === 'leave' && (
        <ModuleComingSoon icon={Palmtree} title="Leave" phase="05" description="Leave requests, approvals and balances." />
      )}
      {tab === 'learning' && (
        <ModuleComingSoon icon={BookOpen} title="Learning progress" phase="07" description="Course enrolments, progress and completions." />
      )}
      {tab === 'performance' && (
        <ModuleComingSoon icon={Gauge} title="Performance" phase="06" description="Reviews, feedback and check-ins from manager and mentor." />
      )}

      {tab === 'documents' && <DocumentsTab ctx={ctx} internId={profile.id} />}
      {tab === 'activity' && <ActivityTab ctx={ctx} internId={profile.id} />}
    </>
  )
}

type Ctx = Awaited<ReturnType<typeof requirePageContext>>

async function OnboardingTab({ ctx, internId, isSelf }: { ctx: Ctx; internId: string; isSelf: boolean }) {
  const checklist = await onboardingService.getChecklist(ctx, internId)
  if (!checklist.onboarding) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-small text-muted-foreground">
          Onboarding hasn’t started. It begins when the intern moves to Onboarding.
        </CardContent>
      </Card>
    )
  }
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>{checklist.onboarding.template_name ?? 'Onboarding'}</CardTitle>
            <CardDescription>
              {checklist.onboarding.completed_at
                ? `Completed ${formatDay(checklist.onboarding.completed_at)}`
                : `Started ${formatDay(checklist.onboarding.started_at)}`}
            </CardDescription>
          </div>
          <Link href={`/interns/${internId}/onboarding`} className="shrink-0 text-small font-medium text-primary hover:underline">
            Full checklist
          </Link>
        </CardHeader>
        <CardContent>
          <OnboardingProgressBar progress={checklist.progress} />
        </CardContent>
      </Card>
      <OnboardingChecklist internId={internId} items={checklist.items} isSelf={isSelf} documentTypeLabels={DOCUMENT_TYPE_LABELS} />
    </div>
  )
}

async function WorkTab({ ctx, internId, kind }: { ctx: Ctx; internId: string; kind: 'tasks' | 'projects' }) {
  const work = await internService.work(ctx, internId)
  if (kind === 'tasks') return work.tasks ? <TasksList tasks={work.tasks} /> : <AccessDenied what="tasks" />
  return work.projects ? <ProjectsList projects={work.projects} /> : <AccessDenied what="projects" />
}

async function DocumentsTab({ ctx, internId }: { ctx: Ctx; internId: string }) {
  const result = await documentService.listForIntern(ctx, internId)
  return (
    <DocumentsPanel
      internId={internId}
      documents={result.documents}
      canUpload={result.canUpload}
      assignable={result.assignable}
      typeLabels={DOCUMENT_TYPE_LABELS}
      visibilityLabels={VISIBILITY_LABELS}
      timeZone={ctx.organization.timezone}
    />
  )
}

async function ActivityTab({ ctx, internId }: { ctx: Ctx; internId: string }) {
  const events = await internService.activity(ctx, internId)
  return <ActivityTimeline events={events} />
}
