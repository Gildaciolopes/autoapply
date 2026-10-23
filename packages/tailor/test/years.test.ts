import { describe, expect, it } from 'vitest';
import type { ProfileFact } from '@autoapply/jobs';
import { substitutePlaceholders, yearsOfExperience } from '../src/years.js';
import cases from './fixtures/validator-cases.json' with { type: 'json' };

const facts = cases.facts as ProfileFact[];
const NOW = new Date('2026-10-15T12:00:00Z');

describe('yearsOfExperience', () => {
  it('merges intervals, counts to today', () => {
    // 2018-06..2021-02 (33 months) + 2021-03..2026-10 (68 months) contiguous → 101 months → 8 years
    expect(yearsOfExperience(facts, undefined, NOW).years).toBe(8);
  });
  it('per skill uses only experiences naming it', () => {
    expect(yearsOfExperience(facts, 'NestJS', NOW)).toMatchObject({ years: 5, source: ['f-exp1'] });
    expect(yearsOfExperience(facts, 'Next.js', NOW)).toMatchObject({ years: 2, source: ['f-exp0'] });
    expect(yearsOfExperience(facts, 'Go', NOW).years).toBe(0);
  });
  it('substitutes placeholders and records the source', () => {
    const { sentences, findings } = substitutePlaceholders([{ text: 'Há {{anos:NestJS}} anos com NestJS.', factIds: ['f-exp1'] }], facts, NOW);
    expect(sentences[0]!.text).toBe('Há 5 anos com NestJS.');
    expect(sentences[0]!.computed).toEqual([{ token: '{{anos:NestJS}}', value: '5', source: ['f-exp1'] }]);
    expect(findings).toEqual([]);
  });
});
