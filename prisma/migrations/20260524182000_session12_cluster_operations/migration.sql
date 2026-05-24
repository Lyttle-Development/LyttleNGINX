CREATE TABLE "ClusterOperation" (
    "id" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'cluster',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "initiatorNodeId" TEXT,
    "initiatorHostname" TEXT,
    "initiatorActorId" TEXT,
    "initiatorActorType" TEXT,
    "initiatorActorDisplayName" TEXT,
    "correlationId" TEXT,
    "requestPath" TEXT,
    "targetNodeCount" INTEGER NOT NULL DEFAULT 0,
    "completedNodeCount" INTEGER NOT NULL DEFAULT 0,
    "successfulNodeCount" INTEGER NOT NULL DEFAULT 0,
    "failedNodeCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClusterOperation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClusterOperationAck" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "nodeInstanceId" TEXT NOT NULL,
    "nodeHostname" TEXT,
    "endpointUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "responseStatus" INTEGER,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "ackedAt" TIMESTAMP(3),
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClusterOperationAck_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClusterOperation_status_createdAt_idx" ON "ClusterOperation"("status", "createdAt");
CREATE INDEX "ClusterOperation_operationType_createdAt_idx" ON "ClusterOperation"("operationType", "createdAt");
CREATE INDEX "ClusterOperation_correlationId_idx" ON "ClusterOperation"("correlationId");

CREATE UNIQUE INDEX "ClusterOperationAck_operationId_nodeInstanceId_key" ON "ClusterOperationAck"("operationId", "nodeInstanceId");
CREATE INDEX "ClusterOperationAck_status_ackedAt_idx" ON "ClusterOperationAck"("status", "ackedAt");
CREATE INDEX "ClusterOperationAck_nodeInstanceId_status_idx" ON "ClusterOperationAck"("nodeInstanceId", "status");

ALTER TABLE "ClusterOperationAck"
    ADD CONSTRAINT "ClusterOperationAck_operationId_fkey"
    FOREIGN KEY ("operationId") REFERENCES "ClusterOperation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

