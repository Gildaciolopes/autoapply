import { buildReport, formatReport, sendTelegramMessage, telegramConfig, type TelegramConfig } from '@autoapply/jobs';
import { loadNightSettings, nightCounters, type Prisma, type PrismaClient } from '@autoapply/db';
import type { NightAlert, NightReport } from '@autoapply/shared';

/** F6 morning report (FR-016..FR-018): counts, titles and companies only, never personal data. */

const json = (v: unknown) => v as Prisma.InputJsonValue;
const PLATFORM_LABEL: Record<string, string> = { gupy: 'Gupy', linkedin: 'LinkedIn', greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', generic: 'sites diversos' };
const PAUSE_LABEL: Record<string, string> = { errors: 'erros seguidos', unusual_activity: 'atividade incomum detectada', manual: 'pausa manual' };

export const webOrigin = () => process.env.WEB_ORIGIN ?? 'http://localhost:3000';

export async function buildNightReport(db: PrismaClient, runId: string, now = new Date()): Promise<NightReport> {
  const run = await db.nightRun.findUniqueOrThrow({ where: { id: runId } });
  const s = await loadNightSettings(db);
  const alerts: NightAlert[] = [];

  for (const p of await db.platform.findMany({ orderBy: { kind: 'asc' } })) {
    const name = PLATFORM_LABEL[p.kind] ?? p.kind;
    if (p.sessionStatus === 'expired') alerts.push({ kind: 'session_expired', message: `Sessão do ${name} expirou: reconecte em Plataformas.` });
    const paused = p.pauseReason && (!p.pausedUntil || p.pausedUntil.getTime() > now.getTime());
    if (paused) alerts.push({ kind: 'platform_paused', message: `${name} pausado (${PAUSE_LABEL[p.pauseReason!] ?? p.pauseReason})${p.pausedUntil ? '' : ': retome em Plataformas.'}` });
  }
  if (run.status === 'stopped') alerts.push({ kind: 'stopped', message: 'Execução parada por você (Parar tudo). Envie "retomar" para voltar a agendar.' });
  if (run.status === 'skipped') alerts.push({ kind: 'skipped', message: 'Sistema pausado: a noite não rodou. Envie "retomar" para voltar a agendar.' });
  if (run.status === 'missed') alerts.push({ kind: 'missed', message: 'Noite perdida: o computador estava desligado ou dormindo durante a janela.' });
  if (run.status === 'failed') alerts.push({ kind: 'failed', message: 'A noite falhou: veja os erros em Noite.' });
  const errors = (run.stepErrors as unknown[]).length;
  if (run.status === 'partial') alerts.push({ kind: 'partial', message: `Execução parcial${errors ? ` (${errors} erro(s))` : ''}: veja os detalhes em Noite.` });

  const counters = await nightCounters(db, run, s.scoreThreshold);
  const top = await db.application.findMany({
    where: { nightRunId: run.id, status: 'ready' },
    include: { job: { select: { title: true, company: { select: { name: true } }, score: { select: { score: true } } } } },
    orderBy: { job: { score: { score: 'desc' } } },
    take: 5,
  });
  const report = buildReport({
    counters,
    alerts,
    top: top.map((a) => ({ title: a.job.title, company: a.job.company?.name ?? '—', score: a.job.score?.score ?? 0 })),
    link: `${webOrigin()}/revisao?run=${run.id}`,
  });
  await db.nightRun.update({ where: { id: run.id }, data: { report: json(report), counters: json(counters) } });
  return report;
}

/**
 * Sends the report once (FR-017). Not configured → `not_configured`. Failure → throws for a BullMQ
 * retry, and on the final attempt records `not_sent` (the run itself is never affected).
 */
export async function deliverReport(
  db: PrismaClient,
  runId: string,
  opts: { final: boolean; fetchImpl?: typeof fetch; config?: TelegramConfig | null; now?: Date },
): Promise<'sent' | 'not_configured' | 'not_sent' | 'already_sent'> {
  const run = await db.nightRun.findUniqueOrThrow({ where: { id: runId } });
  if (run.reportStatus === 'sent') return 'already_sent';
  const report = await buildNightReport(db, runId, opts.now);
  const cfg = opts.config === undefined ? telegramConfig() : opts.config;
  if (!cfg) {
    await db.nightRun.update({ where: { id: runId }, data: { reportStatus: 'not_configured' } });
    return 'not_configured';
  }
  try {
    await sendTelegramMessage(cfg, formatReport(report, run.nightDate), opts.fetchImpl ?? fetch);
    await db.nightRun.update({ where: { id: runId }, data: { reportStatus: 'sent', reportSentAt: new Date(), reportError: null } });
    return 'sent';
  } catch (e) {
    if (!opts.final) throw e;
    await db.nightRun.update({ where: { id: runId }, data: { reportStatus: 'not_sent', reportError: (e as Error).message } });
    return 'not_sent';
  }
}
