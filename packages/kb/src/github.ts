import { findSkillsInText, skillByGithubLanguage, skillByPackage, type GithubEvidence, type SkillDef } from '@autoapply/shared';
import { MANIFEST_FILES, parseManifest, type ManifestFile } from './manifests.js';
import type { Candidate } from './types.js';

export interface GithubRepoSnapshot {
  nameWithOwner: string;
  url: string;
  isFork: boolean;
  isArchived: boolean;
  isPrivate: boolean;
  pushedAt: string | null;
  languages: { name: string; size: number }[];
  readme: { path: string; text: string } | null;
  manifests: { path: ManifestFile; text: string }[];
}

export interface GithubSnapshot {
  user: string;
  fetchedAt: string;
  complete: boolean;
  repos: GithubRepoSnapshot[];
}

/** A language counts as evidence when it is ≥ 5% of the repo's code or ≥ 10 KB. */
export const LANGUAGE_MIN_SHARE = 0.05;
export const LANGUAGE_MIN_BYTES = 10_000;

interface Hit {
  repo: GithubRepoSnapshot;
  file: string; // "languages" | manifest path | readme path
  via: GithubEvidence['via'][number];
}

/**
 * GitHub snapshot → skill candidates (research R5, FR-013/FR-014). Deterministic: languages,
 * declared dependencies and README mentions matched against the curated dictionary. Metrics
 * (repo count, last activity) are computed here, never by an LLM. One candidate per evidence
 * file, all sharing the aggregated value, so the fact gets one FactSource per repo/file.
 */
export function snapshotToSkillCandidates(snapshot: GithubSnapshot): Candidate[] {
  const hits = new Map<string, { def: SkillDef; hits: Hit[] }>();
  const add = (def: SkillDef | undefined, hit: Hit) => {
    if (!def) return;
    const entry = hits.get(def.id) ?? { def, hits: [] };
    if (!entry.hits.some((h) => h.repo === hit.repo && h.file === hit.file)) entry.hits.push(hit);
    hits.set(def.id, entry);
  };

  for (const repo of snapshot.repos) {
    const total = repo.languages.reduce((a, l) => a + l.size, 0);
    for (const l of repo.languages) {
      if (l.size >= LANGUAGE_MIN_BYTES || (total > 0 && l.size / total >= LANGUAGE_MIN_SHARE)) {
        add(skillByGithubLanguage(l.name), { repo, file: 'languages', via: 'language' });
      }
    }
    for (const m of repo.manifests) {
      if (!(MANIFEST_FILES as readonly string[]).includes(m.path)) continue;
      for (const dep of parseManifest(m.path, m.text)) add(skillByPackage(dep.ecosystem, dep.name), { repo, file: m.path, via: 'manifest' });
    }
    if (repo.readme) for (const def of findSkillsInText(repo.readme.text)) add(def, { repo, file: repo.readme.path, via: 'readme' });
  }

  const out: Candidate[] = [];
  for (const { def, hits: list } of [...hits.values()].sort((a, b) => a.def.id.localeCompare(b.def.id))) {
    const repos = [...new Set(list.map((h) => h.repo))];
    const last = repos.map((r) => r.pushedAt).filter((d): d is string => Boolean(d)).sort().at(-1) ?? null;
    const evidence: GithubEvidence = {
      repoCount: repos.length,
      lastActivity: last ? last.slice(0, 10) : null,
      repos: repos.map((r) => r.nameWithOwner).sort(),
      forkOnly: repos.every((r) => r.isFork),
      archivedOnly: repos.every((r) => r.isArchived),
      via: [...new Set(list.map((h) => h.via))].sort(),
    };
    const value = { name: def.label, category: def.category, evidence };
    for (const h of list) {
      out.push({
        kind: 'skill',
        key: `skill:${def.id}`,
        value,
        source: {
          origin: 'github',
          ref: `github:${h.repo.nameWithOwner}:${h.file}`,
          rawValue: { repo: h.repo.nameWithOwner, url: h.repo.url, file: h.file, via: h.via, isFork: h.repo.isFork, isArchived: h.repo.isArchived },
        },
      });
    }
  }
  return out;
}
