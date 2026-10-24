import { normalizeQuestion, type MemoryCandidate } from '@autoapply/apply';
import { setAnswerEmbedding, similarAnswers } from '@autoapply/db';
import type { FormField } from '@autoapply/shared';
import type { KbDeps } from '../kb/deps.js';

/** bge-m3 for approved memories that have no embedding yet (user answers saved by the API). */
export async function embedMissingMemories(deps: KbDeps): Promise<number> {
  const rows = await deps.db.$queryRaw<{ id: string; question: string }[]>`
    SELECT id, question FROM "AnswerMemory" WHERE approved AND embedding IS NULL LIMIT 200`;
  if (!rows.length) return 0;
  const vectors = await deps.llm.embed(rows.map((r) => r.question));
  await Promise.all(rows.map((r, i) => (vectors[i]?.length ? setAnswerEmbedding(deps.db, r.id, vectors[i]!) : null)));
  return rows.length;
}

/**
 * Candidates per field for `pickMemory`: exact normalized question matches plus the 3 nearest approved
 * memories by cosine (bge-m3). Embedding failures fall back to exact matches only.
 */
export async function memoryCandidates(deps: KbDeps, fields: FormField[]): Promise<(field: FormField) => MemoryCandidate[]> {
  const labelled = fields.filter((f) => f.type !== 'file' && f.label.trim());
  const norms = [...new Set(labelled.map((f) => normalizeQuestion(f.label)))];
  const exact = norms.length
    ? await deps.db.answerMemory.findMany({ where: { approved: true, normalized: { in: norms } }, orderBy: { updatedAt: 'desc' } })
    : [];
  const nearest = new Map<string, MemoryCandidate[]>();
  try {
    await embedMissingMemories(deps);
    const total = await deps.db.answerMemory.count({ where: { approved: true } });
    if (total > 0 && labelled.length) {
      const vectors = await deps.llm.embed(labelled.map((f) => f.label));
      await Promise.all(
        labelled.map(async (f, i) => {
          if (!vectors[i]?.length) return;
          const rows = await similarAnswers(deps.db, vectors[i]!, 3);
          nearest.set(f.key, rows.map((r) => ({ ...r, similarity: 1 - Number(r.distance) })));
        }),
      );
    }
  } catch {
    // Ollama down: exact matches still work.
  }
  return (field) => {
    const n = normalizeQuestion(field.label);
    const ex: MemoryCandidate[] = exact
      .filter((m) => m.normalized === n)
      .map((m) => ({ question: m.question, normalized: m.normalized, answer: m.answer, fieldType: m.fieldType, evidence: m.evidence }));
    return [...ex, ...(nearest.get(field.key) ?? [])];
  };
}
