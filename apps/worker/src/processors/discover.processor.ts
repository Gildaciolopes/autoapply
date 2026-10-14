import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { DiscoverPayload, QUEUES } from '@autoapply/shared';

/** F2 implements the sources; this stub validates payloads and proves the wiring. */
@Processor(QUEUES.discover, { concurrency: 1 })
export class DiscoverProcessor extends WorkerHost {
  private readonly logger = new Logger(DiscoverProcessor.name);

  async process(job: Job): Promise<{ found: number }> {
    const input = DiscoverPayload.parse(job.data);
    this.logger.log(`discover ${input.source} "${input.query}" (not implemented yet, F2)`);
    return { found: 0 };
  }
}
