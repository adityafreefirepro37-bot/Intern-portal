import { prisma } from '@/lib/db/client'
import { CERTIFICATE_TYPE_LABELS, type CertificateTypeValue } from '@/lib/certificates/content'
import { certificateJobs } from '../services/certificate.service'
import { NOTIFICATION_TYPES, notificationService } from '../services/notification.service'
import { domainEvents } from './domain-events'

/** Certificates: tell the recipient, and issue course certificates on course completion. */
export function registerCertificateSubscribers() {
  domainEvents.on('certificate.issued', async ({ organizationId, actorUserId, payload }) => {
    const certificate = await prisma.certificate.findUnique({
      where: { id: payload.certificateId },
      select: { certificate_type: true, course: { select: { title: true } } },
    })
    if (!certificate) return
    const what = certificate.course
      ? `course certificate for “${certificate.course.title}”`
      : `${CERTIFICATE_TYPE_LABELS[certificate.certificate_type as CertificateTypeValue].toLowerCase()} certificate`
    await notificationService.notify(
      organizationId,
      [payload.recipientUserId],
      {
        type: NOTIFICATION_TYPES.CERTIFICATE_ISSUED,
        title: `Your ${what} is ready`,
        body: `No. ${payload.number} — download it and share the verification link.`,
        entityType: 'certificate',
        entityId: payload.certificateId,
      },
      actorUserId,
    )
  })

  domainEvents.on('certificate.revoked', async ({ organizationId, actorUserId, payload }) => {
    await notificationService.notify(
      organizationId,
      [payload.recipientUserId],
      {
        type: NOTIFICATION_TYPES.CERTIFICATE_REVOKED,
        title: `Certificate ${payload.number} was revoked`,
        body: 'Contact HR if you have questions.',
        entityType: 'certificate',
        entityId: null,
      },
      actorUserId,
    )
  })

  domainEvents.on('learning.course_completed', async ({ organizationId, payload }) => {
    await certificateJobs.issueCourseCertificate(organizationId, { userId: payload.userId, courseId: payload.courseId })
  })
}
