-- CreateEnum
CREATE TYPE "ProxyType" AS ENUM ('REDIRECT', 'PROXY');

-- CreateTable
CREATE TABLE "ProxyEntry" (
    "id" SERIAL NOT NULL,
    "proxy_pass_host" TEXT NOT NULL,
    "domains" TEXT NOT NULL,
    "nginx_custom_code" TEXT,
    "type" "ProxyType" NOT NULL DEFAULT 'PROXY',
    "ssl" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProxyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "domains" TEXT NOT NULL,
    "domainsHash" TEXT NOT NULL,
    "certPem" TEXT NOT NULL,
    "keyPem" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL,
    "isOrphaned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "failureReason" TEXT,
    "retryAfter" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "issuedByNode" TEXT,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClusterNode" (
    "id" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "isLeader" BOOLEAN NOT NULL DEFAULT false,
    "lastHeartbeat" TIMESTAMP(3) NOT NULL,
    "version" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClusterNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcmeChallenge" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "keyAuth" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcmeChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Certificate_domainsHash_idx" ON "Certificate"("domainsHash");

-- CreateIndex
CREATE INDEX "Certificate_retryAfter_idx" ON "Certificate"("retryAfter");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_domainsHash_key" ON "Certificate"("domainsHash");

-- CreateIndex
CREATE UNIQUE INDEX "ClusterNode_instanceId_key" ON "ClusterNode"("instanceId");

-- CreateIndex
CREATE INDEX "ClusterNode_isLeader_lastHeartbeat_idx" ON "ClusterNode"("isLeader", "lastHeartbeat");

-- CreateIndex
CREATE INDEX "ClusterNode_hostname_idx" ON "ClusterNode"("hostname");

-- CreateIndex
CREATE INDEX "ClusterNode_ipAddress_idx" ON "ClusterNode"("ipAddress");

-- CreateIndex
CREATE UNIQUE INDEX "AcmeChallenge_token_key" ON "AcmeChallenge"("token");

-- CreateIndex
CREATE INDEX "AcmeChallenge_token_idx" ON "AcmeChallenge"("token");

-- CreateIndex
CREATE INDEX "AcmeChallenge_domain_idx" ON "AcmeChallenge"("domain");

-- CreateIndex
CREATE INDEX "AcmeChallenge_expiresAt_idx" ON "AcmeChallenge"("expiresAt");
