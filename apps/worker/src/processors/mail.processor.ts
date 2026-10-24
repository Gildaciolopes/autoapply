import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { gmailConfig } from '@autoapply/jobs';
import { QUEUES } from '@autoapply/shared';
import type { KbDeps } from '../kb/deps.js';
import { mailCheck } from '../mail/check.js';
import { KB_DEPS } from './sync-profile.processor.js';

export const MAIL_SCHEDULER_ID = 'mail-check';

/**
 * F7: Gmail reply tracking every 30 min (research R3); concurrency 1. Runs regardless of the kill
 * switch: reading mail is not a platform action. No-op unless an account is connected.
 */
@Processor(QUEUES.mail, { concurrency: 1, lockDuration: 600_000 })
export class MailProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(
    @Inject(KB_DEPS) private readonly deps: KbDeps,
    @InjectQueue(QUEUES.mail) private readonly mailQueue: Queue,
  ) {
    super();
  }

  async onModuleInit() {
    await this.mailQueue.upsertJobScheduler(MAIL_SCHEDULER_ID, { every: 30 * 60_000 }, { name: 'mail-check', data: {}, opts: { attempts: 1, removeOnComplete: 20, removeOnFail: 50 } });
  }

  async process(_job: Job): Promise<unknown> {
    const res = await mailCheck({ db: this.deps.db, llm: this.deps.llm, config: gmailConfig() });
    if (res.status !== 'skipped') this.logger.log(`mail-check ${res.status}: seen ${res.seen}, matched ${res.matched}, retry ${res.retry}${res.reason ? ` (${res.reason})` : ''}`);
    return res;
  }
}
