CREATE TABLE "CertificateOrder" (
    "id" TEXT NOT NULL,
    "domains" TEXT NOT NULL,
    "domainsHash" TEXT NOT NULL,
    "primaryDomain" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'acme',
    "status" TEXT NOT NULL DEFAULT 'requested',
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "requestedByNode" TEXT,
    "certificateId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "challengePublishedAt" TIMESTAMP(3),
    "validatingAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "distributingAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CertificateOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CertificateOrderEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "message" TEXT,
    "attemptNumber" INTEGER,
    "retryAt" TIMESTAMP(3),
    "details" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CertificateOrderEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CertificateArtifactVersion" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "certificateId" TEXT,
    "domains" TEXT NOT NULL,
    "domainsHash" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'acme',
    "certPem" TEXT NOT NULL,
    "keyPem" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "createdByNode" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CertificateArtifactVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CertificateOrder_domainsHash_createdAt_idx" ON "CertificateOrder"("domainsHash", "createdAt");
CREATE INDEX "CertificateOrder_status_nextRetryAt_idx" ON "CertificateOrder"("status", "nextRetryAt");
CREATE INDEX "CertificateOrder_certificateId_idx" ON "CertificateOrder"("certificateId");

CREATE INDEX "CertificateOrderEvent_orderId_occurredAt_idx" ON "CertificateOrderEvent"("orderId", "occurredAt");
CREATE INDEX "CertificateOrderEvent_toStatus_occurredAt_idx" ON "CertificateOrderEvent"("toStatus", "occurredAt");

CREATE UNIQUE INDEX "CertificateArtifactVersion_domainsHash_version_key" ON "CertificateArtifactVersion"("domainsHash", "version");
CREATE INDEX "CertificateArtifactVersion_orderId_idx" ON "CertificateArtifactVersion"("orderId");
CREATE INDEX "CertificateArtifactVersion_certificateId_createdAt_idx" ON "CertificateArtifactVersion"("certificateId", "createdAt");
CREATE INDEX "CertificateArtifactVersion_domainsHash_createdAt_idx" ON "CertificateArtifactVersion"("domainsHash", "createdAt");

ALTER TABLE "CertificateOrder"
    ADD CONSTRAINT "CertificateOrder_certificateId_fkey"
    FOREIGN KEY ("certificateId") REFERENCES "Certificate"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CertificateOrderEvent"
    ADD CONSTRAINT "CertificateOrderEvent_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "CertificateOrder"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CertificateArtifactVersion"
    ADD CONSTRAINT "CertificateArtifactVersion_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "CertificateOrder"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CertificateArtifactVersion"
    ADD CONSTRAINT "CertificateArtifactVersion_certificateId_fkey"
    FOREIGN KEY ("certificateId") REFERENCES "Certificate"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

