import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { Observable } from 'rxjs';
import { localDate } from '@autoapply/kb';
import { sendTelegramMessage, telegramConfig } from '@autoapply/jobs';
import { loadNightSettings, updateNightRow } from '@autoapply/db';
import { QUEUES, type NightRunListItem, type NightRunView, type NightSettings, type NightSettingsBody, type StartManualPayload } from '@autoapply/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiError } from '../kb/api-error.js';
import { eventView, nextWindow, runListItem, runView } from './views.js';

/** Events are read with a small lag so a concurrent insert with a lower seq is never skipped (R7). */
const READ_LAG_MS = 500;
const POLL_MS = 1000;

export interface SseMessage {
  id?: string;
  type?: string;
  data: unknown;
}

@Injectable()
export class NightService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUES.night) private readonly nightQueue: Queue,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  async settings(): Promise<NightSettings> {
    const s = await loadNightSettings(this.db);
    return { enabled: s.enabled, start: s.start, end: s.end, days: s.days, budget: s.budget, paused: s.pausedAt !== null, next: nextWindow(s), telegram: telegramConfig() !== null };
  }

  async updateSettings(body: NightSettingsBody): Promise<NightSettings> {
    const cur = await loadNightSettings(this.db);
    const start = body.start ?? cur.start;
    const end = body.end ?? cur.end;
    if (start === end) throw new ApiError(422, 'invalid_window', 'início e fim da janela não podem ser iguais');
    await updateNightRow(this.db, {
      ...(body.enabled !== undefined ? { nightEnabled: body.enabled } : {}),
      nightStart: start,
      nightEnd: end,
      ...(body.days ? { nightDays: [...body.days].sort() } : {}),
      ...(body.budget !== undefined ? { nightBudget: body.budget } : {}),
    });
    return this.settings();
  }

  /** "Rodar agora" (FR-002): one run at a time, refused while paused. */
  async startManual(): Promise<NightRunView> {
    const s = await loadNightSettings(this.db);
    if (s.pausedAt) throw new ApiError(409, 'paused', 'sistema pausado: clique em Retomar primeiro');
    const running = await this.db.nightRun.findFirst({ where: { status: 'running' } });
    if (running) throw new ApiError(409, 'already_running', 'já existe uma execução em andamento');
    const run = await this.db.nightRun.create({ data: { trigger: 'manual', nightDate: localDate(), budget: s.budget } });
    await this.db.runEvent.create({ data: { queue: 'night', nightRunId: run.id, level: 'info', message: `Execução manual iniciada (orçamento ${s.budget})`, data: { step: 'start' } } });
    const p: StartManualPayload = { nightRunId: run.id };
    await this.nightQueue.add('start-manual', p, { jobId: `start-manual-${run.id}`, removeOnComplete: 50, removeOnFail: 50 });
    return this.run(run.id);
  }

  async runs(limit = 30): Promise<NightRunListItem[]> {
    const rows = await this.db.nightRun.findMany({ orderBy: { startedAt: 'desc' }, take: Math.min(Math.max(limit, 1), 100) });
    return rows.map(runListItem);
  }

  private eventsWhere(id: string, after: number) {
    return { seq: { gt: after }, OR: [{ nightRunId: id }, { application: { is: { nightRunId: id } } }] };
  }

  async run(id: string): Promise<NightRunView> {
    const r = await this.db.nightRun.findUnique({ where: { id } });
    if (!r) throw new ApiError(404, 'not_found', 'execução não encontrada');
    const events = await this.db.runEvent.findMany({ where: this.eventsWhere(id, 0), orderBy: { seq: 'desc' }, take: 200 });
    return runView(r, events.reverse());
  }

  /** Live log (FR-024/025): replay after `after`, then poll; `end` once the run is final and drained. */
  events(id: string, after: number): Observable<SseMessage> {
    return new Observable<SseMessage>((sub) => {
      let closed = false;
      let timer: NodeJS.Timeout | undefined;
      let last = Number.isFinite(after) && after > 0 ? after : 0;
      const loop = async () => {
        try {
          const run = await this.db.nightRun.findUnique({ where: { id }, select: { status: true } });
          if (!run) {
            sub.next({ type: 'end', data: { reason: 'not_found' } });
            return sub.complete();
          }
          const rows = await this.db.runEvent.findMany({
            where: { ...this.eventsWhere(id, last), createdAt: { lte: new Date(Date.now() - READ_LAG_MS) } },
            orderBy: { seq: 'asc' },
            take: 500,
          });
          for (const e of rows) {
            if (closed) return;
            last = e.seq;
            sub.next({ id: String(e.seq), type: 'event', data: eventView(e) });
          }
          if (run.status !== 'running' && rows.length === 0) {
            const tail = await this.db.runEvent.count({ where: this.eventsWhere(id, last) });
            if (tail === 0) {
              sub.next({ type: 'end', data: { status: run.status } });
              return sub.complete();
            }
          }
        } catch (e) {
          if (!closed) sub.error(e);
          return;
        }
        if (!closed) timer = setTimeout(loop, POLL_MS);
      };
      void loop();
      return () => {
        closed = true;
        if (timer) clearTimeout(timer);
      };
    });
  }

  /** "Testar Telegram": sends one fixed message, no personal data. */
  async testTelegram(fetchImpl: typeof fetch = fetch) {
    const cfg = telegramConfig();
    if (!cfg) return { status: 'not_configured' as const };
    try {
      await sendTelegramMessage(cfg, 'AutoApply conectado ✅ — você receberá aqui o relatório de cada noite.', fetchImpl);
      return { status: 'sent' as const };
    } catch (e) {
      return { status: 'failed' as const, error: (e as Error).message };
    }
  }
}
