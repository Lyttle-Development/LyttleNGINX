-- Track cluster nodes for monitoring and debugging
CREATE TABLE IF NOT EXISTS "public"."ClusterNode" (
    "id" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "isLeader" BOOLEAN NOT NULL DEFAULT false,
    "lastHeartbeat" TIMESTAMP(3) NOT NULL,
    "version" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClusterNode_pkey" PRIMARY KEY ("id")
);

-- Index for quick leader lookups
CREATE INDEX IF NOT EXISTS "ClusterNode_isLeader_lastHeartbeat_idx" ON "public"."ClusterNode"("isLeader", "lastHeartbeat");

-- Index for hostname lookups
CREATE INDEX IF NOT EXISTS "ClusterNode_hostname_idx" ON "public"."ClusterNode"("hostname");

-- Unique constraint on instanceId
CREATE UNIQUE INDEX IF NOT EXISTS "ClusterNode_instanceId_key" ON "public"."ClusterNode"("instanceId");

