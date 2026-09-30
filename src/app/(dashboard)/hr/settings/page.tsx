import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { HrNav } from '@/features/hr/components/hr-nav'
import {
  AttendanceRulesForm,
  DocumentTypesEditor,
  GeneralSettingsForm,
  HolidaysEditor,
  LeavePolicyForm,
  LeaveTypesEditor,
  OffboardingDefaultsForm,
} from '@/features/hr/components/hr-settings'
import { hrNavItems } from '@/features/hr/nav'
import { firstParam } from '@/lib/validation/list-params'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { DOCUMENT_TYPE_LABELS, documentService, VISIBILITY_LABELS } from '@/server/services/document.service'
import { holidayService } from '@/server/services/holiday.service'
import { leaveService } from '@/server/services/leave.service'
import { hrSettingsService } from '@/server/services/settings.service'

export const metadata: Metadata = { title: 'HR settings' }

/** Organization-scoped HR configuration. Every change is audited with before/after values. */
export default async function HrSettingsPage({ searchParams }: PageProps<'/hr/settings'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'hr_settings.update')) return <AccessDenied what="HR settings" />
  const requestedYear = Number(firstParam(await searchParams, 'year'))
  const year = Number.isInteger(requestedYear) && requestedYear > 2000 ? requestedYear : new Date().getUTCFullYear()
  const canLeaveTypes = authorizationService.can(ctx, 'leave_type.manage')
  const canDocTypes = authorizationService.can(ctx, 'document.manage')
  const canHolidays = authorizationService.can(ctx, 'holiday.manage')
  const [settings, leaveTypes, docTypes, holidays] = await Promise.all([
    hrSettingsService.get(ctx),
    canLeaveTypes ? leaveService.allTypes(ctx) : Promise.resolve(null),
    canDocTypes ? documentService.allTypes(ctx) : Promise.resolve(null),
    holidayService.list(ctx, year),
  ])

  const section = (id: string, title: string, description: string, body: React.ReactNode) => (
    <Card id={id}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  )

  return (
    <>
      <PageHeader
        title="HR settings"
        description="Rules and lists that shape attendance, leave, documents and offboarding."
      />
      <HrNav items={hrNavItems(ctx)} active="/hr/settings" />
      <div className="space-y-6">
        {section(
          'general',
          'General',
          'Thresholds used across HR views.',
          <GeneralSettingsForm
            endingSoonDays={settings.endingSoonDays}
            defaultWorkMode={settings.defaultWorkMode}
            expiryWarningDays={settings.expiryWarningDays}
          />,
        )}
        {section(
          'attendance',
          'Attendance rules',
          'Evaluated in the organization timezone. Changing rules affects new check-ins; past records keep their status.',
          <AttendanceRulesForm rules={settings.attendance} />,
        )}
        {section(
          'leave',
          'Leave policy',
          'Limits applied when interns request leave.',
          <LeavePolicyForm policy={settings.leave} />,
        )}
        {leaveTypes &&
          section(
            'leave-types',
            'Leave types',
            'Allowances per internship; empty allowance means unlimited.',
            <LeaveTypesEditor types={leaveTypes} />,
          )}
        {docTypes &&
          section(
            'document-types',
            'Document types',
            'Required types drive document completion; sensitive types are hidden from people without sensitive-document access.',
            <DocumentTypesEditor
              types={docTypes}
              legacyLabels={DOCUMENT_TYPE_LABELS}
              visibilityLabels={VISIBILITY_LABELS}
            />,
          )}
        {canHolidays &&
          section(
            'holidays',
            `Holidays ${year}`,
            'Holidays are excluded from leave and never count as absences. One holiday per date.',
            <div className="space-y-3">
              <p className="flex gap-3 text-small">
                <Link href={`/hr/settings?year=${year - 1}#holidays`} className="text-primary hover:underline">
                  ← {year - 1}
                </Link>
                <Link href={`/hr/settings?year=${year + 1}#holidays`} className="text-primary hover:underline">
                  {year + 1} →
                </Link>
              </p>
              <HolidaysEditor holidays={holidays} year={year} />
            </div>,
          )}
        {section(
          'offboarding',
          'Offboarding checklist',
          'Default items copied into each intern’s offboarding checklist.',
          <OffboardingDefaultsForm items={settings.offboardingItems} />,
        )}
      </div>
    </>
  )
}
