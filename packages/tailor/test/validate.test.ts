import { describe, expect, it } from 'vitest';
import type { ProfileFact } from '@autoapply/jobs';
import { substitutePlaceholders } from '../src/years.js';
import { validateSentences } from '../src/validate.js';
import cases from './fixtures/validator-cases.json' with { type: 'json' };

type Case = { text: string; factIds: string[]; role?: 'greeting' | 'body' | 'closing'; expect?: string };
const facts = cases.facts as ProfileFact[];
const ctx = { usableFacts: facts, knownOrgs: cases.knownOrgs, targetCompany: cases.targetCompany };
const NOW = new Date('2026-10-15T12:00:00Z');

function check(c: Case) {
  const { sentences, findings } = substitutePlaceholders([{ text: c.text, factIds: c.factIds, role: c.role }], facts, NOW);
  const r = validateSentences(sentences, ctx);
  return [...findings, ...r.findings];
}

describe('seeded validator set (SC-002)', () => {
  it('has ≥ 30 bad and ≥ 20 good sentences', () => {
    expect(cases.bad.length).toBeGreaterThanOrEqual(30);
    expect(cases.good.length).toBeGreaterThanOrEqual(20);
  });

  it.each(cases.bad as Case[])('rejects: $text', (c) => {
    const f = check(c);
    expect(f.length, JSON.stringify(f)).toBeGreaterThan(0);
    expect(f.map((x) => x.type)).toContain(c.expect);
  });

  it('accepts ≥ 95% of correctly cited sentences', () => {
    const results = (cases.good as Case[]).map((c) => ({ c, f: check(c) }));
    const failed = results.filter((r) => r.f.length);
    expect(failed.map((r) => `${r.c.text} → ${JSON.stringify(r.f)}`)).toEqual([]);
    expect(1 - failed.length / results.length).toBeGreaterThanOrEqual(0.95);
  });

  it('target company only allowed in greeting/closing', () => {
    expect(check({ text: 'Na Acme Pagamentos, migrei a API para NestJS.', factIds: ['f-exp1'] }).map((f) => f.type)).toContain('org_without_evidence');
  });
});
