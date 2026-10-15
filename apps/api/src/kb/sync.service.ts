import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { localDate } from '@autoapply/kb';
import { QUEUES, type ProfileSourceView, type SyncProfilePayload, type SyncRunView } from '@autoapply/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiError } from './api-error.js';
import { JOB_OPTS } from './resumes.service.js';
import { toSyncRunView } from './views.js';

export const DAILY_SCHEDULER_ID = 'sync-profile-daily';

@Injectable()
export class SyncService implements OnModuleInit {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUES.syncProfile) private readonly queue: Queue,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  private configured(origin: 'github' | 'linkedin'): boolean {
    return origin === 'github' ? Boolean(process.env.GITHUB_TOKEN) : Boolean(process.env.LINKEDIN_MCP_URL);
  }

  async onModuleInit() {
    await this.seedSources();
    // research R8: idempotent across restarts; processor skips a second scheduled run per local day.
    await this.queue.upsertJobScheduler(
      DAILY_SCHEDULER_ID,
      { pattern: '0 6 * * *', tz: 'America/Sao_Paulo' },
      { name: 'sync_all', data: { kind: 'sync_all', trigger: 'schedule' } satisfies SyncProfilePayload, opts: JOB_OPTS },
    );
    this.logger.log(`scheduler ${DAILY_SCHEDULER_ID} registered (06:00 America/Sao_Paulo)`);
  }

  /** github enabled iff GITHUB_TOKEN set; linkedin always starts disabled (opt-in, FR-016). */
  async seedSources() {
    await this.db.profileSource.upsert({
      where: { origin: 'github' },
      create: { origin: 'github', enabled: this.configured('github'), account: process.env.GITHUB_USER ?? null },
      update: { account: process.env.GITHUB_USER ?? null },
    });
    await this.db.profileSource.upsert({ where: { origin: 'linkedin' }, create: { origin: 'linkedin', enabled: false }, update: {} });
  }

  async sources(): Promise<ProfileSourceView[]> {
    const rows = await this.db.profileSource.findMany({ where: { origin: { in: ['github', 'linkedin'] } }, orderBy: { origin: 'asc' } });
    return rows.map((r) => ({
      origin: r.origin as 'github' | 'linkedin',
      enabled: r.enabled,
      configured: this.configured(r.origin as 'github' | 'linkedin'),
      account: r.account,
      lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
      lastStatus: r.lastStatus,
      lastError: r.lastError,
    }));
  }

  private parseOrigin(origin: string): 'github' | 'linkedin' {
    if (origin !== 'github' && origin !== 'linkedin') throw new ApiError(404, 'unknown_source', 'fonte desconhecida');
    return origin;
  }

  async setEnabled(originRaw: string, enabled: boolean) {
    const origin = this.parseOrigin(originRaw);
    await this.db.profileSource.update({ where: { origin }, data: { enabled } });
    return (await this.sources()).find((s) => s.origin === origin)!;
  }

  async importNow(originRaw: string): Promise<{ syncRunId: string }> {
    const origin = this.parseOrigin(originRaw);
    const src = await this.db.profileSource.findUnique({ where: { origin } });
    if (!src?.enabled) throw new ApiError(409, 'source_disabled', 'fonte desativada');
    if (!this.configured(origin)) throw new ApiError(412, 'not_configured', origin === 'github' ? 'defina GITHUB_TOKEN no .env' : 'defina LINKEDIN_MCP_URL');
    const run = await this.db.syncRun.create({ data: { trigger: 'import', localDate: localDate() } });
    const payload: SyncProfilePayload = origin === 'github' ? { kind: 'import_github', syncRunId: run.id } : { kind: 'import_linkedin', syncRunId: run.id };
    await this.queue.add(payload.kind, payload, JOB_OPTS);
    return { syncRunId: run.id };
  }

  async syncNow(): Promise<{ syncRunId: string }> {
    const run = await this.db.syncRun.create({ data: { trigger: 'manual', localDate: localDate() } });
    const payload: SyncProfilePayload = { kind: 'sync_all', trigger: 'manual', syncRunId: run.id };
    await this.queue.add(payload.kind, payload, JOB_OPTS);
    return { syncRunId: run.id };
  }

  async runs(limit = 10): Promise<SyncRunView[]> {
    const rows = await this.db.syncRun.findMany({ orderBy: { startedAt: 'desc' }, take: Math.min(limit, 50) });
    return rows.map(toSyncRunView);
  }
}
