'use client'

import * as React from 'react'
import { CheckSquare, PanelRight, Trash2 } from 'lucide-react'
import { PhaseBadge, PriorityBadge, StatusBadge } from '@/components/common/badges'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states'
import { AvatarGroup } from '@/components/common/user-avatar'
import { ConfirmDialog } from '@/components/feedback/confirm-dialog'
import { useToast } from '@/components/feedback/toast'
import { DatePicker } from '@/components/forms/date-picker'
import { FileUpload } from '@/components/forms/file-upload'
import { FormField } from '@/components/forms/form-field'
import { SearchInput } from '@/components/forms/search-input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Kbd, Progress, Skeleton } from '@/components/ui/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const SAMPLE_PEOPLE = [
  { first_name: 'Sample', last_name: 'One' },
  { first_name: 'Sample', last_name: 'Two' },
  { first_name: 'Sample', last_name: 'Three' },
  { first_name: 'Sample', last_name: 'Four' },
  { first_name: 'Sample', last_name: 'Five' },
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-start gap-3">{children}</CardContent>
    </Card>
  )
}

export function ComponentGallery({ maxUploadBytes }: { maxUploadBytes: number }) {
  const { toast } = useToast()
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [date, setDate] = React.useState('')
  const [name, setName] = React.useState('')
  const [submitted, setSubmitted] = React.useState(false)

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="Buttons">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Button disabled>Disabled</Button>
      </Section>

      <Section title="Badges">
        {['ACTIVE', 'IN_REVIEW', 'CHANGES_REQUESTED', 'BLOCKED', 'COMPLETED', 'BACKLOG'].map((status) => (
          <StatusBadge key={status} status={status} />
        ))}
        {(['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const).map((priority) => (
          <PriorityBadge key={priority} priority={priority} />
        ))}
        <PhaseBadge phase="04" />
      </Section>

      <Section title="Modal, drawer and confirmation">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Open modal</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Modal title</DialogTitle>
              <DialogDescription>Focus is trapped here; press Escape to close.</DialogDescription>
            </DialogHeader>
            <Input aria-label="Example input" placeholder="Focusable content" />
            <DialogFooter>
              <Button>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">
              <PanelRight aria-hidden /> Open drawer
            </Button>
          </DialogTrigger>
          <DialogContent side="right">
            <DialogHeader>
              <DialogTitle>Drawer</DialogTitle>
              <DialogDescription>Side panels reuse the accessible dialog primitive.</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
        <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
          <Trash2 aria-hidden /> Confirm dialog
        </Button>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Delete sample item?"
          description="This only closes the dialog — nothing is deleted in the gallery."
          confirmLabel="Delete"
          destructive
          onConfirm={async () => {
            await new Promise((resolve) => setTimeout(resolve, 600))
            toast({ title: 'Confirmed', description: 'The sample dialog completed.', variant: 'success' })
          }}
        />
        <Button
          variant="secondary"
          onClick={() => toast({ title: 'Heads up', description: 'This is an informational toast.' })}
        >
          Show toast
        </Button>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="one" className="w-full">
          <TabsList>
            <TabsTrigger value="one">Overview</TabsTrigger>
            <TabsTrigger value="two">Details</TabsTrigger>
          </TabsList>
          <TabsContent value="one" className="text-small text-muted-foreground">
            Arrow keys move between tabs.
          </TabsContent>
          <TabsContent value="two" className="text-small text-muted-foreground">
            Second panel.
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="Form fields">
        <form
          className="grid w-full gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            setSubmitted(true)
          }}
        >
          <FormField
            label="Full name"
            required
            hint="As it should appear on certificates."
            error={submitted && name.trim().length < 2 ? 'Enter at least 2 characters' : undefined}
          >
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </FormField>
          <FormField label="Start date">
            <DatePicker value={date} onValueChange={setDate} />
          </FormField>
          <FormField label="Search">
            <SearchInput label="Search sample" value={search} onValueChange={setSearch} placeholder="Type to search" />
          </FormField>
          <FormField label="Document" hint="Validated in the browser here and again on the server.">
            <FileUpload category="document" maxBytes={maxUploadBytes} />
          </FormField>
          <div>
            <Button type="submit">Validate</Button>
          </div>
        </form>
      </Section>

      <Section title="Avatars, progress and keys">
        <AvatarGroup people={SAMPLE_PEOPLE} max={3} />
        <div className="w-full space-y-2">
          <Progress value={64} label="Sample progress" />
          <p className="text-caption text-muted-foreground">
            Press <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> to open search.
          </p>
        </div>
      </Section>

      <Section title="States">
        <div className="grid w-full gap-4 sm:grid-cols-2">
          <div className="rounded-lg border">
            <EmptyState
              compact
              icon={CheckSquare}
              title="Empty state"
              description="Explains why there is nothing here."
            />
          </div>
          <div className="rounded-lg border">
            <ErrorState title="Error state" description="Explains what failed." className="py-8" />
          </div>
          <div className="rounded-lg border">
            <LoadingState />
          </div>
          <div className="space-y-2 rounded-lg border p-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      </Section>
    </div>
  )
}
