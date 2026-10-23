import { prepareSource, valueInSource } from '@autoapply/kb';
import { factSummary, type ProfileFact } from '@autoapply/jobs';
import type { LooseDate, TailorSentence, ValidationFinding } from '@autoapply/shared';

const month = (d: LooseDate | null | undefined, end: boolean, now: Date): number | null => {
  if (!d) return null;
  if (d === 'present') return now.getFullYear() * 12 + now.getMonth();
  return d.year * 12 + (d.month ? d.month - 1 : end ? 11 : 0);
};

/**
 * Years of experience computed from fact dates (constitution §I: numbers by code, never by the LLM).
 * Overlapping jobs are merged; with `skill`, only experiences whose text names it (alias-aware) count.
 */
export function yearsOfExperience(facts: ProfileFact[], skill?: string, now = new Date()): { years: number; source: string[] } {
  const exps = facts.filter((f) => f.kind === 'experience' && (!skill || valueInSource(prepareSource(factSummary(f)), skill, { skill: true })));
  const spans = exps
    .map((f) => {
      const v = f.value as { start?: LooseDate | null; end?: LooseDate | null };
      const s = month(v.start, false, now);
      const e = month(v.end ?? 'present', true, now);
      return s !== null && e !== null && e >= s ? { s, e, id: f.id } : null;
    })
    .filter((x): x is { s: number; e: number; id: string } => x !== null)
    .sort((a, b) => a.s - b.s);
  let months = 0;
  let cur: { s: number; e: number } | null = null;
  for (const sp of spans) {
    if (cur && sp.s <= cur.e + 1) cur.e = Math.max(cur.e, sp.e);
    else {
      if (cur) months += cur.e - cur.s + 1;
      cur = { s: sp.s, e: sp.e };
    }
  }
  if (cur) months += cur.e - cur.s + 1;
  return { years: Math.floor(months / 12), source: spans.map((s) => s.id) };
}

const PLACEHOLDER = /\{\{\s*(anos|years)(?::\s*([^}]+?))?\s*\}\}/gi;

/** Replaces {{anos}} / {{anos:<skill>}} with computed values; unresolvable or zero → finding. */
export function substitutePlaceholders(sentences: TailorSentence[], facts: ProfileFact[], now = new Date()) {
  const findings: ValidationFinding[] = [];
  const out = sentences.map((s, i) => {
    const computed = [...(s.computed ?? [])];
    const text = s.text.replace(PLACEHOLDER, (token, _w, skill?: string) => {
      const { years, source } = yearsOfExperience(facts, skill?.trim(), now);
      if (years < 1) {
        findings.push({ sentenceIndex: i, type: 'placeholder_unresolved', token });
        return token;
      }
      computed.push({ token, value: String(years), source });
      return String(years);
    });
    return { ...s, text, computed: computed.length ? computed : undefined };
  });
  return { sentences: out, findings };
}
