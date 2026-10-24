/*
  Warnings:

  - Added the required column `updatedAt` to the `AnswerMemory` table without a default value. This is not possible if the table is not empty.
  - Added the required column `fieldKey` to the `FormAnswer` table without a default value. This is not possible if the table is not empty.
  - Added the required column `fieldType` to the `FormAnswer` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "AnswerMemory" ADD COLUMN     "fieldType" TEXT,
ADD COLUMN     "normalized" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'user',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "ats" TEXT,
ADD COLUMN     "factsHash" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "formUrl" TEXT,
ADD COLUMN     "lastRunAt" TIMESTAMP(3),
ADD COLUMN     "needsReasons" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "report" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "tailoredDocIds" TEXT[];

-- AlterTable
ALTER TABLE "Artifact" ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "label" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "FormAnswer" ADD COLUMN     "blocking" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fieldKey" TEXT NOT NULL,
ADD COLUMN     "fieldType" TEXT NOT NULL,
ADD COLUMN     "filled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "findings" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "frameUrl" TEXT,
ADD COLUMN     "options" TEXT[],
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "required" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "step" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SearchPreference" ADD COLUMN     "applyConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
ADD COLUMN     "applyDailyCap" INTEGER NOT NULL DEFAULT 30;

-- CreateIndex
CREATE INDEX "AnswerMemory_normalized_idx" ON "AnswerMemory"("normalized");

-- CreateIndex
CREATE INDEX "Application_ats_lastRunAt_idx" ON "Application"("ats", "lastRunAt");
