import type { Queue } from 'bullmq';
import type { Prisma } from '@autoapply/db';
import { MANIFEST_FILES, snapshotToSkillCandidates, type GithubRepoSnapshot, type GithubSnapshot, type ManifestFile } from '@autoapply/kb';
import type { SyncProfilePayload } from '@autoapply/shared';
import { applyImport, countsOf, recordOutcome } from './import-common.js';
import { runEvent, type KbDeps } from './deps.js';

const PAGE_SIZE = 25;
const MAX_BLOB_BYTES = 100_000;
const RATE_LIMIT_FLOOR = 50;
const README_PATHS = ['README.md', 'readme.md', 'README', 'Readme.md', 'README.rst'];

const alias = (path: string) => `f_${path.replace(/[^A-Za-z0-9]/g, '_')}`;
const blob = (path: string) => `${alias(path)}: object(expression: "HEAD:${path}") { ... on Blob { text byteSize } }`;

export const GITHUB_QUERY = `query($login: String!, $cursor: String) {
  rateLimit { remaining resetAt }
  user(login: $login) {
    repositories(first: ${PAGE_SIZE}, after: $cursor, ownerAffiliations: OWNER, orderBy: { field: PUSHED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        nameWithOwner url isFork isArchived isPrivate pushedAt
        languages(first: 20, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name } } }
        ${[...README_PATHS, ...MANIFEST_FILES].map(blob).join('\n        ')}
      }
    }
  }
}`;

type Blob = { text: string | null; byteSize: number } | null;
interface RepoNode {
  nameWithOwner: string;
  url: string;
  isFork: boolean;
  isArchived: boolean;
  isPrivate: boolean;
  pushedAt: string | null;
  languages: { edges: { size: number; node: { name: string } }[] };
  [alias: string]: unknown;
}
interface GqlResponse {
  data?: {
    rateLimit: { remaining: number; resetAt: string };
    user: { repositories: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RepoNode[] } } | null;
  };
  errors?: { message: string; type?: string }[];
}

export class GithubError extends Error {
  constructor(
    readonly code: 'unauthorized' | 'rate_limited' | 'not_found' | 'http_error',
    message: string,
  ) {
    super(message);
  }
}

function toRepo(n: RepoNode): GithubRepoSnapshot {
  const get = (path: string) => {
    const b = n[alias(path)] as Blob;
    return b && b.text !== null && b.byteSize <= MAX_BLOB_BYTES ? b.text : null;
  };
  const readmePath = README_PATHS.find((p) => get(p) !== null);
  return {
    nameWithOwner: n.nameWithOwner,
    url: n.url,
    isFork: n.isFork,
    isArchived: n.isArchived,
    isPrivate: n.isPrivate,
    pushedAt: n.pushedAt,
    languages: n.languages.edges.map((e) => ({ name: e.node.name, size: e.size })),
    readme: readmePath ? { path: readmePath, text: get(readmePath)! } : null,
    manifests: MANIFEST_FILES.flatMap((p) => {
      const text = get(p);
      return text === null ? [] : [{ path: p as ManifestFile, text }];
    }),
  };
}

async function gql(f: typeof fetch, token: string, variables: Record<string, unknown>): Promise<GqlResponse> {
  for (let attempt = 0; ; attempt++) {
    const res = await f('https://api.github.com/graphql', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'autoapply' },
      body: JSON.stringify({ query: GITHUB_QUERY, variables }),
    });
    if (res.status === 401) throw new GithubError('unauthorized', 'GITHUB_TOKEN inválido ou expirado');
    if ((res.status === 403 || res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 2 ** attempt * 1000)); // backoff (constitution §III)
      continue;
    }
    if (res.status === 403 || res.status === 429) throw new GithubError('rate_limited', `GitHub ${res.status}`);
    if (!res.ok) throw new GithubError('http_error', `GitHub ${res.status}: ${await res.text()}`);
    return (await res.json()) as GqlResponse;
  }
}

/** Fetches the user's repositories; stops early (partial) when the rate limit runs low. */
export async function fetchGithubSnapshot(
  f: typeof fetch,
  token: string,
  login: string,
): Promise<{ snapshot: GithubSnapshot; resumeAt: string | null }> {
  const repos: GithubRepoSnapshot[] = [];
  let cursor: string | null = null;
  for (;;) {
    const body = await gql(f, token, { login, cursor });
    if (body.errors?.length) {
      const nf = body.errors.some((e) => e.type === 'NOT_FOUND');
      throw new GithubError(nf ? 'not_found' : 'http_error', body.errors.map((e) => e.message).join('; '));
    }
    const conn = body.data?.user?.repositories;
    if (!conn) throw new GithubError('not_found', `usuário ${login} não encontrado`);
    repos.push(...conn.nodes.map(toRepo));
    const rate = body.data!.rateLimit;
    if (!conn.pageInfo.hasNextPage) return { snapshot: { user: login, fetchedAt: new Date().toISOString(), complete: true, repos }, resumeAt: null };
    if (rate.remaining < RATE_LIMIT_FLOOR) {
      return { snapshot: { user: login, fetchedAt: new Date().toISOString(), complete: false, repos }, resumeAt: rate.resetAt };
    }
    cursor = conn.pageInfo.endCursor;
  }
}

/**
 * import_github (US4): GraphQL snapshot → deterministic skill evidence → unverified facts.
 * Rate-limited → outcome `partial`, ProfileSource.resumeAt set and a delayed re-import queued.
 */
export async function importGithub(
  deps: KbDeps,
  syncRunId: string,
  opts: { queue?: Pick<Queue, 'add'>; actor?: 'import' | 'sync' } = {},
) {
  const { db } = deps;
  const token = process.env.GITHUB_TOKEN;
  const src = await db.profileSource.findUnique({ where: { origin: 'github' } });
  const login = src?.account ?? process.env.GITHUB_USER;
  if (!src?.enabled) {
    await recordOutcome(db, syncRunId, 'github', { status: 'skipped', error: 'source_disabled' });
    return { status: 'skipped' };
  }
  if (!token || !login) {
    await recordOutcome(db, syncRunId, 'github', { status: 'failed', error: 'not_configured' });
    return { status: 'failed' };
  }
  try {
    const { snapshot, resumeAt } = await fetchGithubSnapshot(deps.fetch ?? fetch, token, login);
    const candidates = snapshotToSkillCandidates(snapshot);
    const counts = await applyImport(db, 'github', candidates, { complete: snapshot.complete, actor: opts.actor ?? 'import' });
    const status = snapshot.complete ? 'success' : 'partial';
    await recordOutcome(
      db,
      syncRunId,
      'github',
      { status, error: snapshot.complete ? undefined : 'rate_limited', counts: countsOf(counts) },
      counts,
      { snapshot: snapshot as unknown as Prisma.InputJsonValue, resumeAt: resumeAt ? new Date(resumeAt) : null },
    );
    if (resumeAt && opts.queue) {
      const delay = Math.max(0, new Date(resumeAt).getTime() - Date.now()) + 60_000;
      const payload: SyncProfilePayload = { kind: 'import_github', syncRunId };
      await opts.queue.add(payload.kind, payload, { delay, attempts: 3, backoff: { type: 'exponential', delay: 30_000 } });
    }
    await runEvent(db, 'info', `github import ${status}: ${snapshot.repos.length} repos, ${counts.added.length} new facts`);
    return { status, repos: snapshot.repos.length, ...countsOf(counts) };
  } catch (err) {
    const code = err instanceof GithubError ? err.code : 'error';
    await recordOutcome(db, syncRunId, 'github', { status: 'failed', error: code });
    await runEvent(db, 'error', `github import failed: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof GithubError && err.code !== 'http_error') return { status: 'failed', error: code };
    throw err;
  }
}
