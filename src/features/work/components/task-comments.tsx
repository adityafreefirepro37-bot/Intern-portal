'use client'

import { RelativeTime } from '@/components/common/relative-time'
import * as React from 'react'
import { AtSign, CornerDownRight, Pencil, Trash2 } from 'lucide-react'
import { UserAvatar } from '@/components/common/user-avatar'
import { Button } from '@/components/ui/button'
import { inputClassName, Textarea } from '@/components/ui/input'
import { FormMessage, SubmitButton } from '@/features/auth/components/form-bits'
import { useFormAction } from '@/features/interns/components/use-form-action'
import { cn, fullName } from '@/lib/utils'
import { addCommentAction, updateCommentAction } from '@/server/actions/work'

type Person = {
  id: string
  first_name: string
  last_name: string
  display_name: string | null
  avatar_url: string | null
}

export interface CommentView {
  id: string
  parent_id: string | null
  body: string
  created_at: Date
  edited_at: Date | null
  deleted_at: Date | null
  user: Person
}

const MENTION = /@\[([^\]]{1,80})\]\(([0-9a-f-]{36})\)/g

/** Renders comment text, turning mention markup into highlighted names (text only — never HTML). */
function CommentBody({ body }: { body: string }) {
  const parts: React.ReactNode[] = []
  let last = 0
  for (const match of body.matchAll(MENTION)) {
    if (match.index! > last) parts.push(body.slice(last, match.index))
    parts.push(
      <span key={match.index} className="rounded bg-primary/10 px-0.5 font-medium text-primary">
        @{match[1]}
      </span>,
    )
    last = match.index! + match[0].length
  }
  if (last < body.length) parts.push(body.slice(last))
  return <p className="whitespace-pre-line break-words text-small">{parts}</p>
}

function Composer({
  taskId,
  parentId,
  participants,
  onDone,
  placeholder = 'Add a comment…',
}: {
  taskId: string
  parentId?: string
  participants: Person[]
  onDone?: () => void
  placeholder?: string
}) {
  const [body, setBody] = React.useState('')
  const [state, action] = useFormAction(addCommentAction, {
    toast: false,
    onSuccess: () => {
      setBody('')
      onDone?.()
    },
  })
  const textarea = React.useRef<HTMLTextAreaElement>(null)
  function mention(personId: string) {
    const person = participants.find((p) => p.id === personId)
    if (!person) return
    const token = `@[${fullName(person).replace(/[[\]]/g, '')}](${person.id}) `
    const el = textarea.current
    const at = el?.selectionStart ?? body.length
    setBody((current) => current.slice(0, at) + token + current.slice(at))
    requestAnimationFrame(() => el?.focus())
  }
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="taskId" value={taskId} />
      {parentId && <input type="hidden" name="parentId" value={parentId} />}
      <Textarea
        ref={textarea}
        name="body"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={parentId ? 2 : 3}
        maxLength={5000}
        placeholder={placeholder}
        aria-label={parentId ? 'Reply' : 'Comment'}
        required
      />
      <div className="flex flex-wrap items-center gap-2">
        {participants.length > 0 && (
          <label className="flex items-center gap-1.5 text-caption text-muted-foreground">
            <AtSign className="size-3.5" aria-hidden />
            <span className="sr-only">Mention someone</span>
            <select
              value=""
              onChange={(event) => mention(event.target.value)}
              className={cn(inputClassName, 'h-8 w-auto text-caption')}
              aria-label="Mention someone"
            >
              <option value="">Mention…</option>
              {participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {fullName(p)}
                </option>
              ))}
            </select>
          </label>
        )}
        <SubmitButton size="sm" pendingLabel="Posting…" className="ml-auto" disabled={!body.trim()}>
          {parentId ? 'Reply' : 'Comment'}
        </SubmitButton>
      </div>
      <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
    </form>
  )
}

function CommentItem({
  comment,
  viewerId,
  canModerate,
  onReply,
}: {
  comment: CommentView
  viewerId: string
  canModerate: boolean
  onReply?: () => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [state, action] = useFormAction(updateCommentAction, { toast: false, onSuccess: () => setEditing(false) })
  const own = comment.user.id === viewerId
  if (comment.deleted_at) {
    return <p className="py-2 text-caption italic text-muted-foreground">Comment deleted</p>
  }
  return (
    <div className="flex gap-3">
      <UserAvatar person={comment.user} className="size-8" />
      <div className="min-w-0 flex-1">
        <p className="text-caption">
          <span className="font-medium text-foreground">{fullName(comment.user)}</span>{' '}
          <span className="text-muted-foreground">
            <RelativeTime date={comment.created_at} />
            {comment.edited_at && ' · edited'}
          </span>
        </p>
        {editing ? (
          <form action={action} className="mt-1 grid gap-2">
            <input type="hidden" name="commentId" value={comment.id} />
            <Textarea
              name="body"
              defaultValue={comment.body}
              rows={3}
              maxLength={5000}
              required
              aria-label="Edit comment"
            />
            <div className="flex gap-2">
              <SubmitButton size="sm" pendingLabel="Saving…">
                Save
              </SubmitButton>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <CommentBody body={comment.body} />
        )}
        <div className="mt-1 flex gap-1">
          {onReply && (
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onReply}>
              <CornerDownRight aria-hidden /> Reply
            </Button>
          )}
          {own && !editing && (
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setEditing(true)}>
              <Pencil aria-hidden /> Edit
            </Button>
          )}
          {(own || canModerate) && !editing && (
            <form action={action}>
              <input type="hidden" name="commentId" value={comment.id} />
              <input type="hidden" name="remove" value="true" />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={(event) => {
                  if (!window.confirm('Delete this comment?')) event.preventDefault()
                }}
              >
                <Trash2 aria-hidden /> Delete
              </Button>
            </form>
          )}
        </div>
        <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
      </div>
    </div>
  )
}

/** Threaded comments (one reply level) with @mentions of task participants. */
export function TaskComments({
  taskId,
  comments,
  participants,
  viewerId,
  canComment,
  canModerate,
}: {
  taskId: string
  comments: CommentView[]
  participants: Person[]
  viewerId: string
  canComment: boolean
  canModerate: boolean
}) {
  const [replyTo, setReplyTo] = React.useState<string | null>(null)
  const roots = comments.filter((c) => !c.parent_id)
  const replies = (id: string) => comments.filter((c) => c.parent_id === id)
  const others = participants.filter((p) => p.id !== viewerId)
  return (
    <div className="space-y-5">
      {roots.length === 0 && (
        <p className="text-small text-muted-foreground">No comments yet. Start the conversation.</p>
      )}
      <ol className="space-y-5">
        {roots.map((comment) => (
          <li key={comment.id} className="space-y-3">
            <CommentItem
              comment={comment}
              viewerId={viewerId}
              canModerate={canModerate}
              onReply={canComment && !comment.deleted_at ? () => setReplyTo(comment.id) : undefined}
            />
            {(replies(comment.id).length > 0 || replyTo === comment.id) && (
              <ol className="ml-11 space-y-3 border-l pl-4">
                {replies(comment.id).map((reply) => (
                  <li key={reply.id}>
                    <CommentItem comment={reply} viewerId={viewerId} canModerate={canModerate} />
                  </li>
                ))}
                {replyTo === comment.id && (
                  <li>
                    <Composer
                      taskId={taskId}
                      parentId={comment.id}
                      participants={others}
                      onDone={() => setReplyTo(null)}
                      placeholder="Write a reply…"
                    />
                  </li>
                )}
              </ol>
            )}
          </li>
        ))}
      </ol>
      {canComment && <Composer taskId={taskId} participants={others} />}
    </div>
  )
}
