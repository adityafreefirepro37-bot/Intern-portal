import type { RequestContext } from '@/server/context'
import { setAIProviderForTesting, type AIProvider, type GenerateOptions, type StreamEvent } from '@/server/ai/provider'
import { runWorker } from '@/server/jobs/worker'
import { growthSettings, growthSettingsSchema } from '@/server/leads/settings'
import { setMailboxesForTests, setOutreachMailerForTests, type InboxItem, type OutgoingMail, type OutreachMailer } from '@/server/outreach/mailer'
import { NOTIFICATION_TYPES } from '@/server/services/notification.service'
import { outreachService, unsubscribeByToken } from '@/server/services/outreach.service'
import { AYAVA_ORGANIZATION_ID, contextFor, prisma } from './helpers'

const MAILBOX = { email: 'aditya@ayavacreatives.com', password: 'test-only', name: 'Aditya' }

class FakeMailer implements OutreachMailer {
  sent: { mailbox: string; mail: OutgoingMail }[] = []
  inbox: InboxItem[] = []
  spf = true
  rejectTo = new Set<string>()
  async send(mailbox: { email: string }, mail: OutgoingMail) {
    if (this.rejectTo.has(mail.to)) {
      const { RecipientRejectedError } = await import('@/server/outreach/mailer')
      throw new RecipientRejectedError('Address refused (550)')
    }
    this.sent.push({ mailbox: mailbox.email, mail })
  }
  async readInbox(_mailbox: unknown, afterUid: number | null) {
    if (afterUid === null) return { items: [], lastUid: 0 }
    const items = this.inbox.filter((i) => i.uid > afterUid)
    return { items, lastUid: Math.max(afterUid, ...items.map((i) => i.uid)) }
  }
  async domainAuth() {
    return { spf: this.spf, dmarc: true, dkim: true }
  }
}

/** Writes a draft per lead; one of them invents a number, so the template is used instead. */
class FakeAI implements AIProvider {
  readonly name = 'fake'
  readonly model = 'fake-chat'
  readonly embeddingModel = null
  async generateText(options: GenerateOptions) {
    const record = String(options.messages[1]!.content)
    const invent = record.includes('Bright Smiles')
    const text = JSON.stringify({
      subject: invent ? 'Triple your patients' : 'Bookings at Doon Dental',
      body: invent
        ? 'Hi Bright Smiles, clinics like yours get 300 more patients a month with us. See the audit: {audit_link} Shall we talk about it this week?'
        : 'Hi Doon Dental,\n\nI checked your website: patients can’t book an appointment online, so the ones searching in the evening call someone else.\n\nThe free audit is here, private to you: {audit_link}\n\nWould a short walkthrough this week be useful?',
    })
    return { text, provider: this.name, model: this.model, usage: { input: 10, output: 20 } }
  }
  async *streamText(): AsyncIterable<StreamEvent> {
    throw new Error('not used')
  }
  async embed(): Promise<never> {
    throw new Error('not used')
  }
}

let admin: RequestContext
let mailer: FakeMailer

async function lead(name: string, extra: Record<string, unknown> = {}) {
  return prisma.lead.create({
    data: {
      organization_id: AYAVA_ORGANIZATION_ID,
      source: 'MANUAL',
      external_id: `outreach-${name}`,
      name,
      city: 'Dehradun',
      email: `${name.toLowerCase().replace(/\s+/g, '')}@clinic.example`,
      website: `https://${name.toLowerCase().replace(/\s+/g, '')}.example/`,
      tier: 'HOT',
      route: 'AUTO',
      research_status: 'DONE',
      need_score: 80,
      audit_token: `tok_${name.toLowerCase().replace(/\s+/g, '_')}_aaaaaaaaaaaaaaaa`.slice(0, 30),
      audit_expires_at: new Date(Date.now() + 60 * 86_400_000),
      summary: {
        problems: [{ title: 'No online booking', detail: 'Patients can’t book an appointment online.' }],
        services: ['Website Design'],
        opener: null,
      },
      summary_source: 'RULES',
      ...extra,
    },
  })
}

async function settle() {
  // Mailbox spacing and the inbox interval are minutes in real life: let every run act.
  await prisma.outreachMailbox.updateMany({ data: { last_sent_at: null, last_inbox_check_at: null } })
  await runWorker(60_000)
}

beforeAll(async () => {
  admin = await contextFor('admin@ayavacreatives.com')
  await prisma.backgroundJob.deleteMany({})
  await prisma.outreachMailbox.deleteMany({})
  await prisma.lead.deleteMany({ where: { organization_id: AYAVA_ORGANIZATION_ID } })
  await prisma.leadSuppression.deleteMany({ where: { organization_id: AYAVA_ORGANIZATION_ID } })
  await prisma.notification.deleteMany({ where: { type: { in: [NOTIFICATION_TYPES.OUTREACH_APPROVAL_NEEDED, NOTIFICATION_TYPES.LEAD_REPLIED] } } })
  await prisma.setting.deleteMany({ where: { organization_id: AYAVA_ORGANIZATION_ID, key: { in: ['growth', 'ai'] } } })
  // Lead search stays off; outreach on, every day and hour, two approvals.
  await growthSettings.save(
    AYAVA_ORGANIZATION_ID,
    growthSettingsSchema.parse({
      enabled: false,
      outreachEnabled: true,
      senderName: 'Aditya Rawat',
      postalAddress: '12 Rajpur Road, Dehradun 248001',
      sendDays: [1, 2, 3, 4, 5, 6, 7],
      sendFromHour: 0,
      sendUntilHour: 24,
      approvalsRequired: 2,
    }),
  )
  mailer = new FakeMailer()
  setOutreachMailerForTests(mailer)
  setMailboxesForTests([MAILBOX])
  setAIProviderForTesting(new FakeAI())
})

afterAll(async () => {
  setOutreachMailerForTests(null)
  setMailboxesForTests(null)
  setAIProviderForTesting(undefined)
  await prisma.$disconnect()
})

describe('Growth outreach', () => {
  it('drafts first emails for automatic leads, never for team leads, and waits for approval', async () => {
    await lead('Doon Dental')
    await lead('Bright Smiles')
    await lead('Grand Hotel', { route: 'TEAM' })
    await settle()

    const messages = await prisma.outreachMessage.findMany({ include: { lead: true }, orderBy: { created_at: 'asc' } })
    expect(messages.map((m) => m.lead.name).sort()).toEqual(['Bright Smiles', 'Doon Dental'])
    expect(messages.every((m) => m.status === 'AWAITING_APPROVAL')).toBe(true)
    expect(mailer.sent).toHaveLength(0) // nothing goes out before approval

    const doon = messages.find((m) => m.lead.name === 'Doon Dental')!
    expect(doon.subject).toBe('Bookings at Doon Dental') // the AI's draft
    expect(doon.body).toContain(`/audit/${doon.lead.audit_token}`)
    expect(doon.body).toContain('12 Rajpur Road, Dehradun 248001')
    expect(doon.body).toContain(`/api/outreach/unsubscribe/${doon.lead.audit_token}`)
    // The AI invented "300 more patients": its draft was replaced by the template.
    const bright = messages.find((m) => m.lead.name === 'Bright Smiles')!
    expect(bright.subject).toBe('A few quick wins for Bright Smiles')

    const note = await prisma.notification.findFirst({ where: { user_id: admin.actor.userId, type: NOTIFICATION_TYPES.OUTREACH_APPROVAL_NEEDED } })
    expect(note?.title).toMatch(/^[12] outreach emails? waiting for approval$/)
    const overview = await outreachService.overview(admin)
    expect(overview.readiness).toMatchObject({ ready: true })
    expect(overview.queue).toHaveLength(2)
    expect(overview.approvalsLeft).toBe(2)
  })

  it('sends an approved email from the mailbox with unsubscribe headers, then follows up in the same thread', async () => {
    const [doon, bright] = await Promise.all([
      prisma.outreachMessage.findFirstOrThrow({ where: { lead: { name: 'Doon Dental' } } }),
      prisma.outreachMessage.findFirstOrThrow({ where: { lead: { name: 'Bright Smiles' } } }),
    ])
    // The unsubscribe line can't be edited out.
    await expect(outreachService.approve(admin, { messageId: doon.id, body: 'Hi Doon Dental, short and sweet with no footer at all, which is not allowed here.' })).rejects.toThrow(/unsubscribe/)
    await outreachService.approve(admin, { messageId: doon.id })
    await outreachService.reject(admin, bright.id)
    await settle()

    expect(mailer.sent).toHaveLength(1)
    const first = mailer.sent[0]!
    expect(first.mailbox).toBe(MAILBOX.email)
    expect(first.mail).toMatchObject({ to: 'doondental@clinic.example', subject: 'Bookings at Doon Dental', from: { name: 'Aditya Rawat', email: MAILBOX.email } })
    expect(first.mail.headers['List-Unsubscribe']).toMatch(/^<https?:\/\/.+\/api\/outreach\/unsubscribe\/tok_doon_dental.*>, <mailto:aditya@ayavacreatives\.com\?subject=unsubscribe>$/)
    expect(first.mail.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    expect(await prisma.lead.findFirstOrThrow({ where: { name: 'Bright Smiles' } })).toMatchObject({ outreach_status: 'STOPPED' })

    const followUp = await prisma.outreachMessage.findFirstOrThrow({ where: { lead: { name: 'Doon Dental' }, step: 2 } })
    expect(followUp.status).toBe('SCHEDULED')
    expect(followUp.scheduled_for.getTime()).toBeGreaterThan(Date.now() + 2.9 * 86_400_000)
    // Time passes: the follow-up goes out as a reply to the first email.
    await prisma.outreachMessage.update({ where: { id: followUp.id }, data: { scheduled_for: new Date(Date.now() - 1000) } })
    await settle()
    expect(mailer.sent).toHaveLength(2)
    const sentFirst = await prisma.outreachMessage.findFirstOrThrow({ where: { lead: { name: 'Doon Dental' }, step: 1 } })
    expect(mailer.sent[1]!.mail).toMatchObject({ subject: 'Re: Bookings at Doon Dental', inReplyTo: sentFirst.message_id })
  })

  it('a reply stops the emails and goes to a person; automatic replies are ignored', async () => {
    const step2 = await prisma.outreachMessage.findFirstOrThrow({ where: { lead: { name: 'Doon Dental' }, step: 2 } })
    mailer.inbox.push(
      { uid: 1, message: { from: 'doondental@clinic.example', subject: 'Automatic reply: away', headers: { 'auto-submitted': 'auto-replied' }, text: 'Away until Monday' }, refersTo: [step2.message_id!] },
      { uid: 2, message: { from: 'doondental@clinic.example', subject: 'Re: Bookings at Doon Dental', headers: {}, text: 'Yes please, call me on Monday.' }, refersTo: [step2.message_id!] },
    )
    await settle() // first check sets the starting point
    await settle()
    const doon = await prisma.lead.findFirstOrThrow({ where: { name: 'Doon Dental' }, include: { outreach_messages: true } })
    expect(doon.outreach_status).toBe('REPLIED')
    expect(doon.outreach_replied_at).not.toBeNull()
    expect(doon.outreach_messages.find((m) => m.step === 3)?.status).toBe('CANCELLED')
    const note = await prisma.notification.findFirst({ where: { user_id: admin.actor.userId, type: NOTIFICATION_TYPES.LEAD_REPLIED, related_entity_id: doon.id } })
    expect(note?.title).toBe('Doon Dental replied')
  })

  it('a bounced address and an unsubscribe are never emailed again', async () => {
    const bounced = await lead('Gone Clinic')
    const leaving = await lead('Quiet Clinic')
    await prisma.setting.update({
      where: { organization_id_key: { organization_id: AYAVA_ORGANIZATION_ID, key: 'growth' } },
      data: { value: { ...(await growthSettings.get(AYAVA_ORGANIZATION_ID)), approvalsRequired: 0 } },
    })
    mailer.rejectTo.add('goneclinic@clinic.example')
    await settle() // drafts (no approval needed any more)
    await settle() // sends
    await settle()
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: bounced.id } })).toMatchObject({ outreach_status: 'BOUNCED' })
    expect(await prisma.leadSuppression.findFirst({ where: { kind: 'EMAIL', value: 'goneclinic@clinic.example' } })).not.toBeNull()

    expect(await unsubscribeByToken(leaving.audit_token!)).toEqual({ ok: true, businessName: 'Quiet Clinic' })
    const left = await prisma.lead.findUniqueOrThrow({ where: { id: leaving.id }, include: { outreach_messages: true } })
    expect(left).toMatchObject({ outreach_status: 'UNSUBSCRIBED', status: 'DO_NOT_CONTACT' })
    expect(left.outreach_messages.every((m) => m.status === 'SENT' || m.status === 'CANCELLED')).toBe(true)
    expect(await unsubscribeByToken('not-a-valid-token-xxxxxxxx')).toEqual({ ok: false })
  })

  it('sends nothing while the domain has no SPF record', async () => {
    mailer.spf = false
    const before = mailer.sent.length
    await lead('New Clinic')
    await settle()
    await settle()
    expect(mailer.sent.length).toBe(before)
    const overview = await outreachService.overview(admin)
    expect(overview.readiness.ready).toBe(false)
    expect(overview.readiness.problems.join(' ')).toMatch(/ayavacreatives\.com has no SPF record/)
    mailer.spf = true
  })
})
