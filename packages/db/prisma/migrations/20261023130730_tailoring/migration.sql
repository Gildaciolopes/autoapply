-- CreateEnum
CREATE TYPE "TailoredKind" AS ENUM ('resume', 'cover_letter');

-- CreateEnum
CREATE TYPE "TailoredStatus" AS ENUM ('queued', 'generating', 'draft', 'needs_review', 'approved', 'outdated', 'failed');

-- AlterTable
ALTER TABLE "SearchPreference" ADD COLUMN     "autoTailor" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoTailorN" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "TailoredDocument" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "kind" "TailoredKind" NOT NULL,
    "status" "TailoredStatus" NOT NULL DEFAULT 'queued',
    "lang" TEXT NOT NULL DEFAULT 'pt',
    "plan" JSONB NOT NULL DEFAULT '{}',
    "sentences" JSONB NOT NULL DEFAULT '[]',
    "validation" JSONB NOT NULL DEFAULT '{}',
    "factIds" TEXT[],
    "factsHash" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "userEdited" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TailoredDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalRun" (
    "id" TEXT NOT NULL,
    "suite" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "cases" INTEGER NOT NULL,
    "fabrications" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "report" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvalRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TailoredDocument_jobId_kind_key" ON "TailoredDocument"("jobId", "kind");

-- CreateIndex
CREATE INDEX "EvalRun_suite_createdAt_idx" ON "EvalRun"("suite", "createdAt");

-- AddForeignKey
ALTER TABLE "TailoredDocument" ADD CONSTRAINT "TailoredDocument_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
