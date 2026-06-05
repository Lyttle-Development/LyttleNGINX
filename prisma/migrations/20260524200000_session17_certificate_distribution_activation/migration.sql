ALTER TABLE "CertificateArtifactVersion"
    ADD COLUMN "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "distributionStatus" TEXT,
    ADD COLUMN "distributionOperationId" TEXT,
    ADD COLUMN "distributionCompletedAt" TIMESTAMP(3);

CREATE INDEX "CertificateArtifactVersion_domainsHash_isCurrent_idx"
    ON "CertificateArtifactVersion"("domainsHash", "isCurrent");

