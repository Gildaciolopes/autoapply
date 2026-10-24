/**
 * Answer trap evaluation (F4 SC-003): runs the form-answer pipeline over trap questions and checks the
 * answers that would be filled with an INDEPENDENT checker (bait terms / techs / numbers by substring,
 * plus yes/no polarity), reusing the F3 checker for free text.
 */
import { readFileSync } from 'node:fs';
import { planAnswers, yesNoPolarity, type AnswerContext } from '@autoapply/apply';
import { FakeLlmProvider, type LlmProvider } from '@autoapply/llm';
import { FormField, LlmFieldAnswers, PersonalFacts, type PersonalField, type PlannedAnswer } from '@autoapply/shared';
import { independentCheck, type Persona, type Recording } from './tailor-eval-lib.js';

interface Expect {
  value?: string | null;
  notValue?: string;
  blocking?: boolean;
  noFabricationOnly?: boolean;
}
type EvalField = FormField & { expect: Expect };

const read = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
export const EVAL_FIELDS: EvalField[] = read('./fixtures/eval-apply/fields.json').fields.map((f: EvalField) => ({ ...FormField.parse(f), expect: f.expect }));
const personaJson = read('../../../packages/apply/test/fixtures/persona.json');

export const APPLY_EVAL_NOW = new Date('2026-10-23T12:00:00Z');

export function evalContext(): AnswerContext {
  const raw: Record<string, unknown> = {};
  const personalIds: Partial<Record<PersonalField, string>> = {};
  for (const f of personaJson.facts.filter((x: { kind: string }) => x.kind === 'personal')) {
    raw[f.value.field] = f.value.value;
    personalIds[f.value.field as PersonalField] = f.id;
  }
  return { profile: personaJson.profile, facts: personaJson.facts, personal: PersonalFacts.parse(raw), personalIds, knownOrgs: personaJson.knownOrgs, job: personaJson.job, lang: 'pt', now: APPLY_EVAL_NOW };
}

export interface AnswerResult {
  fieldKey: string;
  question: string;
  value: PlannedAnswer['value'];
  source: string;
  blocking: boolean;
  fabrications: string[];
}

/** Independent check of one filled answer. */
function check(field: EvalField, a: PlannedAnswer, persona: Persona): string[] {
  const problems: string[] = [];
  const e = field.expect;
  if (e.value !== undefined && a.value !== e.value) problems.push(`expected ${JSON.stringify(e.value)}, got ${JSON.stringify(a.value)}`);
  if (e.notValue !== undefined && a.value === e.notValue) problems.push(`forbidden answer ${JSON.stringify(e.notValue)}`);
  if (e.blocking && !a.blocking) problems.push('should block');
  if (a.value === null) return problems;
  const values = Array.isArray(a.value) ? a.value : [a.value];
  // "Yes" may only come from deterministic evidence, memory or the user — never from the model.
  if (values.some((v) => yesNoPolarity(v) === 'yes') && a.source === 'modelo') problems.push(`model answered yes: ${field.label}`);
  if (a.source === 'modelo' || a.source === 'memória') {
    const trap = { id: field.key, title: '', company: personaJson.job.company, description: '' };
    problems.push(...independentCheck(values.map((v) => ({ text: v, factIds: a.evidence })), persona, trap));
  }
  return problems;
}

/** Runs the answer suite live (records responses) or from a recording. */
export async function runAnswerEval(src: { llm: LlmProvider; model: string } | { recording: Recording }) {
  const recording: Recording = { form: [] };
  let llm: LlmProvider;
  if ('llm' in src) {
    const live = src.llm;
    llm = {
      name: 'recording',
      embed: (t) => live.embed(t),
      generateObject: async (o) => {
        const r = await live.generateObject(o);
        recording.form!.push(r);
        return r;
      },
    };
  } else llm = new FakeLlmProvider([...(src.recording.form ?? [])]);
  const model = 'llm' in src ? src.model : 'recorded';
  const persona: Persona = { name: personaJson.profile.fullName, facts: personaJson.facts, knownOrgs: personaJson.knownOrgs };
  const plan = await planAnswers(EVAL_FIELDS, evalContext(), {
    threshold: 0.7,
    hasLetter: false,
    llm: async (messages) => LlmFieldAnswers.parse(await llm.generateObject({ schema: LlmFieldAnswers, model, temperature: 0.1, numCtx: 16384, messages })),
  });
  const results: AnswerResult[] = EVAL_FIELDS.map((f) => {
    const a = plan.answers.find((x) => x.fieldKey === f.key)!;
    return { fieldKey: f.key, question: f.label, value: a.value, source: a.source, blocking: a.blocking, fabrications: check(f, a, persona) };
  });
  const fabrications = results.reduce((n, r) => n + r.fabrications.length, 0);
  return { results, fabrications, recording, llmCalls: plan.llmCalls };
}
