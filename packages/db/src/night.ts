import { emptyCounters } from '@autoapply/jobs';
import type { NightCounters } from '@autoapply/shared';
import type { Application, NightRun, Prisma, PrismaClient } from './generated/prisma/client.js';

/** F6 shared DB logic: used by the api (manual actions) and the worker night tick, so both agree. */

const json = (v: unknown) => v as Prisma.InputJsonValue;

export const RUNNING_STATUSES = ['queued', 'tailoring', 'applying', 'submitting'] as const;

export interface NightSettingsRow {
  enabled: boolean;
  start: string;
  end: string;
  days: number[];
  budget: number;
  pausedAt: Date | null;
  lastTickAt: Date | null;
  telegramOffset: number;
  scoreThreshold: number;
}

export async function loadNightSettings(db: PrismaClient): Promise<NightSettingsRow> {
  const r = await db.searchPreference.findUnique({ where: { id: 'default' } });
  return {
    enabled: r?.nightEnabled ?? false,
    start: r?.nightStart ?? '23:00',
    end: r?.nightEnd ?? '06:59',
    days: r?.nightDays ?? [0, 1, 2, 3, 4, 5, 6],
    budget: r?.nightBudget ?? 20,
    pausedAt: r?.pausedAt ?? null,
    lastTickAt: r?.nightLastTickAt ?? null,
    telegramOffset: r?.telegramOffset ?? 0,
    scoreThreshold: r?.scoreThreshold ?? 70,
  };
}

/** Writes to the single preferences row (creates it with defaults when missing). */
export function updateNightRow(db: PrismaClient, data: Prisma.SearchPreferenceUpdateInput) {
  return db.searchPreference.upsert({ where: { id: 'default' }, create: { id: 'default', ...(data as Prisma.SearchPreferenceCreateInput) }, update: data });
}

export type PrepareErrorCode = 'not_found' | 'no_apply_url' | 'already_running' | 'already_submitted' | 'rejected';

export class PrepareError extends Error {
  constructor(
    readonly code: PrepareErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * (Re)starts the dry-run preparation of a job: creates or resets its application (always dropping a
 * previous approval: what was approved may change). The caller enqueues the `apply` job.
 */
export async function prepareApplication(db: PrismaClient, jobId: string, opts: { nightRunId?: string } = {}): Promise<Application> {
  const job = await db.job.findUnique({ where: { id: jobId }, include: { application: true } });
  if (!job) throw new PrepareError('not_found', 'vaga não encontrada');
  if (!job.applyUrl && !job.url) throw new PrepareError('no_apply_url', 'vaga sem endereço de candidatura');
  const a = job.application;
  if (a && (RUNNING_STATUSES as readonly string[]).includes(a.status)) throw new PrepareError('already_running', 'simulação já em andamento');
  if (a && ['submitted', 'submit_uncertain'].includes(a.status)) throw new PrepareError('already_submitted', 'candidatura já enviada (ou envio incerto)');
  if (a && a.status === 'rejected') throw new PrepareError('rejected', 'vaga rejeitada por você');
  const night = opts.nightRunId ? { nightRunId: opts.nightRunId } : {};
  return db.application.upsert({
    where: { jobId },
    create: { jobId, mode: 'dry_run', status: 'queued', attempts: 1, ...night },
    update: {
      mode: 'dry_run',
      status: 'queued',
      attempts: { increment: 1 },
      error: null,
      needsReasons: json([]),
      needsReason: null,
      approvedAt: null,
      approvalHash: null,
      ...night,
    },
  });
}

/**
 * Night candidates (research R4): best scored, above threshold, never prepared, or left over at the
 * end of a previous window. Never rejected / sent / waiting for the user / cancelled by the kill switch.
 */
export async function selectNightJobs(db: PrismaClient, opts: { threshold: number; take: number }) {
  if (opts.take <= 0) return [];
  const jobs = await db.job.findMany({
    where: {
      hidden: false,
      OR: [{ applyUrl: { not: null } }, { url: { not: '' } }],
      score: { is: { passed: true, score: { gte: opts.threshold } } },
      AND: [
        {
          OR: [
            { application: { is: null } },
            { application: { is: { status: 'skipped', needsReasons: { array_contains: [{ code: 'window_end' }] } } } },
          ],
        },
      ],
    },
    orderBy: [{ score: { score: 'desc' } }],
    take: opts.take,
    select: { id: true },
  });
  return jobs.map((j) => j.id);
}

export async function nightRunEvent(db: PrismaClient, nightRunId: string, level: 'info' | 'warn' | 'error', step: string, message: string, data?: Record<string, unknown>) {
  await db.runEvent.create({ data: { queue: 'night', nightRunId, level, message, data: json({ step, ...(data ?? {}) }) } });
}

export async function addStepError(db: PrismaClient, run: Pick<NightRun, 'id'>, step: string, message: string) {
  const cur = await db.nightRun.findUniqueOrThrow({ where: { id: run.id }, select: { stepErrors: true } });
  const list = (cur.stepErrors as unknown[]) ?? [];
  await db.nightRun.update({ where: { id: run.id }, data: { stepErrors: json([...list, { step, message, at: new Date().toISOString() }]) } });
  await nightRunEvent(db, run.id, 'error', step, message);
}

const hasCode = (codes: string[]) => ({ OR: codes.map((code) => ({ needsReasons: { array_contains: [{ code }] } })) });

/** Counters of a night (FR-016), computed from the DB so they match what the user sees. */
export async function nightCounters(db: PrismaClient, run: Pick<NightRun, 'id' | 'startedAt' | 'finishedAt'>, threshold: number): Promise<NightCounters> {
  const end = run.finishedAt ?? new Date();
  const window = { gte: run.startedAt, lte: end };
  const mine = { nightRunId: run.id };
  const [found, aboveThreshold, prepared, ready, needsInput, failed, submitted, uncertain, waitingLimit, windowEnd] = await Promise.all([
    db.job.count({ where: { createdAt: window } }),
    db.job.count({ where: { createdAt: window, score: { is: { passed: true, score: { gte: threshold } } } } }),
    db.application.count({ where: mine }),
    db.application.count({ where: { ...mine, status: 'ready' } }),
    db.application.count({ where: { ...mine, status: 'needs_input' } }),
    db.application.count({ where: { ...mine, status: 'failed' } }),
    db.application.count({ where: { submittedAt: window, status: 'submitted' } }),
    db.application.count({ where: { ...mine, status: 'submit_uncertain' } }),
    db.application.count({ where: { status: 'approved', ...hasCode(['daily_cap', 'platform_paused']) } }),
    db.application.count({ where: { ...mine, status: 'skipped', ...hasCode(['window_end']) } }),
  ]);
  return { ...emptyCounters(), found, aboveThreshold, prepared, ready, needsInput, failed, submitted, uncertain, waitingLimit, windowEnd };
}

/**
 * Global kill switch (FR-013): pause scheduling, stop the running night, cancel queued work and
 * approvals (F5). The caller removes queue jobs first (`removeJobs`) and enqueues the report.
 */
export async function stopEverything(db: PrismaClient, opts: { removeJobs?: () => Promise<number>; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const removed = opts.removeJobs ? await opts.removeJobs() : 0;
  await updateNightRow(db, { pausedAt: now });
  const reason = [{ code: 'cancelled', message: 'cancelado' }];
  const r = await db.application.updateMany({
    where: { status: { in: ['queued', 'tailoring', 'applying'] } },
    data: { status: 'skipped', needsReasons: json(reason), needsReason: 'cancelado' },
  });
  const a = await db.application.updateMany({
    where: { status: 'approved' },
    data: { status: 'ready', approvedAt: null, approvalHash: null, needsReasons: json(reason), needsReason: 'envio cancelado' },
  });
  const running = await db.nightRun.findFirst({ where: { status: 'running' } });
  if (running) {
    await db.nightRun.update({ where: { id: running.id }, data: { status: 'stopped', phase: 'done', finishedAt: now } });
    await nightRunEvent(db, running.id, 'warn', 'stop', 'Parado pelo usuário (Parar tudo)');
  }
  return { cancelled: r.count + a.count, removedJobs: removed, runStopped: running?.id ?? null };
}

/** Resume only re-enables scheduling; nothing stopped earlier restarts (FR-015). */
export async function resumeEverything(db: PrismaClient) {
  await updateNightRow(db, { pausedAt: null });
}
