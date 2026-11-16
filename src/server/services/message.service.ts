import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { extractMentionIds } from '@/lib/communication/mentions'
import { fullName, slugify } from '@/lib/utils/format'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { optionalText } from './hr-shared'
import { rateLimitService } from './rate-limit.service'

/**
 * Channels and messages.
 *
 * - Company channels (type GENERAL) are open to everyone in the organization.
 * - Team, department and project channels have explicit members, managed by
 *   people with channel.manage (who also see every non-direct channel, to manage it).
 * - Direct messages are channels of type DIRECT with exactly two members;
 *   nobody else — administrators included — can read them.
 *
 * Read markers live on channel_members.last_read_at (a company channel gets a
 * membership row the first time someone opens the messages page). Clients poll
 * for changes; every edit and deletion bumps updated_at, so a poll picks them up.
 */

const PAGE = 50
const MAX_MEMBERS = 500
const CHANNEL_TYPES = ['GENERAL', 'TEAM', 'DEPARTMENT', 'PROJECT'] as const

const personSelect = { id: true, first_name: true, last_name: true, display_name: true, avatar_url: true } as const

const bodySchema = z
  .string()
  .trim()
  .min(1, 'Write a message')
  .max(4000, 'Keep messages under 4,000 characters')
const idList = z
  .string()
  .optional()
  .transform((value) => [...new Set((value ?? '').split(',').map((id) => id.trim()).filter(Boolean))])
  .pipe(z.array(z.uuid()).max(MAX_MEMBERS))

const channelSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(2, 'Enter a name')
    .max(60)
    .regex(/^[\p{L}\p{N} _-]+$/u, 'Use letters, numbers, spaces, - and _'),
  description: optionalText(300),
  channelType: z.enum(CHANNEL_TYPES),
  memberIds: idList,
  teamId: z.string().optional().transform((v) => v || undefined).pipe(z.uuid().optional()),
  departmentId: z.string().optional().transform((v) => v || undefined).pipe(z.uuid().optional()),
  projectId: z.string().optional().transform((v) => v || undefined).pipe(z.uuid().optional()),
})

const channelUpdateSchema = z.strictObject({
  channelId: z.uuid(),
  name: channelSchema.shape.name,
  description: optionalText(300),
})

const messageRowSelect = {
  id: true,
  body: true,
  sender_id: true,
  created_at: true,
  updated_at: true,
  edited_at: true,
  deleted_at: true,
  sender: { select: personSelect },
} satisfies Prisma.MessageSelect

type MessageRow = Prisma.MessageGetPayload<{ select: typeof messageRowSelect }>

function present(ctx: RequestContext, row: MessageRow, canModerate: boolean) {
  const deleted = Boolean(row.deleted_at)
  const mine = row.sender_id === ctx.actor.userId
  return {
    id: row.id,
    body: deleted ? '' : row.body,
    deleted,
    edited: Boolean(row.edited_at) && !deleted,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    sender: { id: row.sender.id, name: fullName(row.sender), avatarUrl: row.sender.avatar_url },
    canEdit: mine && !deleted,
    canDelete: !deleted && (mine || canModerate),
  }
}
export type ChatMessage = ReturnType<typeof present>

function canManage(ctx: RequestContext) {
  return authorizationService.can(ctx, 'channel.manage')
}

/** Channels the actor can open (non-archived and archived alike). */
function visibleChannels(ctx: RequestContext): Prisma.ChannelWhereInput {
  const me = ctx.actor.userId
  const open: Prisma.ChannelWhereInput[] = [{ channel_type: 'GENERAL' }, { members: { some: { user_id: me } } }]
  if (canManage(ctx)) open.push({ channel_type: { not: 'DIRECT' } })
  return { organization_id: ctx.organization.id, OR: open }
}

function directSlug(a: string, b: string) {
  return `dm-${[a, b].sort().join('-')}`
}

async function loadChannel(ctx: RequestContext, idOrSlug: string) {
  authorizationService.require(ctx, 'message.read')
  const isId = z.uuid().safeParse(idOrSlug).success
  const key = isId ? { id: idOrSlug } : { slug: z.string().max(100).parse(idOrSlug) }
  const channel = await prisma.channel.findFirst({
    where: { ...key, ...visibleChannels(ctx) },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      channel_type: true,
      archived_at: true,
      created_by: true,
      members: {
        select: { user_id: true, last_read_at: true, created_at: true, user: { select: { ...personSelect, status: true } } },
        orderBy: { created_at: 'asc' },
        take: MAX_MEMBERS,
      },
    },
  })
  if (!channel) throw new NotFoundError('Channel')
  const membership = channel.members.find((m) => m.user_id === ctx.actor.userId) ?? null
  const isOpen = channel.channel_type === 'GENERAL'
  return { channel, membership, isOpen }
}

function displayName(ctx: RequestContext, channel: { channel_type: string; name: string; members: { user_id: string; user: Parameters<typeof fullName>[0] }[] }) {
  if (channel.channel_type !== 'DIRECT') return channel.name
  const other = channel.members.find((m) => m.user_id !== ctx.actor.userId)
  return other ? fullName(other.user) : 'Direct message'
}

export const messageService = {
  /**
   * Sidebar: channels and direct messages the actor belongs to (company
   * channels always), with unread counts. Archived channels are listed apart.
   */
  async channels(ctx: RequestContext) {
    authorizationService.require(ctx, 'message.read')
    const me = ctx.actor.userId
    // Company channels get a membership row (for the read marker) the first time.
    const general = await prisma.channel.findMany({
      where: {
        organization_id: ctx.organization.id,
        channel_type: 'GENERAL',
        archived_at: null,
        members: { none: { user_id: me } },
      },
      select: { id: true },
    })
    if (general.length) {
      await prisma.channelMember.createMany({
        data: general.map((c) => ({ channel_id: c.id, user_id: me })),
        skipDuplicates: true,
      })
    }
    const rows = await prisma.channel.findMany({
      where: { organization_id: ctx.organization.id, OR: [{ channel_type: 'GENERAL' }, { members: { some: { user_id: me } } }] },
      orderBy: [{ last_message_at: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
      take: 300,
      select: {
        id: true,
        slug: true,
        name: true,
        channel_type: true,
        archived_at: true,
        last_message_at: true,
        members: {
          where: { OR: [{ user_id: me }, { channel: { channel_type: 'DIRECT' } }] },
          select: { user_id: true, user: { select: personSelect } },
        },
      },
    })
    const unread = rows.length
      ? await prisma.$queryRaw<{ channel_id: string; unread: number }[]>`
          SELECT m.channel_id::text AS channel_id, count(*)::int AS unread
          FROM messages m
          JOIN channel_members cm ON cm.channel_id = m.channel_id AND cm.user_id = ${me}::uuid
          WHERE m.channel_id = ANY(${rows.map((r) => r.id)}::uuid[])
            AND m.deleted_at IS NULL
            AND m.sender_id <> ${me}::uuid
            AND m.created_at > COALESCE(cm.last_read_at, cm.created_at)
          GROUP BY m.channel_id`
      : []
    const unreadBy = new Map(unread.map((u) => [u.channel_id, u.unread]))
    const items = rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: displayName(ctx, row),
      type: row.channel_type,
      archived: Boolean(row.archived_at),
      lastMessageAt: row.last_message_at,
      unread: unreadBy.get(row.id) ?? 0,
    }))
    return {
      channels: items.filter((c) => c.type !== 'DIRECT' && !c.archived),
      direct: items.filter((c) => c.type === 'DIRECT'),
      archived: items.filter((c) => c.type !== 'DIRECT' && c.archived),
      totalUnread: items.reduce((n, c) => n + (c.archived ? 0 : c.unread), 0),
    }
  },

  /** Total unread messages (for the dashboard / navigation). */
  async unreadTotal(ctx: RequestContext) {
    if (!authorizationService.can(ctx, 'message.read')) return 0
    const [row] = await prisma.$queryRaw<{ unread: number }[]>`
      SELECT count(*)::int AS unread
      FROM messages m
      JOIN channel_members cm ON cm.channel_id = m.channel_id AND cm.user_id = ${ctx.actor.userId}::uuid
      JOIN channels c ON c.id = m.channel_id AND c.archived_at IS NULL AND c.organization_id = ${ctx.organization.id}::uuid
      WHERE m.deleted_at IS NULL
        AND m.sender_id <> ${ctx.actor.userId}::uuid
        AND m.created_at > COALESCE(cm.last_read_at, cm.created_at)`
    return row?.unread ?? 0
  },

  /** One channel with its latest messages (or the page before `before`). */
  async open(ctx: RequestContext, idOrSlug: string, options: { before?: string } = {}) {
    const { channel, membership, isOpen } = await loadChannel(ctx, idOrSlug)
    const before = options.before ? new Date(parseInput(z.iso.datetime(), options.before)) : null
    const rows = await prisma.message.findMany({
      where: { channel_id: channel.id, ...(before ? { created_at: { lt: before } } : {}) },
      orderBy: { created_at: 'desc' },
      take: PAGE + 1,
      select: messageRowSelect,
    })
    const moderate = canManage(ctx) && channel.channel_type !== 'DIRECT'
    const isDirect = channel.channel_type === 'DIRECT'
    const isMember = Boolean(membership) || isOpen
    const archived = Boolean(channel.archived_at)
    const members = channel.members
      .filter((m) => m.user.status === 'ACTIVE')
      .map((m) => ({ id: m.user.id, name: fullName(m.user), avatarUrl: m.user.avatar_url }))
    return {
      channel: {
        id: channel.id,
        slug: channel.slug,
        name: displayName(ctx, channel),
        rawName: channel.name,
        description: channel.description,
        type: channel.channel_type,
        archived,
      },
      // Company channels: everyone; others: their members (mention targets and the member list).
      members,
      memberCount: isOpen ? null : members.length,
      hasMore: rows.length > PAGE,
      messages: rows.slice(0, PAGE).reverse().map((row) => present(ctx, row, moderate)),
      lastReadAt: membership?.last_read_at?.toISOString() ?? membership?.created_at.toISOString() ?? null,
      canPost: !archived && isMember && authorizationService.can(ctx, 'message.send'),
      canManage: canManage(ctx) && !isDirect,
      isMember,
    }
  },

  /** Messages created, edited or deleted after `since` (polling). */
  async changes(ctx: RequestContext, channelId: string, since: string) {
    const { channel } = await loadChannel(ctx, parseInput(z.uuid(), channelId))
    const after = new Date(parseInput(z.iso.datetime(), since))
    const rows = await prisma.message.findMany({
      where: { channel_id: channel.id, updated_at: { gt: after } },
      orderBy: { created_at: 'asc' },
      take: 200,
      select: messageRowSelect,
    })
    const moderate = canManage(ctx) && channel.channel_type !== 'DIRECT'
    return {
      messages: rows.map((row) => present(ctx, row, moderate)),
      cursor: rows.reduce((latest, row) => (row.updated_at > latest ? row.updated_at : latest), after).toISOString(),
    }
  },

  async markRead(ctx: RequestContext, channelId: string) {
    const { channel, membership, isOpen } = await loadChannel(ctx, parseInput(z.uuid(), channelId))
    if (!membership && !isOpen) return
    await prisma.channelMember.upsert({
      where: { channel_id_user_id: { channel_id: channel.id, user_id: ctx.actor.userId } },
      update: { last_read_at: new Date() },
      create: { channel_id: channel.id, user_id: ctx.actor.userId, last_read_at: new Date() },
    })
  },

  async send(ctx: RequestContext, input: { channelId: string; body: string }) {
    authorizationService.require(ctx, 'message.send')
    const channelId = parseInput(z.uuid(), input.channelId)
    const body = parseInput(bodySchema, input.body)
    const { channel, membership, isOpen } = await loadChannel(ctx, channelId)
    if (channel.archived_at) throw new ValidationError('This channel is archived')
    if (!membership && !isOpen) throw new ForbiddenError('Join the channel to post in it')
    await rateLimitService.consume('messageSend', ctx.actor.userId)

    // Only people who can read the channel can be mentioned; other ids are ignored.
    const mentionCandidates = extractMentionIds(body).filter((id) => id !== ctx.actor.userId)
    const mentioned = isOpen
      ? (
          await prisma.user.findMany({
            where: { id: { in: mentionCandidates }, organization_id: ctx.organization.id, status: 'ACTIVE', deleted_at: null },
            select: { id: true },
          })
        ).map((u) => u.id)
      : mentionCandidates.filter((id) => channel.members.some((m) => m.user_id === id))

    const now = new Date()
    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: { channel_id: channel.id, sender_id: ctx.actor.userId, body, mentioned_user_ids: mentioned },
        select: messageRowSelect,
      }),
      prisma.channel.update({ where: { id: channel.id }, data: { last_message_at: now } }),
      prisma.channelMember.upsert({
        where: { channel_id_user_id: { channel_id: channel.id, user_id: ctx.actor.userId } },
        update: { last_read_at: now },
        create: { channel_id: channel.id, user_id: ctx.actor.userId, last_read_at: now },
      }),
    ])
    await domainEvents.emit('message.posted', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: {
        messageId: message.id,
        channelId: channel.id,
        mentionedUserIds: mentioned,
        directRecipientIds:
          channel.channel_type === 'DIRECT' ? channel.members.map((m) => m.user_id).filter((id) => id !== ctx.actor.userId) : [],
      },
    })
    return present(ctx, message, false)
  },

  async edit(ctx: RequestContext, input: { messageId: string; body: string }) {
    authorizationService.require(ctx, 'message.send')
    const id = parseInput(z.uuid(), input.messageId)
    const body = parseInput(bodySchema, input.body)
    const message = await prisma.message.findFirst({
      where: { id, sender_id: ctx.actor.userId, deleted_at: null, channel: { organization_id: ctx.organization.id } },
      select: { id: true, channel: { select: { archived_at: true } } },
    })
    if (!message) throw new NotFoundError('Message')
    if (message.channel.archived_at) throw new ValidationError('This channel is archived')
    const row = await prisma.message.update({ where: { id }, data: { body, edited_at: new Date() }, select: messageRowSelect })
    return present(ctx, row, false)
  },

  /** Senders delete their own messages; channel managers can remove any message outside direct messages. */
  async remove(ctx: RequestContext, messageId: string) {
    authorizationService.require(ctx, 'message.read')
    const id = parseInput(z.uuid(), messageId)
    const message = await prisma.message.findFirst({
      where: { id, deleted_at: null, channel: visibleChannels(ctx) },
      select: { id: true, sender_id: true, channel: { select: { id: true, channel_type: true } } },
    })
    if (!message) throw new NotFoundError('Message')
    const own = message.sender_id === ctx.actor.userId
    if (!own && !(canManage(ctx) && message.channel.channel_type !== 'DIRECT')) throw new ForbiddenError()
    await prisma.message.update({ where: { id }, data: { deleted_at: new Date() } })
    if (!own) {
      await auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.MESSAGE_REMOVED_BY_MODERATOR,
        resourceType: 'message',
        resourceId: id,
        metadata: { channelId: message.channel.id, senderId: message.sender_id },
      })
    }
  },

  /** Opens (creating on first use) the direct-message channel with another person. */
  async openDirect(ctx: RequestContext, userId: string) {
    authorizationService.require(ctx, 'message.send')
    const otherId = parseInput(z.uuid(), userId)
    if (otherId === ctx.actor.userId) throw new ValidationError('Choose someone else')
    const other = await prisma.user.findFirst({
      where: { id: otherId, organization_id: ctx.organization.id, status: 'ACTIVE', deleted_at: null },
      select: { id: true },
    })
    if (!other) throw new NotFoundError('Person')
    const slug = directSlug(ctx.actor.userId, other.id)
    const existing = await prisma.channel.findUnique({
      where: { organization_id_slug: { organization_id: ctx.organization.id, slug } },
      select: { id: true, slug: true },
    })
    if (existing) return existing
    try {
      return await prisma.channel.create({
        data: {
          organization_id: ctx.organization.id,
          slug,
          name: 'Direct message',
          channel_type: 'DIRECT',
          created_by: ctx.actor.userId,
          members: { create: [{ user_id: ctx.actor.userId }, { user_id: other.id }] },
        },
        select: { id: true, slug: true },
      })
    } catch (error) {
      // Both people opened the conversation at the same moment.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return prisma.channel.findUniqueOrThrow({
          where: { organization_id_slug: { organization_id: ctx.organization.id, slug } },
          select: { id: true, slug: true },
        })
      }
      throw error
    }
  },

  /** Everyone the actor can start a direct message with. */
  async people(ctx: RequestContext) {
    authorizationService.require(ctx, 'message.read')
    const rows = await prisma.user.findMany({
      where: { organization_id: ctx.organization.id, status: 'ACTIVE', deleted_at: null, id: { not: ctx.actor.userId } },
      orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
      take: 1000,
      select: personSelect,
    })
    return rows.map((p) => ({ id: p.id, name: fullName(p) }))
  },

  /** Sources for "add everyone from …" when creating a channel. */
  async channelOptions(ctx: RequestContext) {
    authorizationService.require(ctx, 'channel.manage')
    const org = ctx.organization.id
    const [teams, departments, projects, people] = await Promise.all([
      prisma.team.findMany({ where: { organization_id: org, is_active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      prisma.department.findMany({ where: { organization_id: org }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      prisma.project.findMany({
        where: { organization_id: org, deleted_at: null, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
        orderBy: { name: 'asc' },
        take: 300,
        select: { id: true, name: true },
      }),
      this.people(ctx),
    ])
    return { teams, departments, projects, people }
  },

  async createChannel(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'channel.manage')
    const data = parseInput(channelSchema, input)
    const org = ctx.organization.id
    const slugBase = slugify(data.name, 50) || 'channel'
    const taken = await prisma.channel.findMany({
      where: { organization_id: org, slug: { startsWith: slugBase } },
      select: { slug: true },
    })
    let slug = slugBase
    for (let i = 2; taken.some((t) => t.slug === slug); i++) slug = `${slugBase}-${i}`

    const memberIds = new Set(data.channelType === 'GENERAL' ? [] : data.memberIds)
    if (data.channelType !== 'GENERAL') {
      const [team, department, project] = await Promise.all([
        data.teamId
          ? prisma.team.findFirst({
              where: { id: data.teamId, organization_id: org },
              select: { team_lead_id: true, interns: { where: { deleted_at: null }, select: { user_id: true } } },
            })
          : null,
        data.departmentId
          ? prisma.department.findFirst({
              where: { id: data.departmentId, organization_id: org },
              select: { head_user_id: true, interns: { where: { deleted_at: null }, select: { user_id: true } } },
            })
          : null,
        data.projectId
          ? prisma.project.findFirst({
              where: { id: data.projectId, organization_id: org, deleted_at: null },
              select: { owner_id: true, manager_id: true, members: { select: { user_id: true } } },
            })
          : null,
      ])
      if ((data.teamId && !team) || (data.departmentId && !department) || (data.projectId && !project)) {
        throw new NotFoundError('Team, department or project')
      }
      for (const id of [
        team?.team_lead_id,
        ...(team?.interns.map((i) => i.user_id) ?? []),
        department?.head_user_id,
        ...(department?.interns.map((i) => i.user_id) ?? []),
        project?.owner_id,
        project?.manager_id,
        ...(project?.members.map((m) => m.user_id) ?? []),
      ]) {
        if (id) memberIds.add(id)
      }
      memberIds.add(ctx.actor.userId)
    }
    const valid = memberIds.size
      ? await prisma.user.findMany({
          where: { id: { in: [...memberIds] }, organization_id: org, status: 'ACTIVE', deleted_at: null },
          select: { id: true },
        })
      : []
    if (valid.length > MAX_MEMBERS) throw new ValidationError(`Channels can have at most ${MAX_MEMBERS} members`)
    const channel = await prisma.channel.create({
      data: {
        organization_id: org,
        slug,
        name: data.name,
        description: data.description ?? null,
        channel_type: data.channelType,
        created_by: ctx.actor.userId,
        members: { create: valid.map((u) => ({ user_id: u.id, added_by: ctx.actor.userId })) },
      },
      select: { id: true, slug: true },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.CHANNEL_CREATED,
      resourceType: 'channel',
      resourceId: channel.id,
      metadata: { type: data.channelType, members: valid.length },
    })
    const added = valid.map((u) => u.id).filter((id) => id !== ctx.actor.userId)
    if (added.length) {
      await domainEvents.emit('channel.members_added', {
        organizationId: org,
        actorUserId: ctx.actor.userId,
        payload: { channelId: channel.id, userIds: added },
      })
    }
    return channel
  },

  async updateChannel(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'channel.manage')
    const data = parseInput(channelUpdateSchema, input)
    const { channel } = await loadChannel(ctx, data.channelId)
    if (channel.channel_type === 'DIRECT') throw new NotFoundError('Channel')
    await prisma.channel.update({
      where: { id: channel.id },
      data: { name: data.name, description: data.description ?? null },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.CHANNEL_UPDATED,
      resourceType: 'channel',
      resourceId: channel.id,
      metadata: { before: { name: channel.name }, after: { name: data.name } },
    })
  },

  async addMembers(ctx: RequestContext, input: { channelId: string; memberIds: string }) {
    authorizationService.require(ctx, 'channel.manage')
    const ids = parseInput(idList, input.memberIds)
    const { channel } = await loadChannel(ctx, parseInput(z.uuid(), input.channelId))
    if (channel.channel_type === 'DIRECT' || channel.channel_type === 'GENERAL') {
      throw new ValidationError('Company channels and direct messages have no member list')
    }
    const current = new Set(channel.members.map((m) => m.user_id))
    const valid = await prisma.user.findMany({
      where: {
        id: { in: ids.filter((id) => !current.has(id)) },
        organization_id: ctx.organization.id,
        status: 'ACTIVE',
        deleted_at: null,
      },
      select: { id: true },
    })
    if (current.size + valid.length > MAX_MEMBERS) throw new ValidationError(`Channels can have at most ${MAX_MEMBERS} members`)
    if (valid.length === 0) return { added: 0 }
    await prisma.channelMember.createMany({
      data: valid.map((u) => ({ channel_id: channel.id, user_id: u.id, added_by: ctx.actor.userId })),
      skipDuplicates: true,
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.CHANNEL_MEMBERS_CHANGED,
      resourceType: 'channel',
      resourceId: channel.id,
      metadata: { added: valid.length },
    })
    const notify = valid.map((u) => u.id).filter((id) => id !== ctx.actor.userId)
    if (notify.length) {
      await domainEvents.emit('channel.members_added', {
        organizationId: ctx.organization.id,
        actorUserId: ctx.actor.userId,
        payload: { channelId: channel.id, userIds: notify },
      })
    }
    return { added: valid.length }
  },

  /** Managers remove anyone; members can leave non-direct channels themselves. */
  async removeMember(ctx: RequestContext, input: { channelId: string; userId: string }) {
    authorizationService.require(ctx, 'message.read')
    const userId = parseInput(z.uuid(), input.userId)
    const { channel } = await loadChannel(ctx, parseInput(z.uuid(), input.channelId))
    if (channel.channel_type === 'DIRECT' || channel.channel_type === 'GENERAL') {
      throw new ValidationError('Company channels and direct messages have no member list')
    }
    if (userId !== ctx.actor.userId && !canManage(ctx)) throw new ForbiddenError()
    const { count } = await prisma.channelMember.deleteMany({ where: { channel_id: channel.id, user_id: userId } })
    if (count) {
      await auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.CHANNEL_MEMBERS_CHANGED,
        resourceType: 'channel',
        resourceId: channel.id,
        metadata: { removed: 1, left: userId === ctx.actor.userId },
      })
    }
  },

  async setArchived(ctx: RequestContext, input: { channelId: string; archived: boolean }) {
    authorizationService.require(ctx, 'channel.manage')
    const { channel } = await loadChannel(ctx, parseInput(z.uuid(), input.channelId))
    if (channel.channel_type === 'DIRECT') throw new NotFoundError('Channel')
    await prisma.channel.update({
      where: { id: channel.id },
      data: { archived_at: input.archived ? new Date() : null },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.CHANNEL_ARCHIVED,
      resourceType: 'channel',
      resourceId: channel.id,
      metadata: { archived: input.archived },
    })
  },
}
