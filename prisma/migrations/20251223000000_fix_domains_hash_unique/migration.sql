-- Fix the unique constraint on domainsHash
-- The previous migration created a unique index but Prisma requires a proper unique constraint for upsert operations

-- Drop the existing unique index if it exists
DROP INDEX IF EXISTS "Certificate_domainsHash_key";

-- Add a proper unique constraint on domainsHash
-- This will handle conflicts properly during upsert operations
DO $$
BEGIN
  -- Check if constraint already exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Certificate_domainsHash_key'
    AND contype = 'u'
    AND conrelid = 'Certificate'::regclass
  ) THEN
    -- Remove any duplicate records first (keep the most recent one)
    DELETE FROM "Certificate"
    WHERE "id" IN (
      SELECT c1."id"
      FROM "Certificate" c1
      INNER JOIN (
        SELECT "domainsHash", MAX("updatedAt") as max_updated
        FROM "Certificate"
        GROUP BY "domainsHash"
        HAVING COUNT(*) > 1
      ) c2 ON c1."domainsHash" = c2."domainsHash" AND c1."updatedAt" < c2.max_updated
    );

    -- Now add the proper unique constraint
    ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_domainsHash_key" UNIQUE ("domainsHash");
    RAISE NOTICE 'Created unique constraint on domainsHash.';
  ELSE
    RAISE NOTICE 'Unique constraint already exists.';
  END IF;
END $$;

