# Certificates (Phase 09, part 1)

Completion, experience, excellence and participation certificates for interns,
automatic course certificates, PDF download and public verification.

## Lifecycle

1. **Prepare** (`certificate.create`): HR picks an intern and a type — from
   **Certificates → New certificate**, **Ready to issue**, the intern's
   **Certificates** tab, or **Offboarding → Prepare**. The draft is filled from the
   intern's record: name, role (position or internship title), team, internship
   dates, the organization name, and the default signatory from settings.
2. **Check and edit**: every printed field can be edited on the draft; the page
   shows a live preview and a draft PDF (watermarked DRAFT). Interns never see drafts.
3. **Issue**: assigns the permanent number `AYV-CERT-<year>-<sequence>` (a
   per-organization counter, `code_counters`) and a random verification code
   (`XXXX-XXXX-XXXX`, no ambiguous characters). The text is frozen from then on.
   The intern is notified (in the app; by email if they opted in).
4. **Revoke** (`certificate.revoke`): requires a reason (kept in the audit trail,
   not shown publicly). The verification page then says the certificate was
   revoked, and only HR can still download the (watermarked) PDF. To correct a
   certificate, revoke it and issue a new one.

Drafts can be deleted; issued and revoked certificates are kept forever.

## Course certificates

When an intern completes a course (`learning.course_completed`), a course
certificate of completion is issued automatically — one live certificate per
intern and course (a partial unique index enforces it). Turn this off under
**Certificates → Settings**. Staff completing courses don't get certificates.

## The PDF

Rendered on demand from the frozen columns (`src/server/certificates/pdf.ts`,
pdf-lib): A4 landscape, double frame, organization mark, heading, recipient,
wording per type (`src/lib/certificates/content.ts`), optional citation,
signatory, issue date, certificate number and a QR code linking to the
verification page. Rendering is deterministic (fixed metadata dates), so every
download of the same certificate is byte-identical. The standard PDF fonts cover
Latin-1 only: other scripts are replaced (names should be entered in Latin
script on the draft).

`GET /api/certificates/:id/pdf` (`?inline=1` to view in the browser) follows the
same access rules as the certificate page.

## Samples

`docs/certificate-samples/` has a PDF and a PNG preview for each type (completion, experience,
excellence, participation, course), watermarked SAMPLE with a placeholder number. Rebuild them after
design changes with `npx tsx scripts/certificate-samples.ts`.

## Public verification — `/verify` and `/verify/:code`

No sign-in. Shows valid / revoked / not found plus only what the certificate
itself states (recipient, type, role, team, organization, period, issue date,
number) — never contact details, citations or reasons. Rate-limited per IP
(`certificateVerify`: 40 per 10 minutes) and counted (`verification_count`,
`last_verified_at`, shown to HR). Pages are marked `noindex`.

The QR code and links use `NEXT_PUBLIC_APP_URL`, so it must be the public
address of the portal in production.

## Access

| Permission | Who (defaults) | Allows |
| --- | --- | --- |
| `certificate.read` | HR, admins (organization); interns (own) | Lists and pages; interns see only their issued/revoked certificates |
| `certificate.create` | HR, admins | Prepare, edit, delete drafts, issue, settings |
| `certificate.revoke` | HR, admins | Revoke; download revoked PDFs |

Everything is audited: `certificate.draft_saved`, `certificate.draft_deleted`,
`certificate.issued` (automatic ones with no actor), `certificate.revoked`,
`certificate.settings_updated`.

## Data

Migration `20261116090000_certificates` adds the frozen text columns, course
link, creator / issuer / revoker, revocation reason, the partial unique index for
course certificates, and enables row-level security on `certificates` and
`certificate_verifications`.

## Not included

Uploaded signature images or logos on the PDF, custom certificate templates per
organization, bulk issuing, and certificates for non-intern staff.
