import {
  certificateNumber,
  certificateWording,
  formatCertificateDate,
  formatVerificationCode,
  normalizeVerificationCode,
  withArticle,
  type CertificateText,
} from '@/lib/certificates/content'
import { pdfSafe, renderCertificatePdf } from '@/server/certificates/pdf'

const base: CertificateText = {
  type: 'COMPLETION',
  recipientName: 'Aanya Sharma',
  programTitle: 'Web Development Intern',
  departmentName: 'Development',
  organizationName: 'Ayava Creatives',
  periodStart: new Date('2026-06-01T00:00:00Z'),
  periodEnd: new Date('2026-08-31T00:00:00Z'),
  citation: null,
}

describe('certificate wording', () => {
  it('describes an internship completion with role, team and period', () => {
    const w = certificateWording(base)
    expect(w.heading).toBe('Certificate of Completion')
    expect(w.body).toBe(
      'has successfully completed an internship as a Web Development Intern in the Development team at Ayava Creatives from 1 June 2026 to 31 August 2026.',
    )
  })

  it('has wording for every type and for courses', () => {
    expect(certificateWording({ ...base, type: 'EXPERIENCE' }).heading).toBe('Experience Certificate')
    expect(certificateWording({ ...base, type: 'EXCELLENCE' }).lead).toBe('This certificate is proudly presented to')
    expect(certificateWording({ ...base, type: 'PARTICIPATION' }).body).toContain('participated in the internship programme')
    const course = certificateWording({ ...base, courseTitle: 'Brand Basics' })
    expect(course.body).toBe('has successfully completed the course “Brand Basics” at Ayava Creatives on 31 August 2026.')
  })

  it('leaves out what is unknown', () => {
    const w = certificateWording({ ...base, programTitle: null, departmentName: null, periodStart: null, periodEnd: null })
    expect(w.body).toBe('has successfully completed an internship at Ayava Creatives.')
  })

  it('uses the right article and date format', () => {
    expect(withArticle('Engineering Intern')).toBe('an Engineering Intern')
    expect(withArticle('Design Intern')).toBe('a Design Intern')
    expect(formatCertificateDate(new Date('2026-01-05T00:00:00Z'))).toBe('5 January 2026')
  })
})

describe('certificate identifiers', () => {
  it('numbers certificates per year', () => {
    expect(certificateNumber(2026, 7)).toBe('AYV-CERT-2026-0007')
    expect(certificateNumber(2027, 12345)).toBe('AYV-CERT-2027-12345')
  })

  it('formats and normalizes verification codes without ambiguous characters', () => {
    const code = formatVerificationCode(new Uint8Array(Array.from({ length: 12 }, (_, i) => i * 37)))
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(code).not.toMatch(/[01OIL]/)
    expect(normalizeVerificationCode(code.toLowerCase().replace(/-/g, ' '))).toBe(code)
    expect(normalizeVerificationCode('ABCD-EFGH-JK')).toBeNull()
    expect(normalizeVerificationCode('ABCD-EFGH-JK0O')).toBeNull()
  })
})

describe('certificate PDF', () => {
  const input = {
    ...base,
    certificateNumber: 'AYV-CERT-2026-0001',
    issuedAt: new Date('2026-09-01T06:00:00Z'),
    signatoryName: 'Kavya Nair',
    signatoryTitle: 'Head of People',
    verificationUrl: 'https://portal.example.com/verify/7KQP-M4XZ-9TRB',
  }

  it('renders a one-page PDF, identically every time', async () => {
    const a = await renderCertificatePdf(input)
    const b = await renderCertificatePdf(input)
    expect(Buffer.from(a.subarray(0, 5)).toString()).toBe('%PDF-')
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
    expect(Buffer.from(a).toString('latin1')).toContain('/Count 1')
  })

  it('handles names outside the standard PDF fonts and drafts', async () => {
    expect(pdfSafe('Zoë Ångström')).toBe('Zoë Ångström'.normalize('NFKD').replace(/[̀-ͯ]/g, ''))
    expect(pdfSafe('आन्या')).toMatch(/^\?+$/)
    await expect(
      renderCertificatePdf({ ...input, recipientName: 'आन्या शर्मा', verificationUrl: null, watermark: 'DRAFT', issuedAt: null }),
    ).resolves.toBeInstanceOf(Uint8Array)
  })
})
