import { localDate } from '@autoapply/kb';
import { planDiscovery } from '@autoapply/jobs';
import { Preferences, QUEUES, type JobSourceType, type ProcessRunPayload } from '@autoapply/shared';
import type { PrismaClient } from './generated/prisma/client.js';

/** Start of the current local day (America/Sao_Paulo, UTC−3, no DST since 2019). */
export function localMidnight(now = new Date()): Date {
  return new Date(`${localDate(now)}T00:00:00-03:00`);
}

export async function loadPreferences(db: PrismaClient): Promise<Preferences> {
  const row = await db.searchPreference.findUnique({ where: { id: 'default' } });
  if (!row) return Preferences.parse({});
  return Preferences.parse({
    roles: row.roles,
    seniority: row.seniority,
    stack: row.stack,
    locations: row.locations,
    workModes: row.workModes,
    minSalary: row.minSalary,
    minSalaryContract: row.minSalaryContract,
    blockedCompanies: row.blockedCompanies,
    excludeKeywords: row.excludeKeywords,
    judgeTopN: row.judgeTopN,
    autoDiscover: row.autoDiscover,
    discoveryCron: row.discoveryCron,
    autoTailor: row.autoTailor,
    autoTailorN: row.autoTailorN,
    applyConfidence: row.applyConfidence,
    mode: row.mode,
    scoreThreshold: row.scoreThreshold,
    saved: true,
  });
}

/** Remaining daily budget per source = cap − NEW origins taken today (research R9). */
export async function sourceBudgets(db: PrismaClient, now = new Date()) {
  const since = localMidnight(now);
  const sources = await db.source.findMany({ orderBy: { type: 'asc' } });
  const used = await db.jobOrigin.groupBy({ by: ['source'], where: { firstSeenAt: { gte: since } }, _count: { _all: true } });
  const usedBy = new Map(used.map((u) => [u.source, u._count._all]));
  return sources.map((s) => {
    const usedToday = usedBy.get(s.type) ?? 0;
    return { row: s, type: s.type as JobSourceType, enabled: s.enabled, dailyCap: s.dailyCap, usedToday, remaining: Math.max(0, s.dailyCap - usedToday) };
  });
}

export const DISCOVER_CHILD_OPTS = {
  attempts: 2,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  ignoreDependencyOnFailure: true,
  removeOnComplete: 500,
  removeOnFail: 500,
};

/** Structural subset of bullmq's FlowProducer (keeps this package free of bullmq). */
export interface FlowAdder {
  add(flow: {
    name: string;
    queueName: string;
    data: unknown;
    opts?: Record<string, unknown>;
    children?: { name: string; queueName: string; data: unknown; opts?: Record<string, unknown> }[];
  }): Promise<unknown>;
}

/** Creates the DiscoveryRun and enqueues its flow (contracts/queues.md). Used by API and worker. */
export async function startDiscoveryFlow(db: PrismaClient, flows: FlowAdder, trigger: 'manual' | 'schedule' | 'rescore', opts: { judge?: boolean } = {}) {
  const prefs = await loadPreferences(db);
  const run = await db.discoveryRun.create({ data: { trigger, localDate: localDate() } });
  const children = trigger === 'rescore' ? [] : planDiscovery(run.id, prefs, (await sourceBudgets(db)).filter((b) => b.type !== ('jobspy' as never)));
  const data: ProcessRunPayload = { runId: run.id, rescore: trigger === 'rescore', judge: opts.judge ?? true };
  await flows.add({
    name: 'process-run',
    queueName: QUEUES.score,
    data,
    opts: { removeOnComplete: 200, removeOnFail: 200 },
    children: children.map((c) => ({ ...c, opts: DISCOVER_CHILD_OPTS })),
  });
  return { runId: run.id, children: children.length };
}
