import { describe, expect, it } from 'vitest';
import { diffSnapshot } from '../src/diff.js';
import { mergeCandidates } from '../src/merge.js';
import type { Candidate, FactLike } from '../src/types.js';

const skill = (id: string, refs: string[], over: Partial<FactLike> = {}): FactLike => ({
  id,
  kind: 'skill',
  key: `skill:${id}`,
  value: { name: id },
  verifiedByUser: false,
  status: 'active',
  sources: refs.map((ref) => ({ origin: 'github' as const, ref })),
  ...over,
});
const cand = (id: string, ref: string, value: unknown = { name: id }): Candidate => ({ kind: 'skill', key: `skill:${id}`, value, source: { origin: 'github', ref, rawValue: {} } });

describe('sync diff (snapshot A → B)', () => {
  const existing = [
    skill('react', ['github:a/x:package.json']),
    skill('vue', ['github:a/old:languages']),
    skill('python', ['github:a/py:languages'], { verifiedByUser: true }),
    skill('go', ['github:a/go:languages'], { missingFrom: ['github'] }),
  ];
  const now = [cand('react', 'github:a/x:package.json'), cand('python', 'github:a/py:languages'), cand('go', 'github:a/go:languages'), cand('rust', 'github:a/r:languages')];

  it('vanished → missing; returned → cleared', () => {
    const d = diffSnapshot(existing, now, 'github');
    expect(d.missing).toEqual(['vue']);
    expect(d.returned).toEqual(['go']);
  });

  it('new items are created unverified-by-default, verified facts never updated', () => {
    const m = mergeCandidates(existing, [...now, cand('python', 'github:a/py2:languages', { name: 'python', evidence: { repoCount: 2 } })]);
    expect(m.create.map((c) => c.key)).toEqual(['skill:rust']);
    expect(m.update.map((u) => u.factId)).not.toContain('python');
  });
});
