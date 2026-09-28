import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn, fullName, initials } from '@/lib/utils'

export interface AvatarPerson {
  first_name: string
  last_name: string
  display_name?: string | null
  avatar_url?: string | null
}

export function UserAvatar({ person, className }: { person: AvatarPerson; className?: string }) {
  const name = fullName(person)
  return (
    <Avatar className={className}>
      {person.avatar_url && <AvatarImage src={person.avatar_url} alt="" />}
      <AvatarFallback aria-hidden>{initials(name)}</AvatarFallback>
      <span className="sr-only">{name}</span>
    </Avatar>
  )
}

/** Overlapping avatars with a "+N" overflow chip. */
export function AvatarGroup({
  people,
  max = 4,
  total,
  className,
}: {
  people: AvatarPerson[]
  max?: number
  /** Full count when `people` is a truncated list. */
  total?: number
  className?: string
}) {
  const shown = people.slice(0, max)
  const overflow = (total ?? people.length) - shown.length
  if (shown.length === 0) return <span className="text-caption text-muted-foreground">Unassigned</span>
  return (
    <div className={cn('flex items-center -space-x-2', className)}>
      {shown.map((person, index) => (
        <UserAvatar key={index} person={person} className="size-7 ring-2 ring-card" />
      ))}
      {overflow > 0 && (
        <span className="flex size-7 items-center justify-center rounded-full bg-muted text-[0.6875rem] font-medium text-muted-foreground ring-2 ring-card">
          +{overflow}
          <span className="sr-only"> more</span>
        </span>
      )}
    </div>
  )
}
