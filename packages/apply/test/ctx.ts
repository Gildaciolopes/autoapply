import { readFileSync } from 'node:fs';
import { PersonalFacts, type FormField, type PersonalField } from '@autoapply/shared';
import type { AnswerContext } from '../src/context.js';

const persona = JSON.parse(readFileSync(new URL('./fixtures/persona.json', import.meta.url), 'utf8'));

/** Persona "Ana" (F3 eval persona + languages + personal facts) as an AnswerContext. */
export function anaContext(over: Partial<AnswerContext> = {}): AnswerContext {
  const facts = persona.facts as AnswerContext['facts'];
  const raw: Record<string, unknown> = {};
  const personalIds: Partial<Record<PersonalField, string>> = {};
  for (const f of facts.filter((x) => x.kind === 'personal')) {
    const v = f.value as { field: PersonalField; value: unknown };
    raw[v.field] = v.value;
    personalIds[v.field] = f.id;
  }
  return {
    profile: persona.profile,
    facts,
    personal: PersonalFacts.parse(raw),
    personalIds,
    knownOrgs: persona.knownOrgs,
    job: persona.job,
    lang: 'pt',
    now: new Date('2026-10-23T12:00:00Z'),
    ...over,
  };
}

let n = 0;
export const field = (label: string, over: Partial<FormField> = {}): FormField => ({
  key: `#f${++n}`,
  type: 'text',
  label,
  required: true,
  options: [],
  multiple: false,
  step: 0,
  ...over,
});
