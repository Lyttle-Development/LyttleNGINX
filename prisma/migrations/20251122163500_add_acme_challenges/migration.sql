-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."AcmeChallenge" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "keyAuth" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcmeChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AcmeChallenge_token_key" ON "public"."AcmeChallenge"("token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AcmeChallenge_token_idx" ON "public"."AcmeChallenge"("token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AcmeChallenge_domain_idx" ON "public"."AcmeChallenge"("domain");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AcmeChallenge_expiresAt_idx" ON "public"."AcmeChallenge"("expiresAt");

