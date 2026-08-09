-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "LlmRole" AS ENUM ('EXPLAINER', 'VERIFIER');

-- CreateEnum
CREATE TYPE "LlmCallPurpose" AS ENUM ('PRODUCTION', 'HEALTH_CHECK');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PromptVersion" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelCatalog" (
    "id" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "models" JSONB NOT NULL,

    CONSTRAINT "ModelCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelHealthCheck" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "role" "LlmRole" NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reachable" BOOLEAN NOT NULL,
    "supportsJsonSchema" BOOLEAN NOT NULL,
    "latencyMs" INTEGER,
    "spanishOk" BOOLEAN,
    "sample" TEXT,
    "error" TEXT,

    CONSTRAINT "ModelHealthCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "findingRuleId" TEXT NOT NULL,
    "findingPayload" JSONB NOT NULL,
    "explanation" TEXT,
    "suggestedFix" TEXT,
    "citedRuleIds" JSONB,
    "verifierNotes" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobEvent" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmCall" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "role" "LlmRole" NOT NULL,
    "purpose" "LlmCallPurpose" NOT NULL DEFAULT 'PRODUCTION',
    "modelId" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "PromptVersion_key_active_idx" ON "PromptVersion"("key", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PromptVersion_key_version_key" ON "PromptVersion"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ModelHealthCheck_modelId_role_key" ON "ModelHealthCheck"("modelId", "role");

-- CreateIndex
CREATE INDEX "Job_status_createdAt_idx" ON "Job"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Job_batchId_idx" ON "Job"("batchId");

-- CreateIndex
CREATE INDEX "JobEvent_jobId_idx" ON "JobEvent"("jobId");

-- CreateIndex
CREATE INDEX "LlmCall_modelId_idx" ON "LlmCall"("modelId");

-- CreateIndex
CREATE INDEX "LlmCall_createdAt_idx" ON "LlmCall"("createdAt");

-- AddForeignKey
ALTER TABLE "JobEvent" ADD CONSTRAINT "JobEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmCall" ADD CONSTRAINT "LlmCall_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written: enforce "exactly one active PromptVersion per key". Prisma's schema DSL
-- has no way to express a WHERE-qualified unique index (see the @@unique/@@index comment
-- on PromptVersion in schema.prisma) -- this is a documented, supported Prisma workflow
-- (editing a generated migration's SQL before/after it's first applied), not a hack.
CREATE UNIQUE INDEX "PromptVersion_one_active_per_key"
  ON "PromptVersion" ("key") WHERE "active" = true;
