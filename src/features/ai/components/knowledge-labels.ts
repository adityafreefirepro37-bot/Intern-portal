/** Labels shared by the knowledge pages (client-safe: no server imports). */

export const KNOWLEDGE_CATEGORIES = [
  'HR', 'ONBOARDING', 'POLICIES', 'SOP', 'SECURITY', 'BRAND', 'MARKETING', 'ENGINEERING', 'DESIGN', 'LEARNING', 'PROJECT', 'GENERAL',
] as const

export const KNOWLEDGE_VISIBILITIES = ['ORGANIZATION', 'DEPARTMENT', 'TEAM', 'ROLE', 'PROJECT', 'PRIVATE'] as const

export const VISIBILITY_LABELS: Record<string, string> = {
  ORGANIZATION: 'Everyone in the organization',
  DEPARTMENT: 'One department',
  TEAM: 'One team',
  ROLE: 'One role',
  PROJECT: 'One project',
  PRIVATE: 'Only me (and knowledge managers)',
}

export const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Uploaded',
  PROCESSING: 'Processing',
  READY: 'Ready',
  FAILED: 'Failed',
  ARCHIVED: 'Archived',
}

export const FILE_TYPE_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'text/plain': 'Text',
  'text/markdown': 'Markdown',
  'text/html': 'HTML',
}
