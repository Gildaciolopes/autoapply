import { missedNight, nightWindow, remainingBudget } from '@autoapply/jobs';
import { localDate } from '@autoapply/kb';
import {
  addStepError,
  loadNightSettings,
  nightCounters,
  nightRunEvent,
  prepareApplication,
  selectNightJobs,
  type NightRun,
  type Prisma,
  type PrismaClient,
} from '@autoapply/db';

/**
 * F6 night state machine (specs/006 research R1). One short, idempotent step per tick; all state lives
 * in Postgres so restarts are free. Never approves anything and never enqueues a submission: approved
 * applications are sent by the F5 submit jobs the user's approval created.
 */

export interface TickDeps {
  db: PrismaClient;
  now: Date;
  /** Starts an F2 discovery flow (trigger `schedule`) and returns its DiscoveryRun id. */
  startDiscovery: () => Promise<{ runId: string }>;
  enqueueApply: (applicationId: string, attempt: number) => Promise<void>;
  /** Removes waiting/delayed `apply` jobs of these applications. */
  removeApplyJobs: (applicationIds: string[]) => Promise<void>;
  enqueueReport: (nightRunId: string) => Promise<void>;
}

export type TickResult =
  | { action: 'idle' | 'paused' | 'already_ran' }
  | { action: 'missed' | 'skipped' | 'started'; runId: string }
  | { action: 'advanced'; runId: string; phase: string; status: string };

const json = (v: unknown) => v as Prisma.InputJsonValue;
const ACTIVE = ['queued', 'tailoring', 'applying'] as const;

const isUnique = (e: unknown) => (e as { code?: string })?.code === 'P2002';

export async function tick(d: TickDeps): Promise<TickResult> {
  const { db, now } = d;
  const s = await loadNightSettings(db);
  // updateMany: the tick must never create the preferences row (that would mark them as saved).
  await db.searchPreference.updateMany({ where: { id: 'default' }, data: { nightLastTickAt: now } });

  if (s.enabled) {
    const missed = missedNight(s.lastTickAt, now, s);
    if (missed) {
      try {
        const run = await db.nightRun.create({
          data: { trigger: 'schedule', scheduleKey: missed.nightDate, nightDate: missed.nightDate, status: 'missed', phase: 'done', budget: s.budget, windowEnd: missed.end, finishedAt: now },
        });
        await nightRunEvent(db, run.id, 'warn', 'missed', 'Noite perdida: o sistema estava desligado durante toda a janela');
        await d.enqueueReport(run.id);
      } catch (e) {
        if (!isUnique(e)) throw e;
      }
    }
  }

  const win = nightWindow(now, s);
  const running = await db.nightRun.findFirst({ where: { status: 'running' }, orderBy: { startedAt: 'asc' } });
  if (running) {
    if (s.pausedAt) return { action: 'paused' };
    // A manual run in progress absorbs tonight's scheduled run (no second run).
    if (s.enabled && win.current && running.trigger === 'manual' && !running.scheduleKey) {
      try {
        await db.nightRun.update({ where: { id: running.id }, data: { scheduleKey: win.current.nightDate } });
        await nightRunEvent(db, running.id, 'info', 'merge', `Execução agendada de ${win.current.nightDate} incorporada a esta execução manual`);
      } catch (e) {
        if (!isUnique(e)) throw e;
      }
    }
    return advance(d, running, s.scoreThreshold);
  }

  if (!s.enabled || !win.current) return { action: 'idle' };
  const key = win.current.nightDate;
  if (await db.nightRun.findUnique({ where: { scheduleKey: key } })) return { action: 'already_ran' };

  if (s.pausedAt) {
    try {
      const run = await db.nightRun.create({
        data: { trigger: 'schedule', scheduleKey: key, nightDate: key, status: 'skipped', phase: 'done', budget: s.budget, windowEnd: win.current.end, finishedAt: now },
      });
      await nightRunEvent(db, run.id, 'warn', 'skipped', 'Sistema pausado (Parar tudo): a noite não começou');
      await d.enqueueReport(run.id);
      return { action: 'skipped', runId: run.id };
    } catch (e) {
      if (isUnique(e)) return { action: 'already_ran' };
      throw e;
    }
  }

  let run: NightRun;
  try {
    run = await db.nightRun.create({
      data: { trigger: 'schedule', scheduleKey: key, nightDate: key, windowEnd: win.current.end, budget: s.budget, startedAt: now },
    });
  } catch (e) {
    if (isUnique(e)) return { action: 'already_ran' };
    throw e;
  }
  await nightRunEvent(db, run.id, 'info', 'start', `Noite de ${key} iniciada (até ${win.current.end.toISOString()}, orçamento ${s.budget})`);
  await startRunDiscovery(d, run);
  return { action: 'started', runId: run.id };
}

/** Discovery step: reuse an F2 run already in progress today, else start one. Failure → step error. */
export async function startRunDiscovery(d: Pick<TickDeps, 'db' | 'startDiscovery' | 'now'>, run: Pick<NightRun, 'id'>) {
  const { db } = d;
  try {
    const existing = await db.discoveryRun.findFirst({ where: { status: 'running', localDate: localDate(d.now) }, orderBy: { startedAt: 'desc' } });
    const runId = existing?.id ?? (await d.startDiscovery()).runId;
    await db.nightRun.update({ where: { id: run.id }, data: { discoveryRunId: runId, phase: 'discovering' } });
    await nightRunEvent(db, run.id, 'info', 'discover', existing ? 'Usando a descoberta já em andamento' : 'Descoberta de vagas iniciada', { discoveryRunId: runId });
  } catch (e) {
    await addStepError(db, run, 'discover', `Descoberta falhou ao iniciar: ${(e as Error).message}`);
    await db.nightRun.update({ where: { id: run.id }, data: { phase: 'discovering', discoveryRunId: null } });
  }
}

async function advance(d: TickDeps, start: NightRun, threshold: number): Promise<TickResult> {
  const { db, now } = d;
  let run = start;
  for (let i = 0; i < 5; i++) {
    const before = run.phase;
    const ended = run.windowEnd !== null && now.getTime() >= run.windowEnd.getTime();
    if (ended && (run.phase === 'discovering' || run.phase === 'preparing' || run.phase === 'waiting')) {
      run = await windowEnd(d, run);
    } else if (run.phase === 'discovering') {
      const dr = run.discoveryRunId ? await db.discoveryRun.findUnique({ where: { id: run.discoveryRunId } }) : null;
      if (dr && dr.status === 'running') break;
      if (dr?.status === 'failed') await addStepError(db, run, 'discover', 'A descoberta de vagas falhou; preparando com as vagas já conhecidas');
      run = await prepare(d, run, threshold);
    } else if (run.phase === 'preparing') {
      const active = await db.application.count({ where: { nightRunId: run.id, status: { in: [...ACTIVE] } } });
      if (active > 0) break;
      await nightRunEvent(db, run.id, 'info', 'prepare', 'Preparação concluída');
      run = await db.nightRun.update({ where: { id: run.id }, data: { phase: 'waiting' } });
    } else if (run.phase === 'waiting') {
      if (run.windowEnd && !ended) break;
      run = await db.nightRun.update({ where: { id: run.id }, data: { phase: 'finishing' } });
    } else if (run.phase === 'finishing') {
      run = await finish(d, run, threshold);
    }
    if (run.phase === before || run.phase === 'done') break;
  }
  if (run.status === 'running') {
    await db.nightRun.update({ where: { id: run.id }, data: { counters: json(await nightCounters(db, run, threshold)) } });
  }
  return { action: 'advanced', runId: run.id, phase: run.phase, status: run.status };
}

async function prepare(d: TickDeps, run: NightRun, threshold: number): Promise<NightRun> {
  const { db } = d;
  const prepared = await db.application.count({ where: { nightRunId: run.id } });
  const jobIds = await selectNightJobs(db, { threshold, take: remainingBudget(run.budget, prepared) });
  let queued = 0;
  for (const jobId of jobIds) {
    // Re-check between jobs: a stop in the middle must not keep queueing (FR-014).
    const prefs = await db.searchPreference.findUnique({ where: { id: 'default' }, select: { pausedAt: true } });
    const cur = await db.nightRun.findUniqueOrThrow({ where: { id: run.id }, select: { status: true } });
    if (prefs?.pausedAt || cur.status !== 'running') break;
    try {
      const app = await prepareApplication(db, jobId, { nightRunId: run.id });
      await d.enqueueApply(app.id, app.attempts);
      queued++;
    } catch (e) {
      await addStepError(db, run, 'prepare', `Vaga ${jobId}: ${(e as Error).message}`);
    }
  }
  await nightRunEvent(db, run.id, 'info', 'prepare', jobIds.length ? `${queued} candidatura(s) na fila de preparação (orçamento ${run.budget})` : 'Nenhuma vaga nova acima do seu limite');
  return db.nightRun.update({ where: { id: run.id }, data: { phase: 'preparing' } });
}

/** Window end (FR-005): nothing new starts; queued leftovers go back for the next night. */
async function windowEnd(d: TickDeps, run: NightRun): Promise<NightRun> {
  const { db } = d;
  const left = await db.application.findMany({ where: { nightRunId: run.id, status: 'queued' }, select: { id: true } });
  const ids = left.map((a) => a.id);
  if (ids.length) {
    await d.removeApplyJobs(ids);
    await db.application.updateMany({
      where: { id: { in: ids }, status: 'queued' },
      data: { status: 'skipped', needsReasons: json([{ code: 'window_end', message: 'ficou para a próxima noite (fim da janela)' }]), needsReason: 'fim da janela' },
    });
  }
  await nightRunEvent(db, run.id, 'info', 'window_end', ids.length ? `Fim da janela: ${ids.length} candidatura(s) ficam para a próxima noite` : 'Fim da janela');
  return db.nightRun.update({ where: { id: run.id }, data: { phase: 'finishing', pending: json(ids) } });
}

async function finish(d: TickDeps, run: NightRun, threshold: number): Promise<NightRun> {
  const { db, now } = d;
  const finished = { ...run, finishedAt: now };
  const counters = await nightCounters(db, finished, threshold);
  const errors = (run.stepErrors as unknown[]).length;
  const status = errors && counters.prepared === 0 && counters.found === 0 ? 'failed' : errors || counters.windowEnd ? 'partial' : 'ok';
  const done = await db.nightRun.updateMany({
    where: { id: run.id, status: 'running' },
    data: { status, phase: 'done', finishedAt: now, counters: json(counters) },
  });
  if (done.count) {
    await nightRunEvent(db, run.id, status === 'ok' ? 'info' : 'warn', 'end', `Noite encerrada: ${status}`);
    await d.enqueueReport(run.id);
  }
  return db.nightRun.findUniqueOrThrow({ where: { id: run.id } });
}
