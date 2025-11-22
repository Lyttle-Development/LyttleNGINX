-- Add ipAddress column to ClusterNode table
ALTER TABLE "public"."ClusterNode"
    ADD COLUMN "ipAddress" TEXT;

-- Create index on ipAddress for faster lookups
CREATE INDEX "ClusterNode_ipAddress_idx" ON "public"."ClusterNode" ("ipAddress");

