import 'server-only'
import type { AiContextKind } from '@/lib/ai/router'
import { config } from '@/lib/config'
import { authorizationService } from '../services/authorization.service'
import type { RequestContext } from '../context'
import { aiAuthorizationService } from './authorization'

/**
 * Suggested prompts, by page and by what the user may actually do. A prompt
 * here only saves typing: the answer still goes through tools and permissions.
 */

export const CONTEXT_PROMPTS: Partial<Record<AiContextKind, string[]>> = {
  TASK: [
    'Explain this task',
    'Break this task into subtasks',
    'Suggest a plan for this task',
    'What could block this task?',
    'Draft a submission message',
    'Summarize the feedback on this task',
  ],
  PROJECT: [
    'Summarize this project',
    'Summarize recent activity',
    'Which tasks are blocked?',
    'Prepare a status update',
    'Draft a meeting agenda',
    'Summarize the milestones',
  ],
  LEARNING: [
    'Explain this lesson',
    'Give me an example',
    'Quiz me on this lesson',
    'Summarize this lesson',
    'Create revision notes',
    'Explain this concept simply',
  ],
  PERFORMANCE: [
    'Summarize the evidence for this review',
    'Suggest development questions',
    'Draft review comments',
    'Summarize the feedback and check-ins',
  ],
  ONBOARDING: ['What should I do next?', 'Which items are overdue?', 'Summarize onboarding progress'],
  DOCUMENT: ['Summarize this document', 'What are the key points?', 'What does this mean for interns?'],
}

export function suggestedPrompts(ctx: RequestContext): string[] {
  const can = (key: Parameters<typeof authorizationService.can>[1]) => authorizationService.can(ctx, key)
  const persona = aiAuthorizationService.persona(ctx)
  const prompts: string[] = []
  if (persona === 'INTERN') {
    prompts.push('What should I focus on today?', 'Explain my pending tasks', 'Help me plan today’s work', 'What learning should I complete?', 'Summarize my recent feedback')
  } else {
    if (can('task.read')) prompts.push('What should I focus on today?')
    if (can('intern.read')) prompts.push('Summarize my team’s work')
    if (can('task.review')) prompts.push('Summarize pending reviews')
  }
  if (can('hr_dashboard.read')) prompts.push('Summarize onboarding progress', 'Which documents need attention?', 'Show pending HR requests')
  if (can('knowledge.read')) prompts.push('Where is the leave policy?')
  if (can('task.read') && persona === 'INTERN') prompts.push('Summarize my week')
  return [...new Set(prompts)].slice(0, 6)
}

/** Whether AI features should be offered at all (the server still re-checks on every request). */
export function aiOffered(ctx: RequestContext) {
  return config.ai.configured && authorizationService.can(ctx, 'ai.use')
}
