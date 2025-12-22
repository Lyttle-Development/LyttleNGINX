/*
  Minimal safe migration: add operational columns and non-unique indexes only.
  Deduplication and unique index creation are deferred.
*/

-- Add new columns with sensible defaults where appropriate
ALTER TABLE "public"."Certificate"
  ADD COLUMN IF NOT EXISTS "failureCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "failureReason" TEXT,
  ADD COLUMN IF NOT EXISTS "issuedByNode" TEXT,
  ADD COLUMN IF NOT EXISTS "retryAfter" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';

-- Create non-unique indexes to speed lookups (safe)
CREATE INDEX IF NOT EXISTS "Certificate_domainsHash_idx" ON "public"."Certificate"("domainsHash");
CREATE INDEX IF NOT EXISTS "Certificate_retryAfter_idx" ON "public"."Certificate"("retryAfter");
