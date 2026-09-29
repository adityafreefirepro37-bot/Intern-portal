import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { Card, CardContent } from '@/components/ui/card'
import { OnboardingChecklist } from '@/features/interns/components/onboarding-checklist'
import { OnboardingProgressBar } from '@/features/interns/components/progress'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { formatDay, fullName } from '@/lib/utils'
import { idSchema } from '@/lib/validation'
import { requirePageContext } from '@/server/context'
import { DOCUMENT_TYPE_LABELS } from '@/server/services/document.service'
import { onboardingService } from '@/server/services/onboarding.service'

export const metadata: Metadata = { title: 'Onboarding checklist' }

export default async function InternOnboardingPage({ params }: PageProps<'/interns/[id]/onboarding'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  if (!idSchema.safeParse(id).success) notFound()

  let checklist: Awaited<ReturnType<typeof onboardingService.getChecklist>>
  try {
    checklist = await onboardingService.getChecklist(ctx, id)
  } catch (error) {
    if (error instanceof NotFoundError) notFound()
    if (error instanceof ForbiddenError) return <AccessDenied what="this onboarding checklist" />
    throw error
  }
  const { access } = checklist
  const name = fullName(access.record.user)
  const onboarding = checklist.onboarding

  return (
    <>
      <PageHeader
        title={access.isSelf ? 'My onboarding' : `Onboarding · ${name}`}
        description={
          onboarding
            ? [
                onboarding.template_name ?? 'Checklist',
                `started ${formatDay(onboarding.started_at)}`,
                onboarding.completed_at ? `completed ${formatDay(onboarding.completed_at)}` : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : undefined
        }
        breadcrumbs={
          access.isSelf
            ? [{ label: 'My internship', href: `/interns/${id}` }, { label: 'Onboarding' }]
            : [
                access.orgWide
                  ? { label: 'Onboarding', href: '/onboarding' }
                  : { label: 'Interns', href: `/interns/${id}` },
                { label: name, href: `/interns/${id}` },
                { label: 'Checklist' },
              ]
        }
      />
      {!onboarding ? (
        <Card>
          <CardContent className="py-10 text-center text-small text-muted-foreground">
            Onboarding hasn’t started yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardContent className="pt-6">
              <OnboardingProgressBar progress={checklist.progress} />
              {checklist.progress.complete && !access.isSelf && access.record.status === 'ONBOARDING' && (
                <p className="mt-3 text-small text-success">
                  All required items are done. HR can now move {name} to Active from their profile.
                </p>
              )}
              {checklist.progress.complete && access.isSelf && (
                <p className="mt-3 text-small text-success">You’re all set — HR will confirm your start.</p>
              )}
            </CardContent>
          </Card>
          <OnboardingChecklist
            internId={id}
            items={checklist.items}
            isSelf={access.isSelf}
            documentTypeLabels={DOCUMENT_TYPE_LABELS}
          />
        </div>
      )}
    </>
  )
}
