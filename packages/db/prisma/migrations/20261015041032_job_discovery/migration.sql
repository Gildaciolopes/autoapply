/*
  Warnings:

  - Added the required column `updatedAt` to the `JobScore` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "DiscoveryTrigger" AS ENUM ('manual', 'schedule', 'rescore');

-- CreateEnum
CREATE TYPE "DiscoveryStatus" AS ENUM ('running', 'done', 'failed');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SourceType" ADD VALUE 'indeed';
ALTER TYPE "SourceType" ADD VALUE 'glassdoor';
ALTER TYPE "SourceType" ADD VALUE 'google_jobs';

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "city" TEXT,
ADD COLUMN     "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "hidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "interesting" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "remote" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "salaryText" TEXT,
ADD COLUMN     "seniority" TEXT,
ADD COLUMN     "uf" TEXT;

-- AlterTable
ALTER TABLE "JobScore" ADD COLUMN     "demoted" TEXT[],
ADD COLUMN     "filterReason" TEXT,
ADD COLUMN     "judged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "matchedEvidence" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "passed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "profileHash" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "similarity" DOUBLE PRECISION,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "SearchPreference" ADD COLUMN     "autoDiscover" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "discoveryCron" TEXT NOT NULL DEFAULT '0 7 * * *',
ADD COLUMN     "judgeTopN" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "minSalaryContract" TEXT;

-- AlterTable
ALTER TABLE "Source" ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastStatus" TEXT;

-- CreateTable
CREATE TABLE "JobOrigin" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "source" "SourceType" NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runId" TEXT,

    CONSTRAINT "JobOrigin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryRun" (
    "id" TEXT NOT NULL,
    "trigger" "DiscoveryTrigger" NOT NULL,
    "localDate" TEXT NOT NULL,
    "status" "DiscoveryStatus" NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "outcomes" JSONB NOT NULL DEFAULT '{}',
    "judged" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DiscoveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileVector" (
    "hash" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "embedding" vector(1024),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileVector_pkey" PRIMARY KEY ("hash")
);

-- CreateIndex
CREATE INDEX "JobOrigin_source_firstSeenAt_idx" ON "JobOrigin"("source", "firstSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobOrigin_source_externalId_key" ON "JobOrigin"("source", "externalId");

-- CreateIndex
CREATE INDEX "DiscoveryRun_trigger_localDate_idx" ON "DiscoveryRun"("trigger", "localDate");

-- AddForeignKey
ALTER TABLE "JobOrigin" ADD CONSTRAINT "JobOrigin_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
