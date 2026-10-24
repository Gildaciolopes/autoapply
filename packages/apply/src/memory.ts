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
    };
  }
  return null;
}
