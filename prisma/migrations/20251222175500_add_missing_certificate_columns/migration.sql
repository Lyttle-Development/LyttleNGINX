-- Add missing columns to Certificate table (safe: uses IF NOT EXISTS pattern)
DO $$
BEGIN
  -- Add failureCount column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'Certificate'
    AND column_name = 'failureCount'
  ) THEN
    ALTER TABLE "public"."Certificate" ADD COLUMN "failureCount" INTEGER NOT NULL DEFAULT 0;
  END IF;

  -- Add failureReason column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'Certificate'
    AND column_name = 'failureReason'
  ) THEN
    ALTER TABLE "public"."Certificate" ADD COLUMN "failureReason" TEXT;
  END IF;

  -- Add issuedByNode column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'Certificate'
    AND column_name = 'issuedByNode'
  ) THEN
    ALTER TABLE "public"."Certificate" ADD COLUMN "issuedByNode" TEXT;
  END IF;

  -- Add retryAfter column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'Certificate'
    AND column_name = 'retryAfter'
  ) THEN
    ALTER TABLE "public"."Certificate" ADD COLUMN "retryAfter" TIMESTAMP(3);
  END IF;

  -- Add status column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'Certificate'
    AND column_name = 'status'
  ) THEN
    ALTER TABLE "public"."Certificate" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
  END IF;
END
$$;

-- Create non-unique index on domainsHash (safe, can be created even with duplicates)
CREATE INDEX IF NOT EXISTS "Certificate_domainsHash_idx" ON "public"."Certificate"("domainsHash");

-- Create index on retryAfter
CREATE INDEX IF NOT EXISTS "Certificate_retryAfter_idx" ON "public"."Certificate"("retryAfter");

-- Create unique index on domainsHash (only if no duplicates exist)
-- First check if there are duplicates
DO $$
DECLARE
  duplicate_count INTEGER;
BEGIN
  -- Count duplicate domainsHash values
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT "domainsHash", COUNT(*) as cnt
    FROM "public"."Certificate"
    GROUP BY "domainsHash"
    HAVING COUNT(*) > 1
  ) duplicates;

  -- Only create unique index if no duplicates exist
  IF duplicate_count = 0 THEN
    -- Check if index already exists
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
      AND tablename = 'Certificate'
      AND indexname = 'Certificate_domainsHash_key'
    ) THEN
      CREATE UNIQUE INDEX "Certificate_domainsHash_key" ON "public"."Certificate"("domainsHash");
    END IF;
  ELSE
    RAISE NOTICE 'Skipping unique index creation: % duplicate domainsHash values found. Please deduplicate first.', duplicate_count;
  END IF;
END
$$;

