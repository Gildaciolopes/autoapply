import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { chromium, type Browser } from 'playwright';
import { ApplyPayload, QUEUES } from '@autoapply/shared';
import type { KbDeps } from '../kb/deps.js';
import { dailyCapDelay, runApply } from '../apply/run.js';
import { KB_DEPS } from './sync-profile.processor.js';

export const APPLY_JOB_OPTS = { attempts: 2, backoff: { type: 'exponential' as const, delay: 30_000 }, removeOnComplete: 200, removeOnFail: 200 };

/** F4 dry-run simulations, one at a time (constitution §III), one shared headless Chromium. */
@Processor(QUEUES.apply, { concurrency: 1 })
export class ApplyProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(ApplyProcessor.name);
  private browser?: Promise<Browser>;

  constructor(
    @Inject(KB_DEPS) private readonly deps: KbDeps,
    @InjectQueue(QUEUES.apply) private readonly queue: Queue,
  ) {
    super();
  }

  private getBrowser(): Promise<Browser> {
    this.browser ??= chromium.launch({ headless: true }).then((b) => {
      b.on('disconnected', () => (this.browser = undefined));
      return b;
    });
    return this.browser;
  }

  async onModuleDestroy() {
    const b = this.browser;
    this.browser = undefined;
    if (b) await (await b).close();
  }

  async process(job: Job): Promise<unknown> {
    const payload = ApplyPayload.parse(job.data);
    const app = await this.deps.db.application.findUnique({ where: { id: payload.applicationId }, select: { status: true } });
    if (!app || app.status === 'skipped') return { skipped: true };
    const delay = await dailyCapDelay(this.deps, payload.applicationId);
    if (delay > 0) {
      await this.queue.add('apply', payload, { ...APPLY_JOB_OPTS, delay, jobId: `apply-${payload.applicationId}-${payload.attempt}-capped` });
      this.logger.log(`apply ${payload.applicationId}: daily cap, delayed ${Math.round(delay / 60_000)} min`);
      return { delayed: delay };
    }
    const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    const res = await runApply({ ...this.deps, browser: () => this.getBrowser() }, payload, { final });
    this.logger.log(`apply ${payload.applicationId}: ${res.status} ${res.reasons.map((r) => r.code).join(',')}`);
    return res;
  }
}
