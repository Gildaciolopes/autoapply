import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetJobs, type FlowAdder } from '@autoapply/db';
import { Preferences } from '@autoapply/shared';
import { DiscoveryService } from '../src/jobs/discovery.service.js';
import { FeedService } from '../src/jobs/feed.service.js';
import { PreferencesService } from '../src/jobs/preferences.service.js';
import { JobSourcesService } from '../src/jobs/sources.service.js';
import { apiError, db, fakeQueue, prisma, reset } from './helpers.js';

let queue: ReturnType<typeof fakeQueue> & { removed: string[]; removeJobScheduler(id: string): Promise<void> };
let prefs: PreferencesService;
let sources: JobSourcesService;
let feed: FeedService;
let flows: { added: Parameters<FlowAdder['add']>[0][] } & FlowAdder;

beforeEach(async () => {
  await reset();
  await resetJobs(db);
  const q = fakeQueue();
  queue = Object.assign(q, { removed: [] as string[], async removeJobScheduler(id: string) { this.removed.push(id); } });
  prefs = new PreferencesService(prisma, queue as never);
  sources = new JobSourcesService(prisma);
  await sources.onModuleInit();
  feed = new FeedService(prisma, prefs);
  flows = { added: [], async add(f) { this.added.push(f); return {}; } };
});
afterAll(() => db.$disconnect());

const P = (over: Partial<Preferences> = {}) => Preferences.parse({ roles: ['Desenvolvedor Full Stack'], workModes: ['remote'], ...over });

async function job(company: string, title: string, score: number, over: Record<string, unknown> = {}) {
  const src = await db.source.findUniqueOrThrow({ where: { type: 'gupy' } });
  const c = await db.company.upsert({ where: { name: company }, create: { name: company }, update: {} });
  return db.job.create({
    data: {
      sourceId: src.id,
      url: `https://x/${company}/${title}`,
      title,
      companyId: c.id,
      remote: true,
      workMode: 'remote',
      dedupeHash: `${company}|${title}`,
      ...over,
      score: { create: { score, passed: true, judged: score > 70, matched: [], missing: [], reasons: '', model: 't' } },
      origins: { create: { source: 'gupy', externalId: `${company}-${title}`, url: 'https://x' } },
    },
  });
}

describe('preferences & sources (US1)', () => {
  it('defaults unsaved; save persists; scheduler follows autoDiscover', async () => {
    expect((await prefs.get()).saved).toBe(false);
    await prefs.put(P({ autoDiscover: true }));
    expect(await prefs.get()).toMatchObject({ saved: true, roles: ['Desenvolvedor Full Stack'], judgeTopN: 20 });
    expect(queue.added).toHaveLength(0); // upsertJobScheduler, not add
    await prefs.put(P({ autoDiscover: false }));
    expect(queue.removed).toEqual(['discovery-daily']);
  });

  it('suggest uses only verified facts and saves nothing', async () => {
    await db.fact.create({ data: { kind: 'experience', key: 'experience:a:2020', value: { company: 'A', title: 'Dev Verificado', start: { year: 2020, precision: 'year' }, end: 'present' }, verifiedByUser: true, sources: { create: { origin: 'resume', ref: 'r', rawValue: {} } } } });
    await db.fact.create({ data: { kind: 'experience', key: 'experience:b:2022', value: { company: 'B', title: 'Dev Não Verificado', start: { year: 2022, precision: 'year' }, end: 'present' }, verifiedByUser: false, sources: { create: { origin: 'linkedin', ref: 'l', rawValue: {} } } } });
    expect((await prefs.suggest()).roles).toEqual(['Dev Verificado']);
    expect(await db.searchPreference.count()).toBe(0);
  });

  it('sources seeded; LinkedIn needs terms; caps validated by schema', async () => {
    const list = await sources.list();
    expect(list.map((s) => [s.type, s.enabled, s.dailyCap])).toEqual(
      expect.arrayContaining([['gupy', true, 50], ['linkedin_mcp', false, 15]]),
    );
    expect(await apiError(sources.patch('linkedin_mcp', { enabled: true }))).toMatchObject({ status: 409, code: 'terms_required' });
    expect((await sources.patch('linkedin_mcp', { enabled: true, acceptTerms: true })).enabled).toBe(true);
    expect((await sources.patch('gupy', { dailyCap: 5 })).dailyCap).toBe(5);
    await sources.onModuleInit(); // re-seed never overwrites
    expect((await sources.list()).find((s) => s.type === 'gupy')!.dailyCap).toBe(5);
  });
});

describe('discovery (US2)', () => {
  it('needs roles; builds a flow with one child per (enabled source, role); blocks concurrent runs', async () => {
    const svc = new DiscoveryService(prisma, flows);
    expect(await apiError(svc.start())).toMatchObject({ status: 412, code: 'no_preferences' });
    await prefs.put(P({ roles: ['Dev Full Stack', 'Engenheiro de Software'] }));
    const { runId } = await svc.start();
    const f = flows.added[0]!;
    expect(f).toMatchObject({ name: 'process-run', queueName: 'score', data: { runId } });
    expect(f.children!.map((c) => c.name).sort()).toEqual(
      ['gupy', 'indeed', 'glassdoor', 'google_jobs'].flatMap((s) => [`${s}:Dev Full Stack`, `${s}:Engenheiro de Software`]).sort(),
    );
    expect(f.children!.find((c) => c.name.startsWith('indeed'))!).toMatchObject({ queueName: 'discover-jobspy', data: { limit: 25 } });
    expect(f.children![0]!.opts).toMatchObject({ ignoreDependencyOnFailure: true });
    expect(await apiError(svc.start())).toMatchObject({ status: 409, code: 'run_in_progress' });
  });
});

describe('feed (US4)', () => {
  it('orders by score, hides filtered/hidden, persists actions, blocks a company', async () => {
    await prefs.put(P({ excludeKeywords: ['php'] }));
    const a = await job('Acme', 'Desenvolvedor Full Stack', 90);
    await job('Beta', 'Desenvolvedor Full Stack', 60);
    const c = await job('Gama', 'Desenvolvedor Full Stack', 75, { lastSeenAt: new Date(Date.now() - 20 * 86400_000) });
    await db.jobScore.update({ where: { jobId: c.id }, data: {} });
    const filtered = await job('Delta', 'Desenvolvedor Full Stack PHP', 0);
    await db.jobScore.update({ where: { jobId: filtered.id }, data: { passed: false, filterReason: 'excluded_keyword' } });

    const page = await feed.list({ limit: 50 });
    expect(page.items.map((i) => i.company)).toEqual(['Acme', 'Gama', 'Beta']);
    expect(page.items.find((i) => i.company === 'Gama')!.possiblyClosed).toBe(true);
    expect((await feed.list({ limit: 50, showFiltered: 'true' })).items.map((i) => i.company)).toContain('Delta');
    expect((await feed.list({ limit: 1 })).nextCursor).toBe(1);

    await feed.patch(a.id, { interesting: true });
    expect((await feed.list({ limit: 50, interesting: 'true' })).items.map((i) => i.company)).toEqual(['Acme']);
    await feed.patch(a.id, { hidden: true });
    expect((await feed.list({ limit: 50 })).items.map((i) => i.company)).toEqual(['Gama', 'Beta']);

    const r = await feed.blockCompany((await db.job.findFirstOrThrow({ where: { company: { name: 'Beta' } } })).id);
    expect(r).toEqual({ company: 'Beta', hiddenJobs: 1 });
    expect((await prefs.get()).blockedCompanies).toEqual(['Beta']);
    expect((await feed.list({ limit: 50 })).items.map((i) => i.company)).toEqual(['Gama']);
  });

  it('job detail resolves matched evidence to usable facts only', async () => {
    const f = await db.fact.create({ data: { kind: 'skill', key: 'skill:typescript', value: { name: 'TypeScript' }, verifiedByUser: true, sources: { create: { origin: 'resume', ref: 'r', rawValue: {} } } } });
    const j = await job('Acme', 'Dev', 80);
    await db.jobScore.update({ where: { jobId: j.id }, data: { matchedEvidence: [{ skill: 'TypeScript', factIds: [f.id, 'gone'] }] } });
    const d = await feed.get(j.id);
    expect(d.matchedEvidence).toEqual([{ skill: 'TypeScript', facts: [{ id: f.id, kind: 'skill', summary: 'TypeScript' }] }]);
  });
});
