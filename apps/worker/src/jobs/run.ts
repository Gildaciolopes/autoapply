import type { Job as BullJob } from 'bullmq';
import { DiscoverResult, type ProcessRunPayload } from '@autoapply/shared';
import type { Prisma } from '@autoapply/db';
import { runEvent, type KbDeps } from '../kb/deps.js';
import { autoTailor, type EnqueueTailor } from '../tailor/auto.js';
import { scoreJobs } from './score.js';
import { upsertResults } from './upsert.js';

/** Fan-in: all discover children settled → upsert, score, judge, record outcomes. */
export async function processRun(
  deps: KbDeps,
  payload: ProcessRunPayload,
  children: Record<string, unknown>,
  hooks: { enqueueTailor?: EnqueueTailor } = {},
) {
  const { db } = deps;
  try {
    const results = Object.values(children)
      .map((v) => DiscoverResult.safeParse(v))
      .filter((p) => p.success)
      .map((p) => p.data!);
    let jobIds: string[];
    let outcomes: Record<string, unknown> = {};
    if (payload.rescore) {
      jobIds = (await db.job.findMany({ where: { hidden: false }, select: { id: true } })).map((j) => j.id);
    } else {
      const up = await upsertResults(db, payload.runId, results);
      jobIds = up.jobIds;
      outcomes = up.outcomes;
      await runEvent(db, 'info', `run ${payload.runId}: ${results.length} source result(s), ${jobIds.length} job(s) touched`);
    }
    const stats = await scoreJobs(deps, jobIds, { judge: payload.judge, force: payload.rescore });
    for (const [src, n] of Object.entries(stats.filtered)) {
      const o = outcomes[src] as { filtered: number } | undefined;
      if (o) o.filtered = n;
    }
    for (const [src, o] of Object.entries(outcomes)) {
      const out = o as { status: string; error?: string };
      await db.source.updateMany({ where: { type: src as never }, data: { lastRunAt: new Date(), lastStatus: out.status, lastError: out.error ?? null } });
    }
    await db.discoveryRun.update({
      where: { id: payload.runId },
      data: { status: 'done', finishedAt: new Date(), outcomes: outcomes as Prisma.InputJsonValue, judged: stats.judged },
    });
    await runEvent(db, 'info', `run ${payload.runId} done: ${stats.passed} passed, ${stats.judged} judged`);
    if (hooks.enqueueTailor && !payload.rescore) {
      const tailored = await autoTailor(db, hooks.enqueueTailor);
      if (tailored.length) await runEvent(db, 'info', `auto-tailor queued for ${tailored.length} job(s)`);
    }
    return { jobs: jobIds.length, ...stats };
  } catch (err) {
    await db.discoveryRun.update({ where: { id: payload.runId }, data: { status: 'failed', finishedAt: new Date() } });
    throw err;
  }
}

/** Child values keyed by job key; tolerant to BullMQ return shapes. */
export async function childrenOf(job: BullJob): Promise<Record<string, unknown>> {
  return (await job.getChildrenValues()) ?? {};
}
