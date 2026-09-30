'use client'

import { ListChecks } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { inputClassName } from '@/components/ui/input'
import { SubmitButton } from '@/features/auth/components/form-bits'
import { useFormAction } from '@/features/interns/components/use-form-action'
import { cn, fullName } from '@/lib/utils'
import { setOffboardingItemAction, startOffboardingAction } from '@/server/actions/hr'
import { ActionButton } from './action-form'

export function StartOffboardingButton({ internId, name }: { internId: string; name: string }) {
  return (
    <ActionButton
      action={startOffboardingAction}
      fields={{ internId }}
      size="sm"
      variant="outline"
      aria-label={`Start offboarding for ${name}`}
    >
      <ListChecks aria-hidden /> Start offboarding
    </ActionButton>
  )
}

interface Item {
  id: string
  title: string
  status: 'PENDING' | 'DONE' | 'SKIPPED'
  note: string | null
  completed_at: Date | null
  completer: { first_name: string; last_name: string; display_name: string | null } | null
}

function ItemForm({ item, canManage }: { item: Item; canManage: boolean }) {
  const [, action] = useFormAction(setOffboardingItemAction)
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1 text-small">
        <p className={cn('font-medium', item.status !== 'PENDING' && 'text-muted-foreground')}>{item.title}</p>
        {item.completer && (
          <p className="text-caption text-muted-foreground">
            {item.status === 'DONE' ? 'Done' : 'Skipped'} by {fullName(item.completer)}
            {item.note ? ` — ${item.note}` : ''}
          </p>
        )}
      </div>
      {canManage ? (
        <form action={action} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="itemId" value={item.id} />
          <label className="sr-only" htmlFor={`item-${item.id}`}>
            Status of {item.title}
          </label>
          <select
            id={`item-${item.id}`}
            name="status"
            defaultValue={item.status}
            className={cn(inputClassName, 'h-8 w-32')}
          >
            <option value="PENDING">Pending</option>
            <option value="DONE">Done</option>
            <option value="SKIPPED">Skipped</option>
          </select>
          <label className="sr-only" htmlFor={`note-${item.id}`}>
            Note for {item.title}
          </label>
          <input
            id={`note-${item.id}`}
            name="note"
            placeholder="Note"
            defaultValue={item.note ?? ''}
            maxLength={500}
            className={cn(inputClassName, 'h-8 w-40')}
          />
          <SubmitButton size="sm" variant="outline">
            Save
          </SubmitButton>
        </form>
      ) : (
        <StatusBadge status={item.status} />
      )}
    </li>
  )
}

export function OffboardingChecklist({ items, canManage }: { items: Item[]; canManage: boolean }) {
  return (
    <ul className="divide-y">
      {items.map((item) => (
        <ItemForm key={item.id} item={item} canManage={canManage} />
      ))}
    </ul>
  )
}
