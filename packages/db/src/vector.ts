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
  return db.$queryRaw<{ id: string; question: string; answer: string; evidence: string[]; distance: number }[]>`
    SELECT id, question, answer, evidence, embedding <=> ${toVectorLiteral(v)}::vector AS distance
    FROM "AnswerMemory" WHERE approved AND embedding IS NOT NULL
    ORDER BY distance LIMIT ${limit}`;
}
