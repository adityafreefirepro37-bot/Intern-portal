'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Archive, ArchiveRestore, FilePlus2, Pencil, RefreshCw, Trash2, Upload } from 'lucide-react'
import { EditorDialog, Select } from '@/components/forms/editor-dialog'
import { Button } from '@/components/ui/button'
import { Input, inputClassName, Textarea } from '@/components/ui/input'
import { Field } from '@/features/auth/components/form-bits'
import { ConfirmActionButton } from '@/features/learning/components/confirm-action'
import { humanizeEnum } from '@/lib/utils'
import {
  addKnowledgeVersionAction,
  createKnowledgeDocumentAction,
  deleteKnowledgeDocumentAction,
  reprocessKnowledgeDocumentAction,
  setKnowledgeArchivedAction,
  updateKnowledgeDocumentAction,
} from '@/server/actions/ai'
import { KNOWLEDGE_CATEGORIES, KNOWLEDGE_VISIBILITIES, VISIBILITY_LABELS } from './knowledge-labels'

export interface KnowledgeOptions {
  departments: { id: string; name: string }[]
  teams: { id: string; name: string }[]
  roles: { id: string; name: string }[]
  projects: { id: string; name: string }[]
}

interface DocumentValues {
  id: string
  title: string
  description: string | null
  category: string
  visibility: string
  department_id: string | null
  team_id: string | null
  role_id: string | null
  project_id: string | null
  effective_date: string | null
}

const ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.html,.htm'

/** Title, category, audience and date — shared by the add and edit forms. */
function MetadataFields({
  options,
  values,
  state,
}: {
  options: KnowledgeOptions
  values?: DocumentValues
  state: { fields?: Record<string, string | undefined>; values?: Record<string, string> }
}) {
  const id = React.useId()
  const [visibility, setVisibility] = React.useState(state.values?.visibility ?? values?.visibility ?? 'ORGANIZATION')
  const option = (items: { id: string; name: string }[]) => items.map((i) => ({ value: i.id, label: i.name }))
  return (
    <>
      <Field label="Title" htmlFor={`${id}-title`} error={state.fields?.title}>
        <Input id={`${id}-title`} name="title" required minLength={2} maxLength={200} defaultValue={state.values?.title ?? values?.title} />
      </Field>
      <Field label="Description (optional)" htmlFor={`${id}-description`} error={state.fields?.description}>
        <Input id={`${id}-description`} name="description" maxLength={1000} defaultValue={state.values?.description ?? values?.description ?? ''} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" htmlFor={`${id}-category`}>
          <Select
            id={`${id}-category`}
            name="category"
            defaultValue={state.values?.category ?? values?.category ?? 'GENERAL'}
            options={KNOWLEDGE_CATEGORIES.map((c) => ({ value: c, label: c === 'HR' || c === 'SOP' ? c : humanizeEnum(c) }))}
          />
        </Field>
        <Field label="Effective date (optional)" htmlFor={`${id}-date`} error={state.fields?.effectiveDate}>
          <Input id={`${id}-date`} name="effectiveDate" type="date" defaultValue={state.values?.effectiveDate ?? values?.effective_date ?? ''} />
        </Field>
      </div>
      <Field label="Who can see it" htmlFor={`${id}-visibility`} hint="AYAVA AI only uses a document for people who can see it.">
        <select
          id={`${id}-visibility`}
          name="visibility"
          value={visibility}
          onChange={(event) => setVisibility(event.target.value)}
          className={inputClassName}
        >
          {KNOWLEDGE_VISIBILITIES.map((v) => (
            <option key={v} value={v}>
              {VISIBILITY_LABELS[v]}
            </option>
          ))}
        </select>
      </Field>
      {visibility === 'DEPARTMENT' && (
        <Field label="Department" htmlFor={`${id}-department`} error={state.fields?.departmentId}>
          <Select id={`${id}-department`} name="departmentId" defaultValue={values?.department_id} options={option(options.departments)} empty="Choose…" />
        </Field>
      )}
      {visibility === 'TEAM' && (
        <Field label="Team" htmlFor={`${id}-team`} error={state.fields?.teamId}>
          <Select id={`${id}-team`} name="teamId" defaultValue={values?.team_id} options={option(options.teams)} empty="Choose…" />
        </Field>
      )}
      {visibility === 'ROLE' && (
        <Field label="Role" htmlFor={`${id}-role`} error={state.fields?.roleId}>
          <Select id={`${id}-role`} name="roleId" defaultValue={values?.role_id} options={option(options.roles)} empty="Choose…" />
        </Field>
      )}
      {visibility === 'PROJECT' && (
        <Field label="Project" htmlFor={`${id}-project`} error={state.fields?.projectId}>
          <Select id={`${id}-project`} name="projectId" defaultValue={values?.project_id} options={option(options.projects)} empty="Choose…" />
        </Field>
      )}
    </>
  )
}

function SourceFields({ state }: { state: { fields?: Record<string, string | undefined>; values?: Record<string, string> } }) {
  const id = React.useId()
  const [mode, setMode] = React.useState<'file' | 'text'>('file')
  return (
    <fieldset className="grid gap-3">
      <legend className="sr-only">Document source</legend>
      <div className="flex gap-4 text-small">
        <label className="flex items-center gap-1.5">
          <input type="radio" name="sourceMode" checked={mode === 'file'} onChange={() => setMode('file')} /> Upload a file
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="sourceMode" checked={mode === 'text'} onChange={() => setMode('text')} /> Paste text
        </label>
      </div>
      {mode === 'file' ? (
        <Field label="File" htmlFor={`${id}-file`} hint="PDF, Word (.docx), text, Markdown or HTML. Scanned PDFs need OCR first." error={state.fields?.file}>
          <Input id={`${id}-file`} name="file" type="file" accept={ACCEPT} />
        </Field>
      ) : (
        <Field label="Document text" htmlFor={`${id}-text`} hint="Markdown headings (# Title) become citation sections." error={state.fields?.text ?? state.fields?.file}>
          <Textarea id={`${id}-text`} name="text" rows={8} defaultValue={state.values?.text} />
        </Field>
      )}
    </fieldset>
  )
}

export function AddDocumentDialog({ options }: { options: KnowledgeOptions }) {
  return (
    <EditorDialog
      wide
      title="Add a document"
      description="It’s processed in the background, then available to search and AYAVA AI."
      action={createKnowledgeDocumentAction}
      trigger={(open) => (
        <Button onClick={open}>
          <Upload aria-hidden /> Add document
        </Button>
      )}
    >
      {(state) => (
        <>
          <MetadataFields options={options} state={state} />
          <SourceFields state={state} />
        </>
      )}
    </EditorDialog>
  )
}

export function EditDocumentDialog({ document, options }: { document: DocumentValues; options: KnowledgeOptions }) {
  return (
    <EditorDialog
      wide
      title={`Edit ${document.title}`}
      description="Applies to every version of this document."
      action={updateKnowledgeDocumentAction}
      trigger={(open) => (
        <Button variant="outline" size="sm" onClick={open}>
          <Pencil aria-hidden /> Edit
        </Button>
      )}
    >
      {(state) => (
        <>
          <input type="hidden" name="documentId" value={document.id} />
          <MetadataFields options={options} values={document} state={state} />
        </>
      )}
    </EditorDialog>
  )
}

export function NewVersionDialog({ documentId, title }: { documentId: string; title: string }) {
  return (
    <EditorDialog
      wide
      title={`New version of ${title}`}
      description="The current version stays in use until the new one finishes processing. Old versions are kept."
      action={addKnowledgeVersionAction}
      trigger={(open) => (
        <Button variant="outline" size="sm" onClick={open}>
          <FilePlus2 aria-hidden /> New version
        </Button>
      )}
    >
      {(state) => (
        <>
          <input type="hidden" name="documentId" value={documentId} />
          <SourceFields state={state} />
          <Field label="Effective date (optional)" htmlFor="version-date">
            <Input id="version-date" name="effectiveDate" type="date" />
          </Field>
        </>
      )}
    </EditorDialog>
  )
}

export function DocumentActions({ id, title, archived }: { id: string; title: string; archived: boolean }) {
  const router = useRouter()
  return (
    <>
      <ConfirmActionButton
        action={reprocessKnowledgeDocumentAction}
        fields={{ documentId: id }}
        title={`Reprocess ${title}?`}
        description="Extracts the text and rebuilds the search index for this version."
        confirmLabel="Reprocess"
        variant="outline"
        size="sm"
      >
        <RefreshCw aria-hidden /> Reprocess
      </ConfirmActionButton>
      <ConfirmActionButton
        action={setKnowledgeArchivedAction}
        fields={{ documentId: id, archived: archived ? 'false' : 'true' }}
        title={archived ? `Restore ${title}?` : `Archive ${title}?`}
        description={archived ? 'It becomes searchable and available to AYAVA AI again.' : 'It stops appearing in search and AI answers. You can restore it later.'}
        confirmLabel={archived ? 'Restore' : 'Archive'}
        variant="outline"
        size="sm"
      >
        {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
        {archived ? 'Restore' : 'Archive'}
      </ConfirmActionButton>
      <ConfirmActionButton
        action={async (previous, data) => {
          const result = await deleteKnowledgeDocumentAction(previous, data)
          if (result.status === 'success') router.push('/knowledge')
          return result
        }}
        fields={{ documentId: id }}
        title={`Delete ${title}?`}
        description="This permanently deletes every version, its files and its search index. Archive it instead if you might need it again."
        confirmLabel="Delete permanently"
        destructive
        variant="ghost"
        size="sm"
      >
        <Trash2 aria-hidden /> Delete
      </ConfirmActionButton>
    </>
  )
}

/** Refreshes the page while documents are still processing. */
export function ProcessingWatcher({ active }: { active: boolean }) {
  const router = useRouter()
  React.useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => router.refresh(), 4000)
    return () => window.clearInterval(timer)
  }, [active, router])
  return null
}
