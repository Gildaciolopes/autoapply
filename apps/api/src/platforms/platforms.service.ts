import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PLATFORM_DEFAULTS } from '@autoapply/apply';
import { ensurePlatform, platformUsage, type Platform, type Prisma } from '@autoapply/db';
import { PlatformKind, QUEUES, SESSION_PLATFORMS, type PlatformLimitsBody, type PlatformView } from '@autoapply/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiError } from '../kb/api-error.js';

const isSessionKind = (k: string): k is 'gupy' | 'linkedin' => (SESSION_PLATFORMS as readonly string[]).includes(k);
const keyOk = () => /^[0-9a-f]{64}$/i.test(process.env.SESSION_ENCRYPTION_KEY ?? '');

/** F5 platforms: sessions (connect/test/disconnect), LinkedIn opt-in, caps, pause (specs/005 contracts). */
@Injectable()
export class PlatformsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUES.apply) private readonly queue: Queue,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  private parseKind(kind: string) {
    const k = PlatformKind.safeParse(kind);
    if (!k.success) throw new ApiError(404, 'not_found', 'plataforma desconhecida');
    return k.data;
  }

  /** Earliest delayed job per platform (when gated actions will run). */
  private async nextRuns(): Promise<Map<string, Date>> {
    const out = new Map<string, Date>();
    const jobs = await this.queue.getJobs(['delayed']).catch(() => []);
    const ids = jobs.map((j) => (j?.data as { applicationId?: string } | undefined)?.applicationId).filter((x): x is string => Boolean(x));
    const apps = ids.length ? await this.db.application.findMany({ where: { id: { in: ids } }, select: { id: true, platform: true } }) : [];
    const plat = new Map(apps.map((a) => [a.id, a.platform]));
    for (const j of jobs) {
      const p = plat.get((j?.data as { applicationId?: string }).applicationId ?? '');
      if (!p || !j) continue;
      const at = new Date(j.timestamp + (j.opts.delay ?? 0));
      if (!out.has(p) || at < out.get(p)!) out.set(p, at);
    }
    return out;
  }

  private async view(p: Platform, next?: Date): Promise<PlatformView> {
    const usage = await platformUsage(this.db, p.kind as never);
    return {
      kind: p.kind as never,
      needsSession: isSessionKind(p.kind),
      sessionStatus: p.sessionStatus as never,
      accountLabel: p.accountLabel,
      connectedAt: p.connectedAt?.toISOString() ?? null,
      lastTestAt: p.lastTestAt?.toISOString() ?? null,
      lastTestOk: p.lastTestOk,
      needsOptIn: p.kind === 'linkedin' && !p.optInAt,
      optInAt: p.optInAt?.toISOString() ?? null,
      submitCap: p.submitCap,
      simulateCap: p.simulateCap,
      submitMax: p.submitMax,
      minIntervalSec: p.minIntervalSec,
      usage,
      paused: p.pauseReason && (!p.pausedUntil || p.pausedUntil > new Date()) ? { until: p.pausedUntil?.toISOString() ?? null, reason: p.pauseReason } : null,
      nextRunAt: next?.toISOString() ?? null,
    };
  }

  async list(): Promise<PlatformView[]> {
    const next = await this.nextRuns();
    const rows = [];
    for (const kind of Object.keys(PLATFORM_DEFAULTS) as (keyof typeof PLATFORM_DEFAULTS)[]) rows.push(await this.view(await ensurePlatform(this.db, kind), next.get(kind)));
    return rows;
  }

  async get(kind: string): Promise<PlatformView> {
    const k = this.parseKind(kind);
    return this.view(await ensurePlatform(this.db, k), (await this.nextRuns()).get(k));
  }

  /** FR-004: LinkedIn automation is against its terms; explicit acknowledgement first. */
  async optIn(): Promise<PlatformView> {
    await ensurePlatform(this.db, 'linkedin');
    await this.db.platform.update({ where: { kind: 'linkedin' }, data: { optInAt: new Date() } });
    return this.get('linkedin');
  }

  async connect(kind: string): Promise<PlatformView> {
    const k = this.parseKind(kind);
    if (!isSessionKind(k)) throw new ApiError(400, 'no_session', 'esta plataforma não precisa de login');
    const p = await ensurePlatform(this.db, k);
    if (k === 'linkedin' && !p.optInAt) throw new ApiError(409, 'opt_in_required', 'confirme o aviso sobre os termos do LinkedIn antes');
    if (!keyOk()) throw new ApiError(409, 'no_session_key', 'SESSION_ENCRYPTION_KEY ausente ou inválida no .env');
    if (p.sessionStatus === 'connecting') throw new ApiError(409, 'already_connecting', 'já existe uma janela de login aberta');
    await this.db.platform.update({ where: { kind: k }, data: { sessionStatus: 'connecting', connectRequest: null } });
    await this.queue.add('connect-session', { kind: k }, { attempts: 1, removeOnComplete: 50, removeOnFail: 50, jobId: `connect-${k}-${Date.now()}` });
    return this.get(k);
  }

  async connectDone(kind: string, cancel?: boolean): Promise<PlatformView> {
    const k = this.parseKind(kind);
    await this.db.platform.update({ where: { kind: k }, data: { connectRequest: cancel ? 'cancel' : 'done' } });
    return this.get(k);
  }

  async test(kind: string): Promise<PlatformView> {
    const k = this.parseKind(kind);
    if (!isSessionKind(k)) throw new ApiError(400, 'no_session', 'esta plataforma não precisa de login');
    const p = await ensurePlatform(this.db, k);
    if (!p.sessionEnc) throw new ApiError(409, 'not_connected', 'plataforma não conectada');
    await this.queue.add('test-session', { kind: k }, { attempts: 1, removeOnComplete: 50, removeOnFail: 50, jobId: `test-${k}-${Date.now()}` });
    return this.get(k);
  }

  /** Deletes the stored session; pending work on that platform waits for a new login. */
  async disconnect(kind: string): Promise<PlatformView> {
    const k = this.parseKind(kind);
    if (!isSessionKind(k)) throw new ApiError(400, 'no_session', 'esta plataforma não precisa de login');
    await ensurePlatform(this.db, k);
    await this.db.platform.update({ where: { kind: k }, data: { sessionEnc: null, sessionStatus: 'disconnected', accountLabel: null, connectedAt: null, lastTestOk: null, connectRequest: null } });
    const reason = [{ code: 'session_expired', message: `sessão expirada: reconecte a plataforma (${k})` }];
    await this.db.application.updateMany({
      where: { platform: k, status: { in: ['queued', 'ready', 'approved'] } },
      data: { status: 'needs_input', needsReasons: reason as Prisma.InputJsonValue, needsReason: reason[0]!.message, approvedAt: null, approvalHash: null },
    });
    return this.get(k);
  }

  async limits(kind: string, body: PlatformLimitsBody): Promise<PlatformView> {
    const k = this.parseKind(kind);
    const p = await ensurePlatform(this.db, k);
    if (body.submitCap !== undefined && body.submitCap > p.submitMax) throw new ApiError(422, 'above_max', `máximo seguro para ${k}: ${p.submitMax} envios/dia`);
    await this.db.platform.update({ where: { kind: k }, data: body });
    return this.get(k);
  }

  /** Clears pause/backoff and re-queues work left waiting by a manual pause. */
  async resume(kind: string): Promise<PlatformView> {
    const k = this.parseKind(kind);
    await ensurePlatform(this.db, k);
    await this.db.platform.update({ where: { kind: k }, data: { pausedUntil: null, pauseReason: null, backoffLevel: 0, consecutiveErrors: 0 } });
    const waiting = await this.db.application.findMany({ where: { platform: k, status: { in: ['queued', 'approved'] } } });
    for (const a of waiting) {
      if (a.status === 'approved' && a.approvalHash) {
        await this.queue.add('submit', { applicationId: a.id, approvalHash: a.approvalHash }, { attempts: 1, removeOnComplete: 200, removeOnFail: 200, jobId: `submit-${a.id}-${Date.now()}` });
      } else if (a.status === 'queued') {
        await this.queue.add('apply', { applicationId: a.id, attempt: Math.max(1, a.attempts) }, { attempts: 2, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 200, removeOnFail: 200, jobId: `apply-${a.id}-${Date.now()}` });
      }
    }
    return this.get(k);
  }
}
