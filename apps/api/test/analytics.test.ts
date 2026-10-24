import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetJobs } from '@autoapply/db';
import { FunnelQuery } from '@autoapply/shared';
import { AnalyticsService } from '../src/analytics/analytics.service.js';
import { db, prisma, reset } from './helpers.js';

const NOW = new Date('2026-10-24T12:00:00Z'); // Saturday; current week starts Mon 2026-10-19
const d = (iso: string) => new Date(iso);
let svc: AnalyticsService;
let n = 0;

async function job(o: {
  source: 'gupy' | 'greenhouse';
  seen: string;
  score?: number;
  passed?: boolean;
  missing?: string[];
  app?: Record<string, unknown>;
  replies?: { type: 'interview' | 'rejection' | 'confirmation' | 'other'; at: string }[];
}) {
  n++;
  const src = (await db.source.findUnique({ where: { type: o.source } })) ?? (await db.source.create({ data: { type: o.source, enabled: true } }));
  const j = await db.job.create({ data: { sourceId: src.id, url: `https://x.local/${n}`, title: `Dev ${n}`, dedupeHash: `h${n}`, firstSeenAt: d(o.seen) } });
  if (o.score !== undefined) {
    await db.jobScore.create({ data: { jobId: j.id, score: o.score, passed: o.passed ?? true, reasons: '', model: 't', missing: o.missing ?? [] } });
  }
  if (o.app) {
    const a = await db.application.create({ data: { jobId: j.id, mode: 'review', ...o.app } });
    for (const r of o.replies ?? []) await db.reply.create({ data: { applicationId: a.id, origin: 'manual', type: r.type, receivedAt: d(r.at) } });
  }
  return j;
}

beforeEach(async () => {
  await reset();
  await resetJobs(db);
  await db.searchPreference.create({ data: { id: 'default', scoreThreshold: 70 } });
  svc = new AnalyticsService(prisma);
  n = 0;
});
afterAll(async () => {
  await db.$disconnect();
});

async function seed() {
  // Week of 2026-10-12 (cohort): found in week 1, submitted and answered weeks later still count here.
  await job({ source: 'gupy', seen: '2026-10-13T12:00:00Z', score: 90, missing: ['Kubernetes', 'go'],
    app: { status: 'submitted', platform: 'gupy', preparedAt: d('2026-10-14T00:00:00Z'), approvedAt: d('2026-10-14T10:00:00Z'), submittedAt: d('2026-10-15T00:00:00Z'), firstReplyAt: d('2026-10-17T00:00:00Z'), interviewAt: d('2026-10-17T00:00:00Z'), outcome: 'interview' },
    replies: [{ type: 'confirmation', at: '2026-10-15T01:00:00Z' }, { type: 'interview', at: '2026-10-17T00:00:00Z' }] });
  await job({ source: 'gupy', seen: '2026-10-14T12:00:00Z', score: 80, missing: ['kubernetes'],
    app: { status: 'submitted', platform: 'gupy', preparedAt: d('2026-10-15T00:00:00Z'), approvedAt: d('2026-10-15T00:00:00Z'), submittedAt: d('2026-10-16T00:00:00Z'), firstReplyAt: d('2026-10-20T00:00:00Z'), outcome: 'declined' },
    replies: [{ type: 'rejection', at: '2026-10-20T00:00:00Z' }] });
  // Rejected by the user after preparing: counts up to "prepared" only.
  await job({ source: 'greenhouse', seen: '2026-10-20T12:00:00Z', score: 75, missing: ['Kubernetes'],
    app: { status: 'rejected', platform: 'greenhouse', preparedAt: d('2026-10-21T00:00:00Z'), rejectedAt: d('2026-10-21T01:00:00Z') } });
  // Submitted, no reply yet.
  await job({ source: 'greenhouse', seen: '2026-10-21T12:00:00Z', score: 72,
    app: { status: 'submitted', platform: 'greenhouse', preparedAt: d('2026-10-22T00:00:00Z'), approvedAt: d('2026-10-22T00:00:00Z'), submittedAt: d('2026-10-23T00:00:00Z') } });
  // Below threshold / filtered / unscored.
  await job({ source: 'gupy', seen: '2026-10-21T12:00:00Z', score: 50, missing: ['php'] });
  await job({ source: 'greenhouse', seen: '2026-10-22T12:00:00Z', score: 95, passed: false });
  await job({ source: 'gupy', seen: '2026-10-22T13:00:00Z' });
  // Outside the 8-week period.
  await job({ source: 'gupy', seen: '2026-06-01T12:00:00Z', score: 99, app: { status: 'submitted', submittedAt: d('2026-06-02T00:00:00Z') } });
}

describe('analytics funnel (F7 US1, FR-001..FR-005)', () => {
  it('cohort counts, rates, response rate, median, reply types, missing skills', async () => {
    await seed();
    const v = await svc.funnel(FunnelQuery.parse({}), NOW);
    expect(v.weeks).toBe(8);
    expect(v.threshold).toBe(70);
    expect(v.totals).toEqual({ found: 7, above_threshold: 4, prepared: 4, approved: 3, submitted: 3, replied: 2, interview: 1 });
    expect(v.rates.found).toBeNull();
    expect(v.rates.above_threshold).toBeCloseTo(4 / 7);
    expect(v.rates.approved).toBeCloseTo(0.75);
    expect(v.responseRate).toBeCloseTo(2 / 3);
    expect(v.medianDaysToReply).toBe(3); // 2 days and 4 days
    expect(v.replyTypes).toEqual({ interview: 1, rejection: 1, info_request: 0, confirmation: 1, other: 0 });
    expect(v.missingSkills[0]).toEqual({ skill: 'Kubernetes', count: 3 });
    expect(v.missingSkills.map((s) => s.skill)).not.toContain('php'); // below threshold
    expect(v.buckets).toEqual([]);
  });

  it('splits add up to the totals; week split lists every week oldest first', async () => {
    await seed();
    for (const split of ['source', 'platform', 'week'] as const) {
      const v = await svc.funnel(FunnelQuery.parse({ split }), NOW);
      const sum = v.buckets.reduce((acc, b) => acc + b.counts.found, 0);
      expect(sum, split).toBe(v.totals.found);
      expect(v.buckets.reduce((acc, b) => acc + b.counts.submitted, 0), split).toBe(v.totals.submitted);
    }
    const bySource = await svc.funnel(FunnelQuery.parse({ split: 'source' }), NOW);
    expect(bySource.buckets.find((b) => b.key === 'gupy')).toMatchObject({ label: 'Gupy', counts: { found: 4, submitted: 2, interview: 1 } });
    const byPlatform = await svc.funnel(FunnelQuery.parse({ split: 'platform' }), NOW);
    expect(byPlatform.buckets.find((b) => b.key === 'none')?.counts.found).toBe(3);
    const byWeek = await svc.funnel(FunnelQuery.parse({ split: 'week' }), NOW);
    expect(byWeek.buckets).toHaveLength(8);
    expect(byWeek.buckets.at(-1)).toMatchObject({ key: '2026-10-19', label: '19/10', counts: { found: 5 } });
    expect(byWeek.buckets.at(-2)).toMatchObject({ key: '2026-10-12', counts: { found: 2, submitted: 2, replied: 2 } });
  });

  it('empty period: zeros and null rates', async () => {
    const v = await svc.funnel(FunnelQuery.parse({ weeks: '4' }), NOW);
    expect(v.totals.found).toBe(0);
    expect(v.rates.above_threshold).toBeNull();
    expect(v.responseRate).toBeNull();
    expect(v.medianDaysToReply).toBeNull();
    expect(v.missingSkills).toEqual([]);
  });

  it('query validation', () => {
    expect(() => FunnelQuery.parse({ weeks: '53' })).toThrow();
    expect(() => FunnelQuery.parse({ split: 'company' })).toThrow();
  });
});
