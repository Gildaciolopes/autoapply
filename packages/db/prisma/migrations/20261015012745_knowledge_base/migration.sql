/*
  Warnings:

  - You are about to drop the column `confidence` on the `Fact` table. All the data in the column will be lost.
  - You are about to drop the column `conflict` on the `Fact` table. All the data in the column will be lost.
  - You are about to drop the column `sources` on the `Fact` table. All the data in the column will be lost.
  - Added the required column `fileName` to the `ResumeBase` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ResumeStatus" AS ENUM ('uploaded', 'parsing', 'image_only', 'failed', 'review', 'confirmed', 'discarded');

-- CreateEnum
CREATE TYPE "ResumeExtraction" AS ENUM ('text', 'vision', 'manual');

-- CreateEnum
CREATE TYPE "FactStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "FactOrigin" AS ENUM ('resume', 'linkedin', 'github', 'user');

-- CreateEnum
CREATE TYPE "RevisionAction" AS ENUM ('created', 'edited', 'verified', 'unverified', 'archived', 'restored', 'conflict_resolved', 'source_added');

-- CreateEnum
CREATE TYPE "RevisionActor" AS ENUM ('user', 'import', 'sync');

-- CreateEnum
CREATE TYPE "ConflictType" AS ENUM ('value_mismatch', 'possible_duplicate');

-- CreateEnum
CREATE TYPE "ConflictStatus" AS ENUM ('open', 'resolved');

-- CreateEnum
CREATE TYPE "SyncOutcome" AS ENUM ('success', 'partial', 'failed');

-- CreateEnum
CREATE TYPE "SyncTrigger" AS ENUM ('schedule', 'manual', 'import');

-- AlterTable
ALTER TABLE "Fact" DROP COLUMN "confidence",
DROP COLUMN "conflict",
DROP COLUMN "sources",
ADD COLUMN     "hasOpenConflict" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "missingFrom" TEXT[],
ADD COLUMN     "status" "FactStatus" NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "headline" TEXT,
ADD COLUMN     "summary" TEXT;

-- AlterTable
ALTER TABLE "ResumeBase" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "error" TEXT,
ADD COLUMN     "extraction" "ResumeExtraction" NOT NULL DEFAULT 'text',
ADD COLUMN     "fileName" TEXT NOT NULL,
ADD COLUMN     "rawText" TEXT,
ADD COLUMN     "status" "ResumeStatus" NOT NULL DEFAULT 'uploaded',
ALTER COLUMN "parsed" DROP NOT NULL,
ALTER COLUMN "active" SET DEFAULT false;

-- CreateTable
CREATE TABLE "FactSource" (
    "id" TEXT NOT NULL,
    "factId" TEXT NOT NULL,
    "origin" "FactOrigin" NOT NULL,
    "ref" TEXT NOT NULL,
    "rawValue" JSONB NOT NULL,
    "snippet" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactRevision" (
    "id" TEXT NOT NULL,
    "factId" TEXT NOT NULL,
    "action" "RevisionAction" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "actor" "RevisionActor" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactConflict" (
    "id" TEXT NOT NULL,
    "factId" TEXT NOT NULL,
    "type" "ConflictType" NOT NULL,
    "candidates" JSONB NOT NULL,
    "otherFactId" TEXT,
    "status" "ConflictStatus" NOT NULL DEFAULT 'open',
    "resolution" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "FactConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileSource" (
    "origin" "FactOrigin" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "account" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastStatus" "SyncOutcome",
    "lastError" TEXT,
    "resumeAt" TIMESTAMP(3),
    "snapshot" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileSource_pkey" PRIMARY KEY ("origin")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "trigger" "SyncTrigger" NOT NULL,
    "localDate" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "outcomes" JSONB NOT NULL DEFAULT '{}',
    "summary" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FactSource_origin_idx" ON "FactSource"("origin");

-- CreateIndex
CREATE UNIQUE INDEX "FactSource_factId_origin_ref_key" ON "FactSource"("factId", "origin", "ref");

-- CreateIndex
CREATE INDEX "FactRevision_factId_idx" ON "FactRevision"("factId");

-- CreateIndex
CREATE INDEX "FactConflict_status_idx" ON "FactConflict"("status");

-- CreateIndex
CREATE INDEX "SyncRun_trigger_localDate_idx" ON "SyncRun"("trigger", "localDate");

-- AddForeignKey
ALTER TABLE "FactSource" ADD CONSTRAINT "FactSource_factId_fkey" FOREIGN KEY ("factId") REFERENCES "Fact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactRevision" ADD CONSTRAINT "FactRevision_factId_fkey" FOREIGN KEY ("factId") REFERENCES "Fact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactConflict" ADD CONSTRAINT "FactConflict_factId_fkey" FOREIGN KEY ("factId") REFERENCES "Fact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
