CREATE TABLE "ClusterLease" (
    "id" TEXT NOT NULL,
    "leaseName" TEXT NOT NULL,
    "ownerNodeId" TEXT,
    "ownerHostname" TEXT,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "ttlSeconds" INTEGER NOT NULL DEFAULT 30,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClusterLease_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClusterLease_leaseName_key" ON "ClusterLease"("leaseName");
CREATE INDEX "ClusterLease_ownerNodeId_idx" ON "ClusterLease"("ownerNodeId");
CREATE INDEX "ClusterLease_expiresAt_idx" ON "ClusterLease"("expiresAt");
CREATE INDEX "ClusterLease_ownerNodeId_expiresAt_idx" ON "ClusterLease"("ownerNodeId", "expiresAt");

