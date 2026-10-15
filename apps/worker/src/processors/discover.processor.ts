import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { DiscoverPayload, QUEUES, type DiscoverResult } from '@autoapply/shared';
import { LinkedinMcpClient } from '../mcp/linkedin-mcp.client.js';
import { GupySource } from '../sources/gupy.source.js';
import { LinkedinSource } from '../sources/linkedin.source.js';
import { SourceError, type JobSource } from '../sources/types.js';

/** Runs one (source, role) search as a child of a discovery flow; returns DiscoverResult. */
export async function runDiscover(payload: DiscoverPayload, sources: Record<string, JobSource>): Promise<DiscoverResult> {
  const source = sources[payload.source];
  if (!source) return { source: payload.source, jobs: [], error: 'unsupported_source' };
  try {
    return { source: payload.source, jobs: await source.search(payload) };
  } catch (err) {
    // Known conditions end this source for the run without retries (no evasion, §III).
    if (err instanceof SourceError) return { source: payload.source, jobs: [], error: err.code };
    throw err;
  }
}

@Processor(QUEUES.discover, { concurrency: 1 })
export class DiscoverProcessor extends WorkerHost {
  private readonly logger = new Logger(DiscoverProcessor.name);
  private readonly sources: Record<string, JobSource>;

  constructor(linkedin: LinkedinMcpClient) {
    super();
    this.sources = { gupy: new GupySource(), linkedin_mcp: new LinkedinSource(linkedin) };
  }

  async process(job: Job): Promise<DiscoverResult> {
    const input = DiscoverPayload.parse(job.data);
    let res: DiscoverResult;
    try {
      res = await runDiscover(input, this.sources);
    } catch (err) {
      // Last attempt: report the failure as a result so the run records it (FR-007).
      if (job.attemptsMade + 1 < (job.opts.attempts ?? 1)) throw err;
      res = { source: input.source, jobs: [], error: err instanceof Error ? err.message.slice(0, 200) : 'error' };
    }
    this.logger.log(`discover ${input.source} "${input.query}" → ${res.jobs.length}${res.error ? ` (${res.error})` : ''}`);
    return res;
  }
}
