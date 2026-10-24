import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { telegramConfig } from '@autoapply/jobs';
import { QUEUES, ReportPayload } from '@autoapply/shared';
import type { KbDeps } from '../kb/deps.js';
import { pollTelegram } from '../night/commands.js';
import { deliverReport } from '../night/report.js';
import { REPORT_JOB_OPTS } from './night.processor.js';
import { KB_DEPS } from './sync-profile.processor.js';

export const TELEGRAM_SCHEDULER_ID = 'telegram-poll';

/** F6: morning report delivery + Telegram commands (research R6); concurrency 1. */
@Processor(QUEUES.notify, { concurrency: 1, lockDuration: 60_000 })
export class NotifyProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(NotifyProcessor.name);

  constructor(
    @Inject(KB_DEPS) private readonly deps: KbDeps,
    @InjectQueue(QUEUES.notify) private readonly notifyQueue: Queue,
    @InjectQueue(QUEUES.discover) private readonly discover: Queue,
    @InjectQueue(QUEUES.discoverJobspy) private readonly jobspy: Queue,
    @InjectQueue(QUEUES.tailor) private readonly tailor: Queue,
    @InjectQueue(QUEUES.apply) private readonly apply: Queue,
  ) {
    super();
  }

  async onModuleInit() {
    if (telegramConfig()) {
      await this.notifyQueue.upsertJobScheduler(TELEGRAM_SCHEDULER_ID, { every: 30_000 }, { name: 'telegram-poll', data: {}, opts: { removeOnComplete: 20, removeOnFail: 50 } });
      this.logger.log('Telegram configured: report + commands from the configured chat only');
    } else {
      await this.notifyQueue.removeJobScheduler(TELEGRAM_SCHEDULER_ID);
    }
  }

  private async drain(): Promise<number> {
    let n = 0;
    for (const q of [this.discover, this.jobspy, this.tailor, this.apply]) {
      const jobs = await q.getJobs(['waiting', 'delayed', 'prioritized']);
      for (const j of jobs) {
        if (!j) continue;
        await j.remove().catch(() => undefined);
        n++;
      }
    }
    return n;
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === 'telegram-poll') {
      const config = telegramConfig();
      if (!config) return { skipped: true };
      const res = await pollTelegram({
        db: this.deps.db,
        config,
        drainQueues: () => this.drain(),
        enqueueReport: async (nightRunId) => {
          await this.notifyQueue.add('report', { nightRunId } satisfies ReportPayload, { ...REPORT_JOB_OPTS, jobId: `report-${nightRunId}` });
        },
      });
      if (res.commands.length) this.logger.log(`telegram commands: ${res.commands.join(',')}`);
      return res;
    }
    const { nightRunId } = ReportPayload.parse(job.data);
    const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    const status = await deliverReport(this.deps.db, nightRunId, { final });
    this.logger.log(`report ${nightRunId}: ${status}`);
    return { status };
  }
}
