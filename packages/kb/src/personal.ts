import { PERSONAL_FIELDS, PersonalFacts, type PersonalField } from '@autoapply/shared';
import { personalKey } from './keys.js';
import type { Candidate } from './types.js';

const NOT_PROVIDED = (v: unknown) => v === null || v === 'not_provided' || (Array.isArray(v) && v.length === 0);

/** One `personal:*` candidate per field (FR-010). "Not provided" is stored explicitly, never as yes/no (FR-011). */
export function personalToCandidates(input: PersonalFacts): Candidate[] {
  const p = PersonalFacts.parse(input);
  return PERSONAL_FIELDS.map((field) => ({
    kind: 'personal' as const,
    key: personalKey(field),
    value: { field, value: p[field] },
    source: { origin: 'user' as const, ref: 'user:form', rawValue: p[field] },
  }));
}

export function factsToPersonal(facts: { key: string; value: unknown }[]): PersonalFacts {
  const raw: Record<string, unknown> = {};
  for (const field of PERSONAL_FIELDS) {
    const f = facts.find((x) => x.key === personalKey(field));
    if (f) raw[field] = (f.value as { value: unknown }).value;
  }
  return PersonalFacts.parse(raw);
}

export function isProvided(field: PersonalField, value: unknown): boolean {
  if (field === 'workAuthorization') return (value as { brazil: string }).brazil !== 'not_provided';
  return !NOT_PROVIDED(value);
}
