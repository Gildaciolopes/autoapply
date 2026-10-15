import { describe, expect, it } from 'vitest';
import { ResumeDraft } from '@autoapply/shared';
import { diffDraft, draftToCandidates, flagDraft, flaggedItems } from '../src/resume-to-facts.js';
import type { FactLike } from '../src/types.js';

const draft = ResumeDraft.parse({
  basics: { name: 'Ana Souza' },
  work: [
    {
      id: 'work-0',
      name: 'Xeno',
      position: 'Engenheira de Software',
      startDate: { year: 2021, month: 3, precision: 'month' },
      endDate: 'present',
      highlights: ['Migrei a API para NestJS'],
      quote: 'Xeno · Engenheira de Software',
    },
  ],
  skills: [
    { id: 'skill-0', name: 'TypeScript' },
    { id: 'skill-1', name: 'Kubernetes' },
  ],
});
const text = 'Ana Souza\nXeno · Engenheira de Software · mar 2021 – atual\nMigrei a API para NestJS\nTypeScript';

describe('resume → facts', () => {
  it('flags items not present in the source text', () => {
    const flagged = flagDraft(draft, text);
    expect(flaggedItems(flagged)).toEqual(['skill-1']);
  });

  it('builds candidates with provenance refs', () => {
    const c = draftToCandidates(draft, 'r1');
    expect(c.map((x) => [x.key, x.source.ref])).toEqual([
      ['experience:xeno:2021', 'resume:r1#work[0]'],
      ['skill:typescript', 'resume:r1#skills[0]'],
      ['skill:kubernetes', 'resume:r1#skills[1]'],
    ]);
    expect(c[0]!.source.snippet).toBe('Xeno · Engenheira de Software');
  });

  it('diffs a re-upload: added / changed / removed', () => {
    const existing: FactLike[] = [
      { id: 'f-exp', kind: 'experience', key: 'experience:xeno:2021', value: { company: 'Xeno', title: 'Dev Pleno', start: { year: 2021, month: 3, precision: 'month' }, end: 'present' }, verifiedByUser: true, status: 'active', sources: [{ origin: 'resume', ref: 'resume:r0#work[0]' }] },
      { id: 'f-ts', kind: 'skill', key: 'skill:typescript', value: { name: 'TypeScript' }, verifiedByUser: true, status: 'active', sources: [{ origin: 'resume', ref: 'resume:r0#skills[0]' }] },
      { id: 'f-php', kind: 'skill', key: 'skill:php', value: { name: 'PHP' }, verifiedByUser: true, status: 'active', sources: [{ origin: 'resume', ref: 'resume:r0#skills[1]' }] },
    ];
    const d = diffDraft(draftToCandidates(draft, 'r1'), existing);
    expect(d.added).toEqual(['skill-1']);
    expect(d.changed.map((x) => x.factId)).toEqual(['f-exp']);
    expect(d.unchanged).toEqual(['skill-0']);
    expect(d.removed).toEqual([{ factId: 'f-php', key: 'skill:php' }]);
  });
});
