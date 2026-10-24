-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ApplicationStatus" ADD VALUE IF NOT EXISTS 'approved';
ALTER TYPE "ApplicationStatus" ADD VALUE IF NOT EXISTS 'submitting';
ALTER TYPE "ApplicationStatus" ADD VALUE IF NOT EXISTS 'submit_uncertain';
ALTER TYPE "ApplicationStatus" ADD VALUE IF NOT EXISTS 'already_applied';

-- AlterTable
ALTER TABLE "SearchPreference" DROP COLUMN "applyDailyCap";

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "approvalHash" TEXT,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "platform" TEXT,
ADD COLUMN     "sentValues" JSONB,
ADD COLUMN     "submitError" TEXT,
ADD COLUMN     "submittedVia" TEXT;

-- CreateTable
CREATE TABLE "Platform" (
    "kind" TEXT NOT NULL,
    "sessionEnc" TEXT,
    "sessionStatus" TEXT NOT NULL DEFAULT 'disconnected',
    "accountLabel" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastTestAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "connectRequest" TEXT,
    "optInAt" TIMESTAMP(3),
    "submitCap" INTEGER NOT NULL,
    "simulateCap" INTEGER NOT NULL,
    "submitMax" INTEGER NOT NULL,
    "minIntervalSec" INTEGER NOT NULL,
    "lastActionAt" TIMESTAMP(3),
    "pausedUntil" TIMESTAMP(3),
    "pauseReason" TEXT,
    "backoffLevel" INTEGER NOT NULL DEFAULT 0,
    "consecutiveErrors" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Platform_pkey" PRIMARY KEY ("kind")
);

