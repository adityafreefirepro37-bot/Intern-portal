/**
 * Writes one sample PDF per certificate type to docs/certificate-samples/, using
 * the same renderer as the app. Samples carry a SAMPLE watermark and a placeholder
 * number, so they can't pass as real certificates.
 *
 *   npx tsx scripts/certificate-samples.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { renderCertificatePdf, type CertificatePdfInput } from '../src/server/certificates/pdf'

const common: Omit<CertificatePdfInput, 'type'> = {
  recipientName: 'Aanya Sharma',
  programTitle: 'Web Development Intern',
  departmentName: 'Development',
  organizationName: 'Ayava Creatives',
  periodStart: new Date('2026-06-01T00:00:00Z'),
  periodEnd: new Date('2026-08-31T00:00:00Z'),
  citation: null,
  certificateNumber: 'AYV-CERT-2026-XXXX',
  issuedAt: new Date('2026-09-01T06:00:00Z'),
  signatoryName: 'Kavya Nair',
  signatoryTitle: 'Head of People, Ayava Creatives',
  verificationUrl: 'https://intern-portal-ayava.vercel.app/verify',
  watermark: 'SAMPLE',
}

const samples: [string, CertificatePdfInput][] = [
  ['completion', { ...common, type: 'COMPLETION' }],
  ['experience', { ...common, type: 'EXPERIENCE' }],
  [
    'excellence',
    { ...common, type: 'EXCELLENCE', citation: 'For leading the rebuild of the Ayava Creatives website, delivered two weeks early.' },
  ],
  ['participation', { ...common, type: 'PARTICIPATION' }],
  ['course', { ...common, type: 'COMPLETION', courseTitle: 'Brand Strategy Fundamentals', programTitle: 'Brand Strategy Fundamentals', periodStart: null }],
  // Mock-up to attach to logo-use applications (MSME / Digital India): shows where the marks would go.
  ['logo-application-mockup', { ...common, type: 'COMPLETION', partnerLogos: ['msme', 'digitalIndia'] }],
]

async function main() {
  mkdirSync('docs/certificate-samples', { recursive: true })
  for (const [name, input] of samples) {
    const bytes = await renderCertificatePdf(input)
    const file = `docs/certificate-samples/certificate-${name}-sample.pdf`
    writeFileSync(file, bytes)
    console.log(`${file} (${bytes.length} bytes)`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
