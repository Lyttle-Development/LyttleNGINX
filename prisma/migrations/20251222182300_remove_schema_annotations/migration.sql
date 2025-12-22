-- Fix for "FATAL: unsupported startup parameter: search_path" error
-- This migration removes the schema annotations that were causing the issue
-- The tables remain in the public schema by default

-- No actual schema changes needed - the tables already exist in public schema
-- This is just a compatibility fix for the Prisma client generation

-- Verify all tables exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ProxyEntry') THEN
    RAISE EXCEPTION 'ProxyEntry table not found in public schema';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Certificate') THEN
    RAISE EXCEPTION 'Certificate table not found in public schema';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ClusterNode') THEN
    RAISE EXCEPTION 'ClusterNode table not found in public schema';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'AcmeChallenge') THEN
    RAISE EXCEPTION 'AcmeChallenge table not found in public schema';
  END IF;
END $$;

-- All tables exist, no migration needed

