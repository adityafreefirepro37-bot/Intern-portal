/**
 * Notification categories: the unit people choose delivery for (in the app,
 * by email). Every notification type belongs to exactly one category.
 */
export const NOTIFICATION_CATEGORIES = [
  'tasks',
  'projects',
  'meetings',
  'messages',
  'hr',
  'onboarding',
  'announcements',
  'learning',
  'performance',
] as const
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]

export const NOTIFICATION_CATEGORY_INFO: Record<NotificationCategory, { label: string; description: string }> = {
  tasks: { label: 'Tasks', description: 'Assignments, mentions, reviews, due and overdue reminders.' },
  projects: { label: 'Projects', description: 'Added to a project, milestones and status changes.' },
  meetings: { label: 'Meetings', description: 'Invitations, changes, cancellations and replies.' },
  messages: { label: 'Messages', description: 'Direct messages, @mentions and being added to a channel.' },
  hr: { label: 'Leave, attendance & documents', description: 'Requests, decisions, document reviews and HR requests.' },
  onboarding: { label: 'Onboarding', description: 'Onboarding items assigned to you and overdue items.' },
  announcements: { label: 'Announcements', description: 'Announcements published to you.' },
  learning: { label: 'Learning', description: 'Courses and paths assigned, deadlines, quizzes and assignments.' },
  performance: { label: 'Performance', description: 'Goals, check-ins, feedback and reviews.' },
}

/** Defaults when a person hasn't chosen: everything in the app; email only for meetings. */
export const DEFAULT_PREFERENCE: Record<NotificationCategory, { inApp: boolean; email: boolean }> = {
  tasks: { inApp: true, email: false },
  projects: { inApp: true, email: false },
  meetings: { inApp: true, email: true },
  messages: { inApp: true, email: false },
  hr: { inApp: true, email: false },
  onboarding: { inApp: true, email: false },
  announcements: { inApp: true, email: false },
  learning: { inApp: true, email: false },
  performance: { inApp: true, email: false },
}

const PREFIXES: [string, NotificationCategory][] = [
  ['TASK_', 'tasks'],
  ['PROJECT_', 'projects'],
  ['MEETING_', 'meetings'],
  ['MESSAGE_', 'messages'],
  ['CHANNEL_', 'messages'],
  ['DIRECT_MESSAGE', 'messages'],
  ['LEAVE_', 'hr'],
  ['ATTENDANCE_', 'hr'],
  ['DOCUMENT_', 'hr'],
  ['HR_REQUEST_', 'hr'],
  ['ONBOARDING_', 'onboarding'],
  ['ANNOUNCEMENT_', 'announcements'],
  ['COURSE_', 'learning'],
  ['LEARNING_', 'learning'],
  ['QUIZ_', 'learning'],
  ['ASSIGNMENT_', 'learning'],
]

/** Category of a notification type; anything not listed (reviews, goals, feedback, check-ins…) is performance. */
export function categoryOf(type: string): NotificationCategory {
  for (const [prefix, category] of PREFIXES) if (type.startsWith(prefix)) return category
  return 'performance'
}
