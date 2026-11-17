import { assessmentJobs } from '../services/assessment.service'
import { domainEvents } from './domain-events'

/** Every task version an intern submits gets a proctored assessment. */
export function registerAssessmentSubscribers() {
  domainEvents.on('task.submitted', async ({ organizationId, payload }) => {
    await assessmentJobs.onSubmitted(organizationId, {
      taskId: payload.taskId,
      submissionId: payload.submissionId,
      version: payload.version,
    })
  })
}
