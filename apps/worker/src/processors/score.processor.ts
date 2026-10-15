import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnModuleDestroy } from '@nestjs/common';
import { FlowProducer, type Job } from 'bullmq';
import { localDate } from '@autoapply/kb';
import { ProcessRunPayload, QUEUES } from '@autoapply/shared';
import { KB_DEPS } from './sync-profile.processor.js';
import type { KbDeps } from '../kb/deps.js';
import { startDiscoveryFlow } from '@autoapply/db';
import { childrenOf, processRun } from '../jobs/run.js';

/** F2: `process-run` (flow parent, fan-in) and `start-run` (daily scheduler). Concurrency 1. */
@Processor(QUEUES.score, { concurrency: 1 })
export class ScoreProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(ScoreProcessor.name);
  private readonly flows = new FlowProducer({ connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6380' } });

  constructor(@Inject(KB_DEPS) private readonly deps: KbDeps) {
    super();
  }

  async onModuleDestroy() {
    await this.flows.close();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === 'start-run') {
      const today = localDate();
      const already = await this.deps.db.discoveryRun.findFirst({ where: { trigger: 'schedule', localDate: today } });
      if (already) return { skipped: true, runId: already.id };
      return startDiscoveryFlow(this.deps.db, this.flows as never, 'schedule');
    }
    const payload = ProcessRunPayload.parse(job.data);
    const res = await processRun(this.deps, payload, await childrenOf(job));
    this.logger.log(`run ${payload.runId}: ${JSON.stringify(res)}`);
    return res;
  }
}
