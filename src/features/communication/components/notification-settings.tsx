'use client'

import { FormMessage, SubmitButton } from '@/features/auth/components/form-bits'
import { useFormAction } from '@/features/interns/components/use-form-action'
import { saveNotificationPreferencesAction } from '@/server/actions/communication'

export interface PreferenceRow {
  category: string
  label: string
  description: string
  inApp: boolean
  email: boolean
}

/** One row per category: show in the app / send an email. */
export function NotificationSettingsForm({ items, emailAvailable }: { items: PreferenceRow[]; emailAvailable: boolean }) {
  const [state, action] = useFormAction(saveNotificationPreferencesAction)
  return (
    <form action={action} className="space-y-4">
      <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-small">
          <caption className="sr-only">Where each kind of notification reaches you</caption>
          <thead className="bg-muted/50 text-left text-caption text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Notification
              </th>
              <th scope="col" className="w-24 px-3 py-2 text-center font-medium">
                In the app
              </th>
              <th scope="col" className="w-24 px-3 py-2 text-center font-medium">
                Email
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((row) => (
              <tr key={row.category}>
                <th scope="row" className="px-3 py-2.5 text-left font-normal">
                  <span className="block font-medium">{row.label}</span>
                  <span className="text-caption text-muted-foreground">{row.description}</span>
                </th>
                <td className="px-3 py-2.5 text-center">
                  <input
                    type="checkbox"
                    name={`${row.category}.inApp`}
                    defaultChecked={row.inApp}
                    aria-label={`${row.label} in the app`}
                    className="size-4 accent-primary"
                  />
                </td>
                <td className="px-3 py-2.5 text-center">
                  <input
                    type="checkbox"
                    name={`${row.category}.email`}
                    defaultChecked={row.email}
                    aria-label={`${row.label} by email`}
                    className="size-4 accent-primary"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-caption text-muted-foreground">
        Turning off “In the app” keeps those notifications in your history without a badge.
        {!emailAvailable && ' Email isn’t set up for this organization yet, so email choices take effect once an administrator configures it.'}
      </p>
      <SubmitButton pendingLabel="Saving…">Save settings</SubmitButton>
    </form>
  )
}
