-- Encrypt private key material at rest

ALTER TABLE "Certificate"
ADD COLUMN     "keyEncryption" JSONB;

ALTER TABLE "CertificateArtifactVersion"
ADD COLUMN     "keyEncryption" JSONB;

