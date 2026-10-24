import type { FormField, PlannedAnswer } from '@autoapply/shared';
import { matchOption, normalizeText } from './options.js';

/** Question identity for answer memory: no accents/punctuation, no required markers. */
export function normalizeQuestion(label: string): string {
  return normalizeText(label.replace(/\*+/g, ' '))
    .replace(/\b(obrigatorio|required|opcional|optional)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface MemoryCandidate {
  /** AnswerMemory id (to count reuse); absent in pure tests. */
  id?: string;
  question: string;
  normalized: string;
  answer: string;
  fieldType: string | null;
  evidence: string[];
  /** Cosine similarity to the field label (bge-m3), when found by vector search. */
  similarity?: number;
}

export const MEMORY_SIMILARITY = 0.92;

/**
 * Reuses an approved answer (FR-009): exact normalized question → 0.95; semantic match ≥ 0.92 with
 * the same field type → its similarity. Choice fields must contain the stored answer as an option.
 */
export function pickMemory(field: FormField, candidates: MemoryCandidate[]): PlannedAnswer | null {
  const norm = normalizeQuestion(field.label);
  const ranked = [...candidates].sort((a, b) => Number(b.normalized === norm) - Number(a.normalized === norm) || (b.similarity ?? 0) - (a.similarity ?? 0));
  for (const c of ranked) {
    const exact = c.normalized === norm;
    if (!exact && ((c.similarity ?? 0) < MEMORY_SIMILARITY || (c.fieldType && c.fieldType !== field.type))) continue;
    let value: string | string[] = c.answer;
    if (field.options.length) {
      const parts = field.multiple ? c.answer.split(/\s*;\s*/) : [c.answer];
      const idx = parts.map((p) => matchOption(field.options, p));
      if (idx.some((i) => i === null)) continue;
      const labels = idx.map((i) => field.options[i!]!);
      value = field.multiple ? labels : labels[0]!;
    }
    return {
      fieldKey: field.key,
      value,
      source: 'memória',
      confidence: exact ? 0.95 : Math.min(0.95, c.similarity ?? 0),
      evidence: c.evidence,
      blocking: false,
      findings: [],
      ...(c.id ? { memoryId: c.id } : {}),
    };
  }
  return null;
}

const same = (a: string | string[] | null, b: string | string[] | null) =>
  normalizeText([a ?? ''].flat().join(';')) === normalizeText([b ?? ''].flat().join(';'));

/**
 * F6 FR-022: a verified fact wins over a memory. When a matching memory would have answered the field
 * differently, the fact-backed answer gets a `memory_conflict` finding so the user can fix one of them.
 */
export function withMemoryConflict(answer: PlannedAnswer, field: FormField, candidates: MemoryCandidate[]): PlannedAnswer {
  const mem = pickMemory(field, candidates);
  if (!mem || answer.value === null || same(answer.value, mem.value)) return answer;
  return { ...answer, findings: [...answer.findings, { sentenceIndex: 0, type: 'memory_conflict', token: [mem.value].flat().join('; ') }] };
}
