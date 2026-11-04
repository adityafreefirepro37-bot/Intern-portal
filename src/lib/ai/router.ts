/**
 * Deterministic intent routing for AYAVA AI (pure — unit tested).
 *
 * Decides which *kinds* of data a question needs; it never grants access. The
 * server filters the chosen tools by the user's permissions, and each tool
 * calls the same authorized service the UI uses.
 *
 * Structured data → database tools · company knowledge → knowledge retrieval ·
 * general questions → the model alone.
 */

export const AI_CONTEXT_TYPES = ['GLOBAL', 'TASK', 'PROJECT', 'LEARNING', 'HR', 'PERFORMANCE', 'ONBOARDING', 'DOCUMENT'] as const
export type AiContextKind = (typeof AI_CONTEXT_TYPES)[number]

export type Intent =
  | 'RESTRICTED_ACTION'
  | 'ACTION_REQUEST'
  | 'TASK_BREAKDOWN'
  | 'DAILY_BRIEF'
  | 'WEEKLY_SUMMARY'
  | 'TEAM_QUERY'
  | 'KNOWLEDGE_QUERY'
  | 'TASK_QUERY'
  | 'PROJECT_QUERY'
  | 'LEARNING_QUERY'
  | 'PERFORMANCE_QUERY'
  | 'HR_QUERY'
  | 'DOCUMENT_QUERY'
  | 'GENERAL_QUERY'

/** Data sources a route may use; the tool registry maps each to concrete, permission-checked tools. */
export type ToolName =
  | 'getContext'
  | 'getMyWork'
  | 'getPendingReviews'
  | 'getMyProjects'
  | 'getMyLearning'
  | 'getMyGoals'
  | 'getMyFeedback'
  | 'getMyCheckins'
  | 'getMyLeave'
  | 'getMyAttendance'
  | 'getOnboardingStatus'
  | 'getAnnouncements'
  | 'getTeamOverview'
  | 'findPeopleWork'
  | 'getHrOverview'
  | 'searchKnowledge'

export interface Route {
  intent: Intent
  tools: ToolName[]
  /** Set for high-risk requests the AI must not perform (an authorized person decides in the app). */
  restricted?: { reason: string; href: string; label: string }
  /** A write the AI may *propose* (never execute) after confirmation. */
  action?: 'create_task' | 'create_subtasks'
}

const has = (text: string, pattern: RegExp) => pattern.test(text)

/** High-risk decisions: HR approvals, ratings, roles/permissions, employment and pay. */
const RESTRICTED: { pattern: RegExp; reason: string; href: string; label: string }[] = [
  {
    pattern: /\b(approve|reject|deny|decline|sanction)\b[^.?!]*\b(leave|leaves|time off|vacation)\b/,
    reason: 'Leave requests are approved or rejected by an authorized person in the Leave section.',
    href: '/hr/leave',
    label: 'Leave',
  },
  {
    pattern: /\b(approve|reject|deny)\b[^.?!]*\b(attendance|correction|corrections|timesheet)\b/,
    reason: 'Attendance corrections are reviewed by an authorized person in Attendance.',
    href: '/hr/attendance',
    label: 'Attendance',
  },
  {
    pattern:
      /\b(set|change|give|assign|update|lower|raise|decide|pick|choose)\b[^.?!]*\b(rating|ratings|score|scores|grade)\b|\b(rate|rank|score)\b\s+(the\s+|my\s+|this\s+|these\s+|all\s+)?(intern|interns|mentee|mentees)\b/,
    reason: 'Performance ratings are decided by the reviewing manager or HR, never by the AI.',
    href: '/performance/reviews',
    label: 'Reviews',
  },
  {
    pattern: /\b(complete|submit|finali[sz]e|sign off)\b[^.?!]*\b(performance review|review cycle|their review|the review)\b/,
    reason: 'Completing a performance review is a decision for the responsible manager or HR.',
    href: '/performance/reviews',
    label: 'Reviews',
  },
  {
    pattern: /\b(terminate|fire|dismiss|let go|end (his|her|their|the) internship|offboard)\b/,
    reason: 'Ending an internship is an HR decision made in the intern’s record, not by the AI.',
    href: '/hr/offboarding',
    label: 'Offboarding',
  },
  {
    pattern:
      /\b(grant|give|assign|change|remove|revoke|make)\b[^.?!]*\b(role|roles|permission|permissions|admin|super admin|access rights)\b/,
    reason: 'Roles and permissions are changed by an administrator in Users and Roles.',
    href: '/users',
    label: 'Users',
  },
  {
    pattern: /\b(salary|stipend|compensation|pay rise|raise (his|her|their|my) pay|bonus|promot(e|ion))\b[^.?!]*\b(set|change|increase|decrease|decide|approve)\b|\b(set|change|increase|decrease|decide|approve)\b[^.?!]*\b(salary|stipend|compensation|bonus|promotion)\b/,
    reason: 'Compensation and promotion decisions are made by authorized HR staff.',
    href: '/hr',
    label: 'HR',
  },
  {
    pattern: /\b(hire|reject (the )?candidate|select (the )?candidate|shortlist)\b/,
    reason: 'Hiring decisions are made by people, not by the AI.',
    href: '/interns',
    label: 'Interns',
  },
]

const P = {
  createTask: /\b(create|add|make|open|set up|log)\b\s+(me\s+)?(a\s+|an\s+|new\s+|the\s+)*(task|to-?do)\b/,
  breakdown: /\b(break|split|divide)\b[^.?!]*\b(sub-?tasks|steps|smaller (tasks|pieces|parts))\b|\bsub-?tasks\b[^.?!]*\b(for|of) (this|the) task\b/,
  brief: /\b(what should i (work on|focus on|do)|focus on today|my day\b|plan (my|today|the day)|today'?s (work|plan|priorities)|brief me|daily brief|start my day|priorit(y|ies|i[sz]e) (for )?today)\b/,
  week: /\b(summari[sz]e my week|my week\b|this week'?s (work|summary|progress)|weekly (summary|report|update)|what did i (do|achieve|complete) this week)\b/,
  team: /\b(my team|my interns|my mentees|team'?s (work|progress|status)|interns? (i|we) (manage|mentor)|who needs (help|attention)|which (of my )?interns)\b/,
  knowledge:
    /\b(polic(y|ies)|handbook|sop|guideline|guidelines|procedure|process for|dress code|code of conduct|working hours|office hours|benefit|benefits|brand guide|style guide|faq|according to|company rule|rules on|allowed to|am i allowed|reimburse|security policy|onboarding guide|where (is|can i find) the)\b/,
  task: /\b(task|tasks|deadline|deadlines|due|overdue|blocked|blocker|submission|submit|to-?do|assigned to me|my work|pending work)\b/,
  project: /\b(project|projects|milestone|milestones|sprint)\b/,
  learning: /\b(course|courses|lesson|lessons|learning|training|quiz|study|module|learning path|revision|explain this concept)\b/,
  performance: /\b(goal|goals|feedback|check-?in|check-?ins|performance|development plan|review cycle|my review|self review|evidence)\b/,
  hr: /\b(leave|leaves|time off|attendance|checked in|check in time|late|onboarding|hr request|announcement|announcements|holiday|holidays|documents? (pending|missing|to upload))\b/,
  hrOps: /\b(onboarding (progress|completion|status)|pending (documents|corrections|hr requests|leave)|attendance corrections|required documents|which documents|hr (overview|summary|dashboard)|who is on leave)\b/,
  reviews: /\b(pending reviews?|needs? my (review|attention)|to review|awaiting review|review queue)\b/,
  summarizeDoc: /\b(summari[sz]e|explain|tl;?dr|key points|what does)\b[^.?!]*\b(this|the) (document|doc|policy|file|page)\b/,
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

/**
 * Routes a question. `context` is the page the user asked from (verified by
 * the server before any of its data is used).
 */
export function routeQuestion(question: string, context: AiContextKind = 'GLOBAL'): Route {
  const text = question.toLowerCase().replace(/\s+/g, ' ').trim()

  for (const rule of RESTRICTED) {
    if (has(text, rule.pattern)) {
      return { intent: 'RESTRICTED_ACTION', tools: [], restricted: { reason: rule.reason, href: rule.href, label: rule.label } }
    }
  }

  const contextTool: ToolName[] = context === 'GLOBAL' ? [] : ['getContext']

  if (context === 'TASK' && has(text, P.breakdown)) {
    return { intent: 'TASK_BREAKDOWN', tools: ['getContext'], action: 'create_subtasks' }
  }
  if (has(text, P.createTask)) return { intent: 'ACTION_REQUEST', tools: contextTool, action: 'create_task' }
  if (context === 'DOCUMENT' && (has(text, P.summarizeDoc) || !has(text, P.knowledge))) {
    return { intent: 'DOCUMENT_QUERY', tools: ['getContext'] }
  }
  if (has(text, P.brief)) {
    return {
      intent: 'DAILY_BRIEF',
      tools: unique([...contextTool, 'getMyWork', 'getPendingReviews', 'getMyLearning', 'getOnboardingStatus', 'getAnnouncements']),
    }
  }
  if (has(text, P.week)) {
    return { intent: 'WEEKLY_SUMMARY', tools: ['getMyWork', 'getMyLearning', 'getMyFeedback', 'getMyGoals'] }
  }

  const tools: ToolName[] = [...contextTool]
  let intent: Intent | null = null
  const add = (match: boolean, next: Intent, names: ToolName[]) => {
    if (!match) return
    intent ??= next
    tools.push(...names)
  }
  add(has(text, P.team), 'TEAM_QUERY', ['getTeamOverview', 'findPeopleWork', 'getPendingReviews'])
  add(has(text, P.hrOps), 'HR_QUERY', ['getHrOverview'])
  add(has(text, P.knowledge), 'KNOWLEDGE_QUERY', ['searchKnowledge'])
  add(has(text, P.reviews), 'TASK_QUERY', ['getPendingReviews'])
  add(has(text, P.task), 'TASK_QUERY', ['getMyWork'])
  add(has(text, P.project), 'PROJECT_QUERY', ['getMyProjects'])
  add(has(text, P.learning), 'LEARNING_QUERY', ['getMyLearning'])
  add(has(text, P.performance), 'PERFORMANCE_QUERY', ['getMyGoals', 'getMyFeedback', 'getMyCheckins'])
  add(has(text, P.hr) && !has(text, P.knowledge), 'HR_QUERY', ['getMyLeave', 'getMyAttendance', 'getOnboardingStatus', 'getAnnouncements'])

  if (!intent) {
    const byContext: Partial<Record<AiContextKind, Intent>> = {
      TASK: 'TASK_QUERY',
      PROJECT: 'PROJECT_QUERY',
      LEARNING: 'LEARNING_QUERY',
      PERFORMANCE: 'PERFORMANCE_QUERY',
      ONBOARDING: 'HR_QUERY',
      HR: 'HR_QUERY',
    }
    intent = byContext[context] ?? 'GENERAL_QUERY'
    if (context === 'HR') tools.push('getHrOverview')
    // A company-flavoured question without a clear data source still checks the knowledge base.
    if (intent === 'GENERAL_QUERY' && /\b(ayava|our company|the company|we|our team|intern(ship)? programme|internship)\b/.test(text)) {
      intent = 'KNOWLEDGE_QUERY'
      tools.push('searchKnowledge')
    }
  }
  // Keep requests small: at most six data sources per question.
  return { intent, tools: unique(tools).slice(0, 6) }
}

/** Capitalized words that look like a person's name ("Summarize Rahul's work" → ["Rahul"]). */
export function personNames(question: string): string[] {
  const NOT_NAMES = new Set([
    'I', 'AYAVA', 'AI', 'HR', 'SOP', 'FAQ', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
    'Summarize', 'Summarise', 'Show', 'What', 'Which', 'Who', 'How', 'Help', 'Prepare', 'Give', 'Tell', 'List', 'Find',
    'Please', 'Can', 'Could', 'Is', 'Are', 'Does', 'Do', 'The', 'My', 'Our', 'This', 'Explain', 'Draft', 'Create',
  ])
  const words = question.match(/\b[A-Z][a-z]{1,30}(?:'s)?\b/g) ?? []
  return unique(words.map((w) => w.replace(/'s$/, '')).filter((w) => !NOT_NAMES.has(w))).slice(0, 3)
}
