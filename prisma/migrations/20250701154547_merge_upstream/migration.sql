-- CreateTable
CREATE TABLE "public"."Certificate" (
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

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);
