'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { requireApiContext } from '../context'
import { aiActionService, type ActionProposal } from '../ai/actions.service'
import { aiConversationService } from '../ai/conversation.service'
import { knowledgeService, type KnowledgeFile } from '../ai/knowledge.service'
import { aiSettingsService } from '../ai/settings.service'
import { formError, formFields, safeValues, type FormState } from './form-state'

/**
 * AYAVA AI and knowledge-base actions. The browser sends ids and values only;
 * ownership, permissions and validation are enforced by the services.
 */

async function run<T = undefined>(
  formData: FormData,
  operation: (fields: Record<string, string>) => Promise<{ message: string; data?: T }>,
  paths: string[] = ['/ai'],
): Promise<FormState<T>> {
  const fields = formFields(formData)
  try {
    const { message, data } = await operation(fields)
    for (const path of paths) revalidatePath(path)
    return { status: 'success', message, data }
  } catch (error) {
    return formError(error, safeValues(fields))
  }
}

async function fileFrom(formData: FormData): Promise<KnowledgeFile | undefined> {
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return undefined
  return { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }
}

// ── Conversations ───────────────────────────────────────────────────────────

export async function renameConversationAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ conversationId, title }) => {
    await aiConversationService.rename(await requireApiContext(), conversationId ?? '', title ?? '')
    return { message: 'Conversation renamed.' }
  })
}

export async function archiveConversationAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ conversationId, archived }) => {
    const archive = archived === 'true'
    await aiConversationService.setArchived(await requireApiContext(), conversationId ?? '', archive)
    return { message: archive ? 'Conversation archived.' : 'Conversation restored.' }
  })
}

export async function deleteConversationAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ conversationId }) => {
    await aiConversationService.remove(await requireApiContext(), conversationId ?? '')
    return { message: 'Conversation deleted.' }
  })
}

export async function messageFeedbackAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ messageId, rating, reason }) => {
    await aiConversationService.feedback(await requireApiContext(), { messageId, rating, ...(reason ? { reason } : {}) })
    return { message: 'Thanks for the feedback.' }
  })
}

// ── Action proposals ────────────────────────────────────────────────────────

export async function confirmAiActionAction(
  _previous: FormState<ActionProposal>,
  formData: FormData,
): Promise<FormState<ActionProposal>> {
  return run<ActionProposal>(formData, async ({ actionId, ...edits }) => {
    const proposal = await aiActionService.confirm(await requireApiContext(), actionId ?? '', edits)
    return { message: proposal.status === 'EXECUTED' ? (proposal.result?.message ?? 'Done.') : (proposal.error ?? 'The action could not be completed.'), data: proposal }
  })
}

export async function cancelAiActionAction(
  _previous: FormState<ActionProposal>,
  formData: FormData,
): Promise<FormState<ActionProposal>> {
  return run<ActionProposal>(formData, async ({ actionId }) => {
    const proposal = await aiActionService.cancel(await requireApiContext(), actionId ?? '')
    return { message: 'Cancelled. Nothing was changed.', data: proposal }
  })
}

// ── AI settings ─────────────────────────────────────────────────────────────

export async function saveAiSettingsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(
    formData,
    async (fields) => {
      await aiSettingsService.save(await requireApiContext(), fields)
      return { message: 'AI settings saved.' }
    },
    ['/ai', '/ai/settings'],
  )
}

// ── Knowledge base ──────────────────────────────────────────────────────────

const KNOWLEDGE_PATHS = ['/knowledge']

export async function createKnowledgeDocumentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const file = await fileFrom(formData)
  return run(
    formData,
    async (fields) => {
      const ctx = await requireApiContext()
      const { id } = await knowledgeService.create(ctx, fields, file)
      // Extraction and embedding can take a while: finish after responding (the list shows progress).
      after(() => knowledgeService.process(ctx, id))
      return { message: 'Document added. Processing has started.' }
    },
    KNOWLEDGE_PATHS,
  )
}

export async function addKnowledgeVersionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const file = await fileFrom(formData)
  return run(
    formData,
    async ({ documentId, ...fields }) => {
      const ctx = await requireApiContext()
      const { id, version } = await knowledgeService.addVersion(ctx, documentId ?? '', fields, file)
      after(() => knowledgeService.process(ctx, id))
      return { message: `Version ${version} added. It becomes current once processed.` }
    },
    KNOWLEDGE_PATHS,
  )
}

export async function updateKnowledgeDocumentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(
    formData,
    async ({ documentId, ...fields }) => {
      await knowledgeService.updateMetadata(await requireApiContext(), documentId ?? '', fields)
      return { message: 'Document updated.' }
    },
    KNOWLEDGE_PATHS,
  )
}

export async function reprocessKnowledgeDocumentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(
    formData,
    async ({ documentId }) => {
      const ctx = await requireApiContext()
      const document = await knowledgeService.managed(ctx, documentId ?? '')
      after(() => knowledgeService.reprocess(ctx, document.id))
      return { message: 'Reprocessing started.' }
    },
    KNOWLEDGE_PATHS,
  )
}

export async function setKnowledgeArchivedAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(
    formData,
    async ({ documentId, archived }) => {
      const archive = archived === 'true'
      await knowledgeService.setArchived(await requireApiContext(), documentId ?? '', archive)
      return { message: archive ? 'Document archived.' : 'Document restored.' }
    },
    KNOWLEDGE_PATHS,
  )
}

export async function deleteKnowledgeDocumentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(
    formData,
    async ({ documentId }) => {
      await knowledgeService.remove(await requireApiContext(), documentId ?? '')
      return { message: 'Document deleted.' }
    },
    KNOWLEDGE_PATHS,
  )
}
