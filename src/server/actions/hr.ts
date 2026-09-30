'use server'

import { revalidatePath } from 'next/cache'
import { getRequestMeta } from '@/lib/http/request-meta'
import { formatDuration } from '@/lib/hr/time'
import { requireApiContext } from '../context'
import { announcementService } from '../services/announcement.service'
import { attendanceService } from '../services/attendance.service'
import { documentService } from '../services/document.service'
import { holidayService } from '../services/holiday.service'
import { hrRequestService } from '../services/hr-request.service'
import { internHrService } from '../services/intern-hr.service'
import { leaveService } from '../services/leave.service'
import { offboardingService } from '../services/offboarding.service'
import { hrSettingsService } from '../services/settings.service'
import { formError, formFields, safeValues, type FormState } from './form-state'

/**
 * HR operations: attendance, leave, documents, HR requests, announcements,
 * holidays, settings and offboarding. The browser sends ids and values only;
 * every rule (scope, self-approval, overlaps, balances) is enforced by the services.
 */

type Upload = { name: string; type: string; bytes: Uint8Array }

async function filesFrom(formData: FormData, key: string): Promise<Upload[]> {
  const files = formData.getAll(key).filter((value): value is File => value instanceof File && value.size > 0)
  return Promise.all(
    files.map(async (file) => ({ name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })),
  )
}

function refreshHr() {
  revalidatePath('/hr', 'layout')
  revalidatePath('/attendance')
  revalidatePath('/leave')
  revalidatePath('/documents')
  revalidatePath('/requests', 'layout')
  revalidatePath('/announcements')
  revalidatePath('/interns', 'layout')
  revalidatePath('/')
}

async function run<T = undefined>(
  formData: FormData,
  operation: (fields: Record<string, string>) => Promise<{ message: string; data?: T }>,
): Promise<FormState<T>> {
  const fields = formFields(formData)
  try {
    const { message, data } = await operation(fields)
    refreshHr()
    return { status: 'success', message, data }
  } catch (error) {
    return formError(error, safeValues(fields))
  }
}

// ── Attendance ──────────────────────────────────────────────────────────────

export async function checkInAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async () => {
    const ctx = await requireApiContext()
    const { late, lateMinutes } = await attendanceService.checkIn(ctx, await getRequestMeta())
    return { message: late ? `Checked in — ${formatDuration(lateMinutes)} late.` : 'Checked in. Have a good day!' }
  })
}

export async function checkOutAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async () => {
    const ctx = await requireApiContext()
    const { totalMinutes } = await attendanceService.checkOut(ctx, await getRequestMeta())
    return { message: `Checked out. You worked ${formatDuration(totalMinutes)} today.` }
  })
}

export async function startBreakAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async () => {
    await attendanceService.startBreak(await requireApiContext())
    return { message: 'Break started.' }
  })
}

export async function endBreakAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async () => {
    await attendanceService.endBreak(await requireApiContext())
    return { message: 'Welcome back — break ended.' }
  })
}

export async function requestCorrectionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await attendanceService.requestCorrection(await requireApiContext(), fields)
    return { message: 'Correction requested. You’ll be notified when it’s reviewed.' }
  })
}

export async function cancelCorrectionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ correctionId }) => {
    await attendanceService.cancelCorrection(await requireApiContext(), correctionId ?? '')
    return { message: 'Correction withdrawn.' }
  })
}

export async function reviewCorrectionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await attendanceService.reviewCorrection(await requireApiContext(), fields)
    return { message: fields.decision === 'APPROVED' ? 'Correction approved and applied.' : 'Correction rejected.' }
  })
}

export async function updateAttendanceAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await attendanceService.hrUpdate(await requireApiContext(), fields)
    return { message: 'Attendance updated.' }
  })
}

// ── Leave ───────────────────────────────────────────────────────────────────

export async function requestLeaveAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const [attachment] = await filesFrom(formData, 'attachment')
  return run(formData, async (fields) => {
    const { status, days } = await leaveService.request(await requireApiContext(), fields, attachment)
    return {
      message:
        status === 'APPROVED'
          ? `Leave recorded (${days} working day${days === 1 ? '' : 's'}).`
          : `Leave requested for ${days} working day${days === 1 ? '' : 's'}.`,
    }
  })
}

export async function cancelLeaveAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ leaveId }) => {
    await leaveService.cancel(await requireApiContext(), leaveId ?? '')
    return { message: 'Leave cancelled.' }
  })
}

export async function reviewLeaveAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await leaveService.review(await requireApiContext(), fields)
    return { message: fields.decision === 'APPROVED' ? 'Leave approved.' : 'Leave rejected.' }
  })
}

export async function setLeaveBalanceAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await leaveService.setBalance(await requireApiContext(), fields)
    return { message: 'Balance updated.' }
  })
}

export async function saveLeaveTypeAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await leaveService.saveType(await requireApiContext(), fields)
    return { message: 'Leave type saved.' }
  })
}

// ── Documents, holidays, settings ───────────────────────────────────────────

export async function reviewDocumentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await documentService.review(await requireApiContext(), fields)
    const messages: Record<string, string> = {
      START_REVIEW: 'Marked as under review.',
      VERIFY: 'Document verified.',
      REJECT: 'Document rejected.',
      REQUEST_REPLACEMENT: 'Replacement requested.',
    }
    return { message: messages[fields.decision ?? ''] ?? 'Saved.' }
  })
}

export async function saveDocumentTypeAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await documentService.saveType(await requireApiContext(), fields)
    return { message: 'Document type saved.' }
  })
}

export async function saveHolidayAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await holidayService.save(await requireApiContext(), fields)
    return { message: 'Holiday saved.' }
  })
}

export async function deleteHolidayAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ holidayId }) => {
    await holidayService.remove(await requireApiContext(), holidayId ?? '')
    return { message: 'Holiday removed.' }
  })
}

export async function saveHrSettingsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const workingDays = formData.getAll('workingDays').map(String).join(',')
  return run(formData, async (fields) => {
    const input = fields.section === 'attendance' ? { ...fields, workingDays } : fields
    await hrSettingsService.update(await requireApiContext(), input)
    return { message: 'Settings saved.' }
  })
}

// ── HR requests ─────────────────────────────────────────────────────────────

export async function createHrRequestAction(
  _previous: FormState<{ id: string }>,
  formData: FormData,
): Promise<FormState<{ id: string }>> {
  const files = await filesFrom(formData, 'files')
  return run(formData, async (fields) => {
    const request = await hrRequestService.create(await requireApiContext(), fields, files)
    return { message: 'Request sent to HR.', data: { id: request.id } }
  })
}

export async function commentHrRequestAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const files = await filesFrom(formData, 'files')
  return run(formData, async (fields) => {
    await hrRequestService.comment(await requireApiContext(), fields, files)
    return { message: 'Reply sent.' }
  })
}

export async function transitionHrRequestAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await hrRequestService.transition(await requireApiContext(), fields)
    return { message: fields.to === 'CANCELLED' ? 'Request cancelled.' : 'Request updated.' }
  })
}

export async function assignHrRequestAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await hrRequestService.assign(await requireApiContext(), fields)
    return { message: 'Assignee updated.' }
  })
}

// ── Announcements ───────────────────────────────────────────────────────────

export async function saveAnnouncementAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const audienceIds = formData.getAll('audienceIds').map(String).filter(Boolean).join(',')
  return run(formData, async (fields) => {
    const { status } = await announcementService.save(await requireApiContext(), { ...fields, audienceIds })
    return {
      message:
        status === 'PUBLISHED'
          ? 'Announcement published.'
          : status === 'SCHEDULED'
            ? 'Announcement scheduled.'
            : 'Draft saved.',
    }
  })
}

export async function announcementStatusAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await announcementService.setStatus(await requireApiContext(), fields)
    return { message: fields.action === 'ARCHIVE' ? 'Announcement archived.' : 'Announcement updated.' }
  })
}

// ── Intern HR record & offboarding ──────────────────────────────────────────

export async function savePersonalInfoAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await internHrService.updatePersonal(await requireApiContext(), fields)
    return { message: 'Personal information saved.' }
  })
}

export async function saveEmergencyContactAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await internHrService.saveContact(await requireApiContext(), fields)
    return { message: 'Emergency contact saved.' }
  })
}

export async function removeEmergencyContactAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await internHrService.removeContact(await requireApiContext(), fields)
    return { message: 'Emergency contact removed.' }
  })
}

export async function saveCompensationAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await internHrService.updateCompensation(await requireApiContext(), fields)
    return { message: 'Stipend details saved.' }
  })
}

export async function startOffboardingAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ internId }) => {
    await offboardingService.start(await requireApiContext(), internId ?? '')
    return { message: 'Offboarding checklist created.' }
  })
}

export async function setOffboardingItemAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await offboardingService.setItem(await requireApiContext(), fields)
    return { message: 'Checklist updated.' }
  })
}
