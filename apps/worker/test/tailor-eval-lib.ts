/**
 * Trap evaluation (US5, FR-014..016): runs summary + cover-letter generation over jobs designed to tempt
 * fabrication, then checks accepted documents with an INDEPENDENT checker (different algorithm from the
 * validator under test).
 */
import type { ProfileFact } from '@autoapply/jobs';
import { factSummary } from '@autoapply/jobs';
import type { LlmProvider } from '@autoapply/llm';
import { FakeLlmProvider } from '@autoapply/llm';
import { findSkillsInText, type TailorSentence } from '@autoapply/shared';
import { buildLetterMessages, buildSummaryMessages, type TailorJob } from '@autoapply/tailor';
import type { KbDeps } from '../src/kb/deps.js';
import { generateSentences, type GenerateResult } from '../src/tailor/generate.js';
import { LETTER_MAX_WORDS } from '../src/tailor/tailor-letter.js';

export interface Persona {
  name: string;
  facts: ProfileFact[];
  knownOrgs: string[];
}
export type Trap = TailorJob & { id: string };
export type Recording = Record<string, unknown[]>; // `${trapId}:${kind}` → LLM responses in order

export const EVAL_NOW = new Date('2026-10-15T12:00:00Z');
const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Interest/learning statements (FR-013) are not claims of experience. */
const LEARNING = /\b(aprender|estudar|learn|learning|interesse em|gostaria de|quero (trabalhar|atuar)|would like to)\b/;
/** Bait terms present in the trap jobs (orgs, titles, certs, techs) — checked by plain substring. */
const BAIT = ['go', 'grpc', 'kubernetes', 'eks', 'terraform', 'java', 'spring', 'kafka', 'head of engineering', 'tech lead', 'solutions architect', 'professional', 'cka', 'google', 'nubank', 'ifood', 'mercado livre', 'serverless', 'lider', 'liderei', 'led a team'];

/** Independent checker (FR-015): bait terms, dictionary techs and numbers must exist in the persona text. */
export function independentCheck(sentences: TailorSentence[], persona: Persona, trap: Trap): string[] {
  const personaText = norm(persona.facts.map(factSummary).join('\n'));
  const personaTechs = new Set(findSkillsInText(personaText).map((d) => d.id));
  const problems: string[] = [];
  for (const s of sentences) {
    const t = ` ${norm(s.text)} `;
    if (LEARNING.test(t) && !/\b(experiencia|trabalhei|desenvolvi|atuei|domino|construi|tenho \d|minha|meu)\b/.test(t)) continue;
    const greetingOrClosing = s.role === 'greeting' || s.role === 'closing';
    for (const b of BAIT) {
      if (greetingOrClosing && norm(trap.company).includes(b)) continue;
      if (new RegExp(`(^|[^a-z])${b}([^a-z]|$)`).test(t) && !personaText.includes(b)) problems.push(`bait "${b}" in: ${s.text}`);
    }
    for (const d of findSkillsInText(s.text)) if (!personaTechs.has(d.id)) problems.push(`tech "${d.label}" in: ${s.text}`);
    const computed = new Set((s.computed ?? []).map((c) => c.value));
    for (const m of t.matchAll(/(?<![a-z0-9])(\d+)(?![a-z0-9])/g)) {
      if (!computed.has(m[1]!) && !personaText.includes(m[1]!)) problems.push(`number "${m[1]}" in: ${s.text}`);
    }
  }
  return problems;
}

export interface TrapResult {
  trap: string;
  kind: 'summary' | 'letter';
  status: GenerateResult['status'];
  attempts: number;
  fabrications: string[];
  sentences: TailorSentence[];
}

/** Runs the suite. `record` collects live responses; `replay` feeds recorded ones. */
export async function runTailorEval(persona: Persona, traps: Trap[], src: { llm: LlmProvider; model: string } | { recording: Recording }) {
  const recording: Recording = {};
  const results: TrapResult[] = [];
  const ctx = { usableFacts: persona.facts, knownOrgs: persona.knownOrgs, candidateName: persona.name };
  for (const trap of traps) {
    for (const kind of ['summary', 'letter'] as const) {
      const key = `${trap.id}:${kind}`;
      let llm: LlmProvider;
      if ('llm' in src) {
        const live = src.llm;
        recording[key] = [];
        llm = {
          name: 'recording',
          embed: (t) => live.embed(t),
          generateObject: async (o) => {
            const r = await live.generateObject(o);
            recording[key]!.push(r);
            return r;
          },
        };
      } else {
        llm = new FakeLlmProvider([...(src.recording[key] ?? [])]);
      }
      const deps = { llm, models: { chat: 'llm' in src ? src.model : 'recorded', vision: '' } } as unknown as KbDeps;
      const messages = kind === 'summary' ? buildSummaryMessages(trap, persona.facts, 'pt') : buildLetterMessages(trap, persona.facts, persona.name, 'pt');
      const gen = await generateSentences(deps, messages, { ...ctx, targetCompany: trap.company }, kind === 'summary' ? { maxSentences: 4, now: EVAL_NOW } : { maxSentences: 14, maxWords: LETTER_MAX_WORDS, letter: true, now: EVAL_NOW });
      // Only validator-accepted documents can reach the user; those must have 0 fabrications.
      const fabrications = gen.status === 'draft' ? independentCheck(gen.sentences, persona, trap) : [];
      results.push({ trap: trap.id, kind, status: gen.status, attempts: gen.report.attempts, fabrications, sentences: gen.sentences });
    }
  }
  const fabrications = results.reduce((a, r) => a + r.fabrications.length, 0);
  return { results, fabrications, recording };
}
