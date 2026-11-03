-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('DRAFT', 'PLANNING', 'FLAGGED', 'READY', 'APPROVED', 'APPLYING', 'RECONCILED', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "Payee" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "country" TEXT,
    "destinationValue" TEXT NOT NULL,
    "destinationFingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "destinationChangedAt" TIMESTAMP(3),
    "sandboxRemap" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Payee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricalPayout" (
    "id" TEXT NOT NULL,
    "payeeId" TEXT NOT NULL,
    "destinationFingerprint" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "batchRef" TEXT NOT NULL,

    CONSTRAINT "HistoricalPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutRun" (
    "id" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'DRAFT',
    "preparedById" TEXT NOT NULL,
    "cycleDate" TIMESTAMP(3) NOT NULL,
    "sourceFilename" TEXT NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "currentPlanHash" TEXT,
    "payeeMasterVersion" INTEGER NOT NULL,
    "reconciliationOutcome" TEXT,
    "lastError" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PayoutRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanRevision" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "parentHash" TEXT,
    "planJson" JSONB NOT NULL,
    "analysisHash" TEXT,
    "analysisJson" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flag" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "planHash" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "blocking" BOOLEAN NOT NULL,
    "evidence" JSONB NOT NULL,
    "rationale" JSONB,

    CONSTRAINT "Flag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Disposition" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Disposition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "planHash" TEXT NOT NULL,
    "analysisHash" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppliedPlan" (
    "planHash" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppliedPlan_pkey" PRIMARY KEY ("planHash")
);

-- CreateTable
CREATE TABLE "ApplyAttempt" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "planHash" TEXT NOT NULL,
    "senderBatchId" TEXT NOT NULL,
    "requestBody" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "paypalBatchId" TEXT,
    "httpStatus" INTEGER,
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplyAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "senderItemId" TEXT NOT NULL,
    "paypalItemId" TEXT,
    "status" TEXT NOT NULL,
    "payeeId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "receiverActual" TEXT NOT NULL,
    "lastEventAt" TIMESTAMP(3),
    "source" TEXT,

    CONSTRAINT "PayoutItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "resourceId" TEXT,
    "verified" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "seq" BIGSERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "runId" TEXT,
    "data" JSONB NOT NULL,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "AnalysisCache" (
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisCache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "Payee_destinationFingerprint_idx" ON "Payee"("destinationFingerprint");

-- CreateIndex
CREATE INDEX "HistoricalPayout_payeeId_paidAt_idx" ON "HistoricalPayout"("payeeId", "paidAt");

-- CreateIndex
CREATE INDEX "PayoutRun_sourceSha256_idx" ON "PayoutRun"("sourceSha256");

-- CreateIndex
CREATE INDEX "PlanRevision_hash_idx" ON "PlanRevision"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "PlanRevision_runId_hash_key" ON "PlanRevision"("runId", "hash");

-- CreateIndex
CREATE UNIQUE INDEX "Flag_runId_planHash_lineId_ruleId_key" ON "Flag"("runId", "planHash", "lineId", "ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "Disposition_runId_lineId_ruleId_key" ON "Disposition"("runId", "lineId", "ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_runId_key" ON "Approval"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "AppliedPlan_runId_key" ON "AppliedPlan"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplyAttempt_runId_key" ON "ApplyAttempt"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplyAttempt_senderBatchId_key" ON "ApplyAttempt"("senderBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutItem_senderItemId_key" ON "PayoutItem"("senderItemId");

-- CreateIndex
CREATE INDEX "PayoutItem_runId_idx" ON "PayoutItem"("runId");

-- CreateIndex
CREATE INDEX "PayoutItem_payeeId_idx" ON "PayoutItem"("payeeId");
