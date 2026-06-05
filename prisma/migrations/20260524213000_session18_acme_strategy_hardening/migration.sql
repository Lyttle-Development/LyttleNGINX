-- Harden the ACME strategy for clustered production

ALTER TABLE "AcmeChallenge"
ADD COLUMN     "orderId" TEXT,
ADD COLUMN     "challengeType" TEXT NOT NULL DEFAULT 'http-01',
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'presented',
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "presentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "cleanedUpAt" TIMESTAMP(3),
ADD COLUMN     "finalizedAt" TIMESTAMP(3),
ADD COLUMN     "lastServedAt" TIMESTAMP(3);

UPDATE "AcmeChallenge"
SET "presentedAt" = COALESCE("createdAt", CURRENT_TIMESTAMP),
    "status" = COALESCE(NULLIF("status", ''), 'presented'),
    "challengeType" = COALESCE(NULLIF("challengeType", ''), 'http-01');

CREATE INDEX "AcmeChallenge_orderId_createdAt_idx" ON "AcmeChallenge"("orderId", "createdAt");
CREATE INDEX "AcmeChallenge_status_expiresAt_idx" ON "AcmeChallenge"("status", "expiresAt");

