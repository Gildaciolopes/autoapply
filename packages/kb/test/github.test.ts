import { describe, expect, it } from 'vitest';
import { snapshotToSkillCandidates, type GithubSnapshot } from '../src/github.js';

const repo = (name: string, over: Partial<GithubSnapshot['repos'][number]> = {}): GithubSnapshot['repos'][number] => ({
  nameWithOwner: `ana/${name}`,
  url: `https://github.com/ana/${name}`,
  isFork: false,
  isArchived: false,
  isPrivate: false,
  pushedAt: '2026-09-01T00:00:00Z',
  languages: [],
  readme: null,
  manifests: [],
  ...over,
});

describe('snapshotToSkillCandidates', () => {
  const snapshot: GithubSnapshot = {
    user: 'ana',
    fetchedAt: '2026-10-14T00:00:00Z',
    complete: true,
    repos: [
      repo('api', {
        pushedAt: '2026-10-01T00:00:00Z',
        languages: [{ name: 'TypeScript', size: 200_000 }, { name: 'CSS', size: 100 }],
        manifests: [{ path: 'package.json', text: JSON.stringify({ dependencies: { '@nestjs/core': '1', 'left-pad': '1' } }) }],
        readme: { path: 'README.md', text: 'Uses PostgreSQL.' },
      }),
      repo('lib', { languages: [{ name: 'TypeScript', size: 5000 }], pushedAt: '2025-01-01T00:00:00Z' }),
      repo('fork', { isFork: true, languages: [{ name: 'Vue', size: 30_000 }] }),
    ],
  };
  const c = snapshotToSkillCandidates(snapshot);
  const byKey = (key: string) => c.filter((x) => x.key === key);

  it('derives skills only from dictionary matches, with one source per repo/file', () => {
    expect([...new Set(c.map((x) => x.key))].sort()).toEqual(['skill:nestjs', 'skill:postgresql', 'skill:typescript', 'skill:vue']);
    expect(byKey('skill:nestjs').map((x) => x.source.ref)).toEqual(['github:ana/api:package.json']);
    expect(byKey('skill:postgresql').map((x) => x.source.ref)).toEqual(['github:ana/api:README.md']);
    expect(c.every((x) => x.source.origin === 'github' && x.source.ref.startsWith('github:'))).toBe(true);
  });

  it('computes metrics by code', () => {
    const ts = byKey('skill:typescript');
    expect(ts.map((x) => x.source.ref)).toEqual(['github:ana/api:languages', 'github:ana/lib:languages']);
    expect((ts[0]!.value as { evidence: unknown }).evidence).toEqual({
      repoCount: 2,
      lastActivity: '2026-10-01',
      repos: ['ana/api', 'ana/lib'],
      forkOnly: false,
      archivedOnly: false,
      via: ['language'],
    });
  });

  it('ignores tiny language shares and marks fork-only evidence', () => {
    expect(byKey('skill:css')).toHaveLength(0); // 100 bytes of 200 KB
    expect((byKey('skill:vue')[0]!.value as { evidence: { forkOnly: boolean } }).evidence.forkOnly).toBe(true);
  });
});
