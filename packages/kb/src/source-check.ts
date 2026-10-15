import { findSkillByAlias, type ItemFlag } from '@autoapply/shared';
import { normalizeText } from './normalize.js';

export interface SourceText {
  norm: string;
}

export function prepareSource(text: string): SourceText {
  return { norm: ` ${normalizeText(text)} ` };
}

function contains(src: SourceText, value: string): boolean {
  const v = normalizeText(value);
  return v.length > 0 && src.norm.includes(` ${v} `);
}

/** Value found verbatim, or (for skills) via any dictionary alias of the same skill. */
export function valueInSource(src: SourceText, value: string, opts: { skill?: boolean } = {}): boolean {
  if (contains(src, value)) return true;
  if (!opts.skill) return false;
  const def = findSkillByAlias(value);
  if (!def) return false;
  return [def.label, def.id, ...def.synonyms].some((a) => contains(src, a));
}

/** Quote must appear in the source (normalized), or ≥ 90% of its words must, in order-insensitive form. */
export function quoteInSource(src: SourceText, quote: string): boolean {
  const q = normalizeText(quote);
  if (!q) return false;
  if (src.norm.includes(q)) return true;
  const words = q.split(' ').filter((w) => w.length > 2);
  if (words.length < 3) return false;
  const hits = words.filter((w) => src.norm.includes(` ${w} `)).length;
  return hits / words.length >= 0.9;
}

/**
 * Deterministic hallucination check (FR-008, constitution §I): every identifying value of an
 * extracted item must be present in the source text. The LLM-provided quote is a secondary signal.
 */
export function foundInSource(src: SourceText, values: string[], opts: { skill?: boolean } = {}): ItemFlag[] {
  const vals = values.filter((v) => v && v.trim());
  if (vals.length === 0) return ['not_in_source'];
  return vals.every((v) => valueInSource(src, v, opts)) ? [] : ['not_in_source'];
}

