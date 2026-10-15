/**
 * SC-002 extraction-quality eval over 5 synthetic personas.
 * Default: replays recorded qwen3 outputs (offline, CI). `KB_EVAL_LIVE=1` (make kb-eval) runs the
 * live local LLM instead. Gates: recall ≥ 95% of hand-labelled items; 100% of injected
 * hallucinations flagged not_in_source.
 */
import { describe, expect, it } from 'vitest';
import { ollamaFromEnv } from '@autoapply/llm';
import { normalizeText, sameOrganization } from '@autoapply/kb';
import { extractPdfText } from '@autoapply/resume';
import type { ResumeDraft } from '@autoapply/shared';
import { extractDraft, normalizeExtraction, type LlmResumeExtraction } from '../src/kb/draft-llm.js';
import { json, resumeFixture } from './helpers.js';

type Expected = { work: [string, string][]; education: string[]; skills: string[]; languages: string[]; certificates: string[]; projects: string[] };
const EXPECTED = json<Record<string, Expected>>('expected/personas.json');
const LIVE = process.env.KB_EVAL_LIVE === '1';

const eq = (a: string, b: string) => {
  const x = normalizeText(a);
  const y = normalizeText(b);
  return x === y || x.includes(y) || y.includes(x);
};

function score(draft: ResumeDraft, exp: Expected) {
  const ok = <T extends { flags: string[] }>(xs: T[]) => xs.filter((x) => !x.flags.includes('not_in_source'));
  const misses: string[] = [];
  let total = 0;
  let hit = 0;
  const check = (label: string, found: boolean) => {
    total++;
    if (found) hit++;
    else misses.push(label);
  };
  const used = new Set<object>();
  const take = <T extends object>(xs: T[], pred: (x: T) => boolean) => {
    const x = xs.find((i) => !used.has(i) && pred(i));
    if (x) used.add(x);
    return Boolean(x);
  };
  for (const [company, position] of exp.work) check(`work:${company}`, take(ok(draft.work), (w) => sameOrganization(w.name, company) && eq(w.position, position)));
  for (const i of exp.education) check(`education:${i}`, take(ok(draft.education), (e) => eq(e.institution, i)));
  for (const s of exp.skills) check(`skill:${s}`, take(ok(draft.skills), (k) => eq(k.name, s)));
  for (const l of exp.languages) check(`language:${l}`, take(ok(draft.languages), (x) => eq(x.language, l)));
  for (const c of exp.certificates) check(`cert:${c}`, take(ok(draft.certificates), (x) => eq(x.name, c)));
  for (const p of exp.projects) check(`project:${p}`, take(ok(draft.projects), (x) => eq(x.name, p)));
  return { total, hit, misses };
}

const HALLUCINATIONS = {
  skills: [{ name: 'COBOL', quote: 'COBOL' }, { name: 'Salesforce', quote: '' }],
  work: [{ company: 'Google', position: 'Staff Engineer', start: '2015', end: '2016', highlights: [], quote: 'Google' }],
  certificates: [{ name: 'PMP', issuer: 'PMI', quote: 'PMP' }],
};

describe(`extraction quality (${LIVE ? 'live LLM' : 'recorded'})`, () => {
  const results: { persona: string; total: number; hit: number; misses: string[] }[] = [];

  for (const persona of Object.keys(EXPECTED)) {
    it(persona, async () => {
      const text = (await extractPdfText(resumeFixture(`${persona}.pdf`))).text;
      const raw = json<LlmResumeExtraction>(`llm/${persona}.json`);
      const draft = LIVE ? await extractDraft(ollamaFromEnv(), text) : normalizeExtraction(raw, text);
      const r = score(draft, EXPECTED[persona]!);
      results.push({ persona, ...r });

      // Injected hallucinations (on top of the recorded output) must all be flagged.
      const tampered = normalizeExtraction(
        { ...raw, skills: [...raw.skills, ...HALLUCINATIONS.skills], work: [...raw.work, ...HALLUCINATIONS.work], certificates: [...raw.certificates, ...HALLUCINATIONS.certificates] },
        text,
      );
      const flagged = (xs: { flags: string[] }[], n: number) => xs.slice(-n).every((x) => x.flags.includes('not_in_source'));
      expect(flagged(tampered.skills, 2), 'hallucinated skills flagged').toBe(true);
      expect(flagged(tampered.work, 1), 'hallucinated job flagged').toBe(true);
      expect(flagged(tampered.certificates, 1), 'hallucinated cert flagged').toBe(true);
    }, 600_000);
  }

  it('recall ≥ 95% over all personas (SC-002)', () => {
    const total = results.reduce((a, r) => a + r.total, 0);
    const hit = results.reduce((a, r) => a + r.hit, 0);
    const recall = hit / total;
    console.log(`extraction recall ${(recall * 100).toFixed(1)}% (${hit}/${total})`, results.filter((r) => r.misses.length).map((r) => `${r.persona}: ${r.misses.join(', ')}`));
    expect(recall).toBeGreaterThanOrEqual(0.95);
  });
});
