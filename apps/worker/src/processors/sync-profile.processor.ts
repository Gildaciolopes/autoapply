import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { QUEUES, SyncProfilePayload } from '@autoapply/shared';
import { importGithub } from '../kb/github-importer.js';
import { importLinkedin } from '../kb/linkedin-importer.js';
import { parseResume } from '../kb/resume-parser.js';
import { syncAll } from '../kb/sync-all.js';
import { runEvent, type KbDeps } from '../kb/deps.js';
import { LinkedinMcpClient } from '../mcp/linkedin-mcp.client.js';

export const KB_DEPS = Symbol('KB_DEPS');

/** F1 knowledge base: parse resume, import GitHub/LinkedIn, daily sync. Concurrency 1 (FR-027). */
@Processor(QUEUES.syncProfile, { concurrency: 1 })
export class SyncProfileProcessor extends WorkerHost {
  private readonly logger = new Logger(SyncProfileProcessor.name);

  constructor(
    @Inject(KB_DEPS) private readonly deps: KbDeps,
    private readonly linkedin: LinkedinMcpClient,
    @InjectQueue(QUEUES.syncProfile) private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    const payload = SyncProfilePayload.parse(job.data);
    this.logger.log(`${payload.kind} (job ${job.id}, attempt ${job.attemptsMade + 1})`);
    try {
      switch (payload.kind) {
        case 'parse_resume':
          return await parseResume(this.deps, payload.resumeId, payload.mode);
        case 'import_github':
          return await importGithub(this.deps, payload.syncRunId, { queue: this.queue });
        case 'import_linkedin':
          return await importLinkedin(this.deps, payload.syncRunId, this.linkedin);
        case 'sync_all':
          return await syncAll(this.deps, payload, { linkedin: this.linkedin, queue: this.queue });
      }
    } catch (err) {
      await runEvent(this.deps.db, 'error', `${payload.kind} failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }
}
