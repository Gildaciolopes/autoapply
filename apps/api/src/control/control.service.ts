import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { loadNightSettings, resumeEverything, stopEverything } from '@autoapply/db';
import { QUEUES, type ControlState, type ReportPayload } from '@autoapply/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { nextWindow, runListItem } from '../night/views.js';

export const REPORT_JOB_OPTS = { attempts: 5, backoff: { type: 'exponential' as const, delay: 60_000 }, removeOnComplete: 200, removeOnFail: 200 };

/** Removes every job that has not started yet (waiting, delayed, prioritized). */
export async function drainQueues(queues: Queue[]): Promise<number> {
  let n = 0;
  for (const q of queues) {
    const jobs = await q.getJobs(['waiting', 'delayed', 'prioritized']);
    await Promise.all(
      jobs.map(async (j) => {
        if (!j) return;
        await j.remove().catch(() => undefined);
        n++;
      }),
    );
  }
  return n;
}

/** F6 global kill switch (FR-013..FR-015, research R5). */
@Injectable()
export class ControlService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUES.discover) private readonly discover: Queue,
    @InjectQueue(QUEUES.discoverJobspy) private readonly jobspy: Queue,
    @InjectQueue(QUEUES.tailor) private readonly tailor: Queue,
    @InjectQueue(QUEUES.apply) private readonly apply: Queue,
    @InjectQueue(QUEUES.notify) private readonly notify: Queue,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  async state(): Promise<ControlState> {
    const s = await loadNightSettings(this.db);
    const running = await this.db.nightRun.findFirst({ where: { status: 'running' } });
    return { paused: s.pausedAt !== null, pausedAt: s.pausedAt?.toISOString() ?? null, running: running ? runListItem(running) : null, next: nextWindow(s) };
  }

  async stop() {
    const res = await stopEverything(this.db, { removeJobs: () => drainQueues([this.discover, this.jobspy, this.tailor, this.apply]) });
    if (res.runStopped) {
      const p: ReportPayload = { nightRunId: res.runStopped };
      await this.notify.add('report', p, { ...REPORT_JOB_OPTS, jobId: `report-${res.runStopped}` });
    }
    return res;
  }

  async resume(): Promise<ControlState> {
    await resumeEverything(this.db);
    return this.state();
  }
}
