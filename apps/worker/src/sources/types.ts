import type { DiscoverPayload, JobSourceType, RawJob } from '@autoapply/shared';

/** One implementation per job board (API or MCP). Constitution §III: caps, concurrency 1, no evasion. */
export interface JobSource {
  readonly type: JobSourceType;
  search(input: DiscoverPayload): Promise<RawJob[]>;
}

/**
 * Known, non-retryable source condition. `blocked` (captcha / anti-bot page) and `session_expired`
 * stop the source for the run; anything else thrown is treated as transient and retried by BullMQ.
 */
export class SourceError extends Error {
  constructor(
    readonly code: 'blocked' | 'session_expired' | 'bad_response',
    message: string,
  ) {
    super(message);
  }
}
