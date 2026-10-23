import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES, TailorPayload } from '@autoapply/shared';
import { runEvent, type KbDeps } from '../kb/deps.js';
import { KB_DEPS } from './sync-profile.processor.js';
import { tailorLetter } from '../tailor/tailor-letter.js';
import { tailorResume } from '../tailor/tailor-resume.js';

/** Runs tailoring for one job's documents (resume / cover letter). Concurrency 1 (local LLM). */
export async function runTailor(deps: KbDeps, payload: TailorPayload) {
  const results: Record<string, unknown> = {};
  let failure: unknown;
  for (const id of payload.documentIds) {
    const doc = await deps.db.tailoredDocument.findUnique({ where: { id } });
    if (!doc) continue;
    await deps.db.tailoredDocument.update({ where: { id }, data: { status: 'generating' } });
    try {
      results[id] = doc.kind === 'resume' ? await tailorResume(deps, id) : await tailorLetter(deps, id);
      await runEvent(deps.db, 'info', `tailor ${doc.kind} for job ${doc.jobId}: ${JSON.stringify(results[id])}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await deps.db.tailoredDocument.update({ where: { id }, data: { status: 'failed', error: message } });
      await runEvent(deps.db, 'error', `tailor ${doc.kind} for job ${doc.jobId} failed: ${message}`);
      if (message !== 'no_facts') failure ??= err;
    }
  }
  if (failure) throw failure; // BullMQ retry for transient errors (LLM down)
  return results;
}

@Processor(QUEUES.tailor, { concurrency: 1 })
export class TailorProcessor extends WorkerHost {
  private readonly logger = new Logger(TailorProcessor.name);

  constructor(@Inject(KB_DEPS) private readonly deps: KbDeps) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    const payload = TailorPayload.parse(job.data);
    const res = await runTailor(this.deps, payload);
    this.logger.log(`tailor job ${payload.jobId}: ${JSON.stringify(res)}`);
    return res;
  }
}
