import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { FlowProducer, type Job, type Queue } from 'bullmq';
import { startDiscoveryFlow } from '@autoapply/db';
import { QUEUES, StartManualPayload, type ApplyPayload, type ReportPayload } from '@autoapply/shared';
import type { KbDeps } from '../kb/deps.js';
import { startRunDiscovery, tick, type TickDeps } from '../night/tick.js';
import { APPLY_JOB_OPTS } from './apply.processor.js';
import { KB_DEPS } from './sync-profile.processor.js';

export const NIGHT_SCHEDULER_ID = 'night-tick';
export const REPORT_JOB_OPTS = { attempts: 5, backoff: { type: 'exponential' as const, delay: 60_000 }, removeOnComplete: 200, removeOnFail: 200 };

/** F6: the night state machine ticks every minute (research R1); concurrency 1. */
@Processor(QUEUES.night, { concurrency: 1 })
export class NightProcessor extends WorkerHost implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NightProcessor.name);
  private readonly flows = new FlowProducer({ connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6380' } });

  constructor(
    @Inject(KB_DEPS) private readonly deps: KbDeps,
    @InjectQueue(QUEUES.night) private readonly nightQueue: Queue,
    @InjectQueue(QUEUES.apply) private readonly applyQueue: Queue,
    @InjectQueue(QUEUES.notify) private readonly notifyQueue: Queue,
  ) {
    super();
  }

  async onModuleInit() {
    await this.nightQueue.upsertJobScheduler(
      NIGHT_SCHEDULER_ID,
      { pattern: '* * * * *', tz: 'America/Sao_Paulo' },
      { name: 'night-tick', data: {}, opts: { removeOnComplete: 20, removeOnFail: 50 } },
    );
    this.logger.log(`scheduler ${NIGHT_SCHEDULER_ID} registered (every minute)`);
  }

  async onModuleDestroy() {
    await this.flows.close();
  }

  private tickDeps(): TickDeps {
    return {
      db: this.deps.db,
      now: new Date(),
      startDiscovery: () => startDiscoveryFlow(this.deps.db, this.flows as never, 'schedule'),
      enqueueApply: async (applicationId, attempt) => {
        const p: ApplyPayload = { applicationId, attempt };
        await this.applyQueue.add('apply', p, { ...APPLY_JOB_OPTS, jobId: `apply-${applicationId}-${attempt}` });
      },
      removeApplyJobs: async (ids) => {
        const set = new Set(ids);
        const jobs = await this.applyQueue.getJobs(['waiting', 'delayed', 'prioritized']);
        await Promise.all(jobs.filter((j) => j?.name === 'apply' && set.has(j.data?.applicationId)).map((j) => j.remove().catch(() => undefined)));
      },
      enqueueReport: async (nightRunId) => {
        const p: ReportPayload = { nightRunId };
        await this.notifyQueue.add('report', p, { ...REPORT_JOB_OPTS, jobId: `report-${nightRunId}` });
      },
    };
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === 'start-manual') {
      const { nightRunId } = StartManualPayload.parse(job.data);
      const run = await this.deps.db.nightRun.findUnique({ where: { id: nightRunId } });
      if (!run || run.status !== 'running') return { skipped: true };
      await startRunDiscovery(this.tickDeps(), run);
      return { started: nightRunId };
    }
    const res = await tick(this.tickDeps());
    if (res.action !== 'idle' && res.action !== 'already_ran') this.logger.log(`night-tick: ${JSON.stringify(res)}`);
    return res;
  }
}
