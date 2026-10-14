import type { DiscoverPayload, RawJob } from '@autoapply/shared';

/** One implementation per job board (API, MCP or scraper). Constitution §III: respect caps. */
export interface JobSource {
  readonly type: DiscoverPayload['source'];
  search(input: DiscoverPayload): Promise<RawJob[]>;
}
