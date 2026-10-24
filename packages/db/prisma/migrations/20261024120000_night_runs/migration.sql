-- CreateEnum
CREATE TYPE "NightTrigger" AS ENUM ('schedule', 'manual');

-- CreateEnum
CREATE TYPE "NightStatus" AS ENUM ('running', 'ok', 'partial', 'failed', 'stopped', 'skipped', 'missed');

-- CreateEnum
CREATE TYPE "NightPhase" AS ENUM ('discovering', 'preparing', 'waiting', 'finishing', 'done');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('pending', 'sent', 'not_sent', 'not_configured');

-- AlterEnum
ALTER TYPE "ApplicationStatus" ADD VALUE IF NOT EXISTS 'rejected';

-- AlterTable
ALTER TABLE "AnswerMemory" ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastUsedAt" TIMESTAMP(3),
ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'needs_input';

-- AlterTable
ALTER TABLE "SearchPreference" DROP COLUMN "scheduleCron",
ADD COLUMN     "nightBudget" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "nightDays" INTEGER[] DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[],
ADD COLUMN     "nightEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nightEnd" TEXT NOT NULL DEFAULT '06:59',
ADD COLUMN     "nightLastTickAt" TIMESTAMP(3),
ADD COLUMN     "nightStart" TEXT NOT NULL DEFAULT '23:00',
ADD COLUMN     "pausedAt" TIMESTAMP(3),
ADD COLUMN     "telegramOffset" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "nightRunId" TEXT,
ADD COLUMN     "rejectReason" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RunEvent" ADD COLUMN     "nightRunId" TEXT,
ADD COLUMN     "seq" SERIAL NOT NULL;

-- CreateTable
CREATE TABLE "NightRun" (
    "id" TEXT NOT NULL,
    "trigger" "NightTrigger" NOT NULL,
    "scheduleKey" TEXT,
    "nightDate" TEXT NOT NULL,
    "status" "NightStatus" NOT NULL DEFAULT 'running',
    "phase" "NightPhase" NOT NULL DEFAULT 'discovering',
    "windowEnd" TIMESTAMP(3),
    "budget" INTEGER NOT NULL,
    "discoveryRunId" TEXT,
    "stepErrors" JSONB NOT NULL DEFAULT '[]',
    "counters" JSONB NOT NULL DEFAULT '{}',
    "pending" JSONB NOT NULL DEFAULT '[]',
    "report" JSONB,
    "reportStatus" "ReportStatus" NOT NULL DEFAULT 'pending',
    "reportError" TEXT,
    "reportSentAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "NightRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NightRun_scheduleKey_key" ON "NightRun"("scheduleKey");

-- CreateIndex
CREATE INDEX "NightRun_status_idx" ON "NightRun"("status");

-- CreateIndex
CREATE INDEX "NightRun_startedAt_idx" ON "NightRun"("startedAt");

-- CreateIndex
CREATE INDEX "Application_nightRunId_idx" ON "Application"("nightRunId");

-- CreateIndex
CREATE UNIQUE INDEX "RunEvent_seq_key" ON "RunEvent"("seq");

-- CreateIndex
CREATE INDEX "RunEvent_nightRunId_seq_idx" ON "RunEvent"("nightRunId", "seq");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_nightRunId_fkey" FOREIGN KEY ("nightRunId") REFERENCES "NightRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunEvent" ADD CONSTRAINT "RunEvent_nightRunId_fkey" FOREIGN KEY ("nightRunId") REFERENCES "NightRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

