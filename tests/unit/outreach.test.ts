import {
  AUDIT_LINK,
  classifyInbound,
  draftProblem,
  finalBody,
  followUpEmail,
  indiaTime,
  inSendWindow,
  mailboxDailyLimit,
  templateFirstEmail,
  type EmailContext,
} from '@/lib/leads/outreach'

const ctx: EmailContext = {
  businessName: 'Smile Dental',
  city: 'Dehradun',
  findings: [
    { title: 'Slow on mobile: 31/100', detail: 'Google’s speed test scores the mobile site 31/100.' },
    { title: 'No online booking', detail: 'Patients can’t book an appointment online.' },
  ],
  auditUrl: 'https://portal.example/audit/tok123',
  unsubscribeUrl: 'https://portal.example/api/outreach/unsubscribe/tok123',
  sender: { name: 'Aditya', company: 'Ayava Creatives', website: 'https://ayavacreatives.com', postalAddress: '12 Rajpur Road, Dehradun 248001' },
  auditExpiresAt: new Date('2027-02-20T00:00:00Z'),
}

const good = {
  subject: 'Bookings for Smile Dental',
  body: `Hi Smile Dental,\n\nI ran a quick check of your website. Patients can't book online, and on phones the site scores 31/100 for speed, so some of them give up before it loads.\n\nThe full audit is free and private to you: ${AUDIT_LINK}\n\nWould a 15-minute walkthrough be useful?`,
}

describe('outreach emails', () => {
  it('the template draft passes its own checks and names the findings', () => {
    const draft = templateFirstEmail(ctx)
    expect(draftProblem(draft, ctx)).toBeNull()
    expect(draft.subject).toBe('A few quick wins for Smile Dental')
    expect(draft.body).toContain('- No online booking: patients can’t book an appointment online.')
  })

  it('every email carries who is writing, the address, why and a one-click unsubscribe', () => {
    const body = finalBody(good.body, ctx)
    expect(body).toContain('https://portal.example/audit/tok123')
    expect(body).not.toContain(AUDIT_LINK)
    expect(body).toContain('Ayava Creatives · ayavacreatives.com')
    expect(body).toContain('12 Rajpur Road, Dehradun 248001')
    expect(body).toMatch(/contact details are published on its website.+https:\/\/portal\.example\/api\/outreach\/unsubscribe\/tok123$/)
  })

  it('rejects AI drafts with invented numbers, extra links, spam words or no audit link', () => {
    expect(draftProblem(good, ctx)).toBeNull()
    expect(draftProblem({ ...good, body: good.body.replace('31/100', '45/100') }, ctx)).toBe('number not in the findings (45)')
    expect(draftProblem({ ...good, body: `${good.body} See https://example.com` }, ctx)).toBe('other links')
    expect(draftProblem({ ...good, body: good.body.replace(AUDIT_LINK, 'the link below') }, ctx)).toBe('audit link missing or repeated')
    expect(draftProblem({ ...good, body: `${good.body} We guarantee results.` }, ctx)).toBe('spammy wording')
    expect(draftProblem({ ...good, subject: 'Re: your website' }, ctx)).toBe('subject pretends to be a reply')
    expect(draftProblem({ ...good, body: good.body.replace('Smile Dental', 'Doon Dental') }, ctx)).toBe('doesn’t name the business')
    expect(draftProblem({ ...good, body: `${good.body} Prices from ₹4,999.` }, ctx)).toBe('spammy wording')
  })

  it('follow-ups stay in the thread and the last one says it is the last', () => {
    const second = followUpEmail(2, ctx, 'Bookings for Smile Dental')
    expect(second.subject).toBe('Re: Bookings for Smile Dental')
    expect(second.body).toContain(AUDIT_LINK)
    expect(second.body).toContain('slow on mobile: 31/100')
    const third = followUpEmail(3, ctx, 'Bookings for Smile Dental')
    expect(third.body).toContain('It stays open until 20 February')
    expect(third.body).toContain("I won't email again.")
  })
})

describe('when to send', () => {
  it('uses India time for the sending window', () => {
    // 04:30 UTC on a Monday = 10:00 in India.
    const monday10 = new Date('2026-11-23T04:30:00Z')
    expect(indiaTime(monday10)).toEqual({ day: 1, hour: 10 })
    const window = { days: [1, 2, 3, 4, 5, 6], fromHour: 10, untilHour: 18 }
    expect(inSendWindow(monday10, window)).toBe(true)
    expect(inSendWindow(new Date('2026-11-23T04:29:00Z'), window)).toBe(false) // 09:59
    expect(inSendWindow(new Date('2026-11-23T12:30:00Z'), window)).toBe(false) // 18:00
    expect(inSendWindow(new Date('2026-11-22T06:00:00Z'), window)).toBe(false) // Sunday
  })

  it('warms a new mailbox up slowly', () => {
    const start = new Date('2026-11-01T00:00:00Z')
    expect(mailboxDailyLimit(null, start, 40)).toBe(5)
    expect(mailboxDailyLimit(start, new Date('2026-11-04T00:00:00Z'), 40)).toBe(14)
    expect(mailboxDailyLimit(start, new Date('2026-12-01T00:00:00Z'), 40)).toBe(40)
  })
})

describe('incoming mail', () => {
  const base = { from: 'owner@smiledental.example', subject: 'Re: Bookings for Smile Dental', headers: {}, text: 'Sounds good, call me tomorrow.' }
  it('tells replies from automatic replies, bounces and unsubscribe requests', () => {
    expect(classifyInbound(base)).toBe('reply')
    expect(classifyInbound({ ...base, headers: { 'auto-submitted': 'auto-replied' } })).toBe('auto_reply')
    expect(classifyInbound({ ...base, subject: 'Out of office: back Monday' })).toBe('auto_reply')
    expect(classifyInbound({ ...base, from: 'MAILER-DAEMON@mx.example', subject: 'Undelivered Mail Returned to Sender' })).toBe('bounce')
    expect(classifyInbound({ ...base, text: 'Please remove me from your list.' })).toBe('unsubscribe')
    // A quoted line with "unsubscribe" (our footer) doesn't count.
    expect(classifyInbound({ ...base, text: 'Interested!\n> unsubscribe here: https://…' })).toBe('reply')
  })
})
