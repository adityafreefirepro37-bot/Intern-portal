'use client'

import { Check } from '@/components/forms/editor-dialog'
import { Input } from '@/components/ui/input'
import { Field, FormMessage, SubmitButton } from '@/features/auth/components/form-bits'
import { useFormAction } from '@/features/interns/components/use-form-action'
import { saveAiSettingsAction } from '@/server/actions/ai'
import type { AiSettings } from '@/server/ai/settings.service'

export function AiSettingsForm({ settings }: { settings: AiSettings }) {
  const [state, action] = useFormAction(saveAiSettingsAction)
  return (
    <form action={action} className="grid gap-5">
      <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
      <fieldset className="grid gap-3">
        <legend className="mb-1 text-small font-medium">Features</legend>
        <Check name="enabled" label="AYAVA AI is on" defaultChecked={settings.enabled} hint="Off hides answers for everyone. The knowledge library stays available." />
        <Check name="knowledgeSearch" label="Answer from the knowledge base" defaultChecked={settings.knowledgeSearch} />
        <Check name="actions" label="Propose actions" defaultChecked={settings.actions} hint="Creating tasks and subtasks, always after the user confirms." />
        <Check name="documentSummary" label="Summarize documents" defaultChecked={settings.documentSummary} />
        <Check name="studyMode" label="Study mode for learners" defaultChecked={settings.studyMode} />
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-1 text-small font-medium">Limits</legend>
        <Field label="Questions per person per day" htmlFor="ai-daily" error={state.fields?.userDailyRequests}>
          <Input id="ai-daily" name="userDailyRequests" type="number" min={1} max={10000} required defaultValue={settings.userDailyRequests} />
        </Field>
        <Field label="Organization tokens per month" htmlFor="ai-tokens" hint="0 means no limit." error={state.fields?.monthlyTokenLimit}>
          <Input id="ai-tokens" name="monthlyTokenLimit" type="number" min={0} required defaultValue={settings.monthlyTokenLimit} />
        </Field>
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-1 text-small font-medium">Data retention</legend>
        <Field label="Delete conversations unused for (days)" htmlFor="ai-retention" error={state.fields?.conversationRetentionDays}>
          <Input id="ai-retention" name="conversationRetentionDays" type="number" min={7} max={3650} required defaultValue={settings.conversationRetentionDays} />
        </Field>
        <Field label="Keep usage records for (days)" htmlFor="ai-usage-retention" error={state.fields?.usageRetentionDays}>
          <Input id="ai-usage-retention" name="usageRetentionDays" type="number" min={30} max={3650} required defaultValue={settings.usageRetentionDays} />
        </Field>
      </fieldset>
      <div>
        <SubmitButton pendingLabel="Saving…">Save settings</SubmitButton>
      </div>
    </form>
  )
}
