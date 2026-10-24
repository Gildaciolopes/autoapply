import type { PrismaClient } from './generated/prisma/client.js';

/** pgvector literal, e.g. "[0.1,0.2]". Prisma has no native vector type. */
export const toVectorLiteral = (v: number[]): string => `[${v.join(',')}]`;

export async function setJobEmbedding(db: PrismaClient, jobId: string, v: number[]): Promise<void> {
  await db.$executeRaw`UPDATE "Job" SET embedding = ${toVectorLiteral(v)}::vector WHERE id = ${jobId}`;
}

export async function setAnswerEmbedding(db: PrismaClient, id: string, v: number[]): Promise<void> {
  await db.$executeRaw`UPDATE "AnswerMemory" SET embedding = ${toVectorLiteral(v)}::vector WHERE id = ${id}`;
}

/** Approved answers closest to the question embedding (cosine distance). */
export async function similarAnswers(db: PrismaClient, v: number[], limit = 5) {
  return db.$queryRaw<{ id: string; question: string; normalized: string; answer: string; fieldType: string | null; evidence: string[]; distance: number }[]>`
    SELECT id, question, normalized, answer, "fieldType", evidence, embedding <=> ${toVectorLiteral(v)}::vector AS distance
    FROM "AnswerMemory" WHERE approved AND embedding IS NOT NULL
    ORDER BY distance LIMIT ${limit}`;
}

export async function setProfileVector(db: PrismaClient, hash: string, text: string, v: number[]): Promise<void> {
  await db.$executeRaw`
    INSERT INTO "ProfileVector" (hash, text, embedding) VALUES (${hash}, ${text}, ${toVectorLiteral(v)}::vector)
    ON CONFLICT (hash) DO UPDATE SET embedding = EXCLUDED.embedding`;
}

export async function hasProfileVector(db: PrismaClient, hash: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "ProfileVector" WHERE hash = ${hash} AND embedding IS NOT NULL`;
  return Number(rows[0]?.n ?? 0) > 0;
}

/** Jobs (of the given ids) that still need an embedding. */
export async function jobsWithoutEmbedding(db: PrismaClient, jobIds: string[]): Promise<string[]> {
  if (!jobIds.length) return [];
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT id FROM "Job" WHERE id = ANY(${jobIds}) AND embedding IS NULL`;
  return rows.map((r) => r.id);
}

/** Cosine similarity between each job embedding and the cached profile embedding. */
export async function jobSimilarities(db: PrismaClient, profileHash: string, jobIds: string[]) {
  if (!jobIds.length) return [];
  return db.$queryRaw<{ jobId: string; cosine: number }[]>`
    SELECT j.id AS "jobId", 1 - (j.embedding <=> p.embedding) AS cosine
    FROM "Job" j, "ProfileVector" p
    WHERE p.hash = ${profileHash} AND j.id = ANY(${jobIds}) AND j.embedding IS NOT NULL`;
}
