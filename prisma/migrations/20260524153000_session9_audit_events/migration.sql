CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "targetDisplay" TEXT,
    "outcome" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorSubject" TEXT,
    "actorType" TEXT,
    "actorDisplayName" TEXT,
    "actorAuthMethod" TEXT,
    "actorRoles" TEXT,
    "requestMethod" TEXT NOT NULL,
    "requestPath" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "nodeId" TEXT,
    "ipAddress" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditEvent_occurredAt_idx" ON "AuditEvent"("occurredAt");
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");
CREATE INDEX "AuditEvent_outcome_idx" ON "AuditEvent"("outcome");
CREATE INDEX "AuditEvent_actorSubject_idx" ON "AuditEvent"("actorSubject");
CREATE INDEX "AuditEvent_correlationId_idx" ON "AuditEvent"("correlationId");

