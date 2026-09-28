/**
 * Audit action vocabulary. Names follow `resource.event`; security events
 * required by the specification map as documented (LOGIN_SUCCESS →
 * `auth.login_success`, …). Keep this list in sync with the audit log filter.
 */
export const AUDIT_ACTIONS = {
  LOGIN_SUCCESS: 'auth.login_success',
  LOGIN_FAILURE: 'auth.login_failure',
  LOGOUT: 'auth.logout',
  PASSWORD_RESET_REQUESTED: 'auth.password_reset_requested',
  PASSWORD_RESET_COMPLETED: 'auth.password_reset_completed',
  PASSWORD_CHANGED: 'auth.password_changed',
  EMAIL_VERIFIED: 'auth.email_verified',
  VERIFICATION_RESENT: 'auth.verification_resent',
  INVITATION_CREATED: 'invitation.created',
  INVITATION_ACCEPTED: 'invitation.accepted',
  INVITATION_REVOKED: 'invitation.revoked',
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_SUSPENDED: 'user.suspended',
  USER_REACTIVATED: 'user.reactivated',
  USER_DEACTIVATED: 'user.deactivated',
  ROLE_CHANGED: 'user.role_changed',
  PERMISSION_CHANGED: 'role.permission_changed',
  SESSION_REVOKED: 'session.revoked',
  ACCESS_DENIED: 'access.denied',
  INTERN_CREATED: 'intern.created',
  INTERN_UPDATED: 'intern.updated',
  MANAGER_ASSIGNED: 'intern.manager_assigned',
  MENTOR_ASSIGNED: 'intern.mentor_assigned',
  STATUS_CHANGED: 'intern.status_changed',
  INTERNSHIP_CREATED: 'internship.created',
  INTERNSHIP_UPDATED: 'internship.updated',
  ONBOARDING_CREATED: 'onboarding.created',
  ONBOARDING_COMPLETED: 'onboarding.completed',
  ONBOARDING_ITEM_COMPLETED: 'onboarding.item_completed',
  ONBOARDING_ITEM_UPDATED: 'onboarding.item_updated',
  POLICY_ACKNOWLEDGED: 'policy.acknowledged',
  TEMPLATE_CREATED: 'onboarding_template.created',
  TEMPLATE_UPDATED: 'onboarding_template.updated',
  DOCUMENT_UPLOADED: 'document.uploaded',
  DOCUMENT_DELETED: 'document.deleted',
} as const

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS]

export const SECURITY_ACTIONS: readonly string[] = Object.values(AUDIT_ACTIONS)
