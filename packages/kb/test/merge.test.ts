import { describe, expect, it } from 'vitest';
import { mergeCandidates } from '../src/merge.js';
import type { Candidate, FactLike } from '../src/types.js';

const start = { year: 2021, month: 3, precision: 'month' as const };
const exp = (title: string, company = 'Xeno') => ({ company, title, start, end: 'present' as const, highlights: [] });
const fact = (over: Partial<FactLike> = {}): FactLike => ({
  id: 'f1',
  kind: 'experience',
  key: 'experience:xeno:2021',
  value: exp('Senior Engineer'),
  verifiedByUser: true,
  status: 'active',
  sources: [{ origin: 'resume', ref: 'resume:r1#work[0]' }],
  ...over,
});
const cand = (value: unknown, origin: Candidate['source']['origin'] = 'linkedin', key = 'experience:xeno:2021'): Candidate => ({
  kind: 'experience',
  key,
  value,
  source: { origin, ref: `${origin}:experience[0]`, rawValue: value },
});

describe('mergeCandidates', () => {
  it('equal value adds a source instead of duplicating', () => {
    const r = mergeCandidates([fact()], [cand(exp('Senior  engineer'))]);
    expect(r.addSource).toHaveLength(1);
    expect(r.create).toHaveLength(0);
  });

  it('differing title on a verified fact opens a conflict and never mutates', () => {
    const r = mergeCandidates([fact()], [cand(exp('Tech Lead'))]);
    expect(r.conflicts).toEqual([expect.objectContaining({ factId: 'f1' })]);
    expect(r.update).toHaveLength(0);
  });

  it('differing value from another origin on unverified fact → conflict', () => {
    const r = mergeCandidates([fact({ verifiedByUser: false })], [cand(exp('Tech Lead'))]);
    expect(r.conflicts).toHaveLength(1);
  });

  it('same-origin refresh of an unverified fact → update', () => {
    const r = mergeCandidates([fact({ verifiedByUser: false, sources: [{ origin: 'linkedin', ref: 'x' }] })], [cand(exp('Tech Lead'))]);
    expect(r.update).toHaveLength(1);
  });

  it('trusted (user-approved) candidates update even verified facts', () => {
    const r = mergeCandidates([fact()], [cand(exp('Tech Lead'), 'resume')], { trusted: true });
    expect(r.update).toHaveLength(1);
    expect(r.conflicts).toHaveLength(0);
  });

  it('flags possible duplicates (Itaú vs Itau Unibanco) without merging', () => {
    const existing = fact({ key: 'experience:itau:2020', value: { ...exp('Dev', 'Itaú'), start: { year: 2020, precision: 'year' } } });
    const r = mergeCandidates([existing], [cand(exp('Dev', 'Itau Unibanco S.A.'), 'linkedin', 'experience:itau-unibanco:2021')]);
    expect(r.create).toHaveLength(1);
    expect(r.duplicates).toEqual([{ newKey: 'experience:itau-unibanco:2021', kind: 'experience', existingFactId: 'f1' }]);
  });

  it('deduplicates within a batch', () => {
    const skill = (ref: string): Candidate => ({ kind: 'skill', key: 'skill:react', value: { name: 'React' }, source: { origin: 'resume', ref, rawValue: {} } });
    const r = mergeCandidates([], [skill('a'), skill('b')]);
    expect(r.create).toHaveLength(1);
    expect(r.create[0]!.sources).toHaveLength(2);
  });
});
