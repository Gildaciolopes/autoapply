-- CreateEnum
CREATE TYPE "MailStatus" AS ENUM ('disconnected', 'connected', 'expired');

-- CreateEnum
CREATE TYPE "ReplyOrigin" AS ENUM ('email', 'manual');

-- CreateEnum
CREATE TYPE "ReplyType" AS ENUM ('interview', 'rejection', 'info_request', 'confirmation', 'other');

-- CreateEnum
CREATE TYPE "ReplyOutcome" AS ENUM ('none', 'replied', 'interview', 'declined');

-- AlterTable
ALTER TABLE "SearchPreference" ADD COLUMN     "mcpApproveEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "firstReplyAt" TIMESTAMP(3),
ADD COLUMN     "interviewAt" TIMESTAMP(3),
ADD COLUMN     "lastReplyAt" TIMESTAMP(3),
ADD COLUMN     "outcome" "ReplyOutcome" NOT NULL DEFAULT 'none',
ADD COLUMN     "preparedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MailAccount" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "email" TEXT,
    "status" "MailStatus" NOT NULL DEFAULT 'disconnected',
    "tokensEnc" TEXT,
    "pendingState" JSONB,
    "connectedAt" TIMESTAMP(3),
    "lastCheckAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedMail" (
    "messageId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedMail_pkey" PRIMARY KEY ("messageId")
);

-- CreateTable
CREATE TABLE "Reply" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "origin" "ReplyOrigin" NOT NULL,
    "messageId" TEXT,
    "type" "ReplyType" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "userEdited" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "sender" TEXT,
    "subject" TEXT,
    "excerpt" TEXT,
    "note" TEXT,
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalPreview" (
    "id" TEXT NOT NULL,
    "mcpSessionId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalPreview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcessedMail_at_idx" ON "ProcessedMail"("at");

-- CreateIndex
CREATE UNIQUE INDEX "Reply_messageId_key" ON "Reply"("messageId");

-- CreateIndex
CREATE INDEX "Reply_applicationId_receivedAt_idx" ON "Reply"("applicationId", "receivedAt");

-- CreateIndex
CREATE INDEX "Job_firstSeenAt_idx" ON "Job"("firstSeenAt");

-- CreateIndex
CREATE INDEX "Application_outcome_idx" ON "Application"("outcome");

-- AddForeignKey
ALTER TABLE "Reply" ADD CONSTRAINT "Reply_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: funnel stage "prepared" for applications already past preparation (research R1)
UPDATE "Application" SET "preparedAt" = COALESCE("lastRunAt", "updatedAt")
WHERE "status" IN ('ready', 'needs_input', 'approved', 'submitting', 'submitted', 'submit_uncertain', 'already_applied', 'rejected');
