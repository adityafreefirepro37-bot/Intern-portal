-- Certificates: the signatory's signature image (private storage key), frozen with each draft.
ALTER TABLE "certificates" ADD COLUMN "signature_path" TEXT;
