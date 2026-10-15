import type { DiscoverPayload, RawJob } from '@autoapply/shared';
import { cleanDescription } from '@autoapply/jobs';
import { SourceError, type JobSource } from './types.js';

export const GUPY_SEARCH_URL = 'https://portal.gupy.io/api/job-search/jobs';
const PAGE = 50;

interface GupyJob {
  id: number;
  name: string;
  description?: string | null;
  careerPageName?: string | null;
  workplaceType?: string | null;
  city?: string | null;
  state?: string | null;
  jobUrl: string;
  publishedDate?: string | null;
}
interface GupyResponse {
  data: GupyJob[];
  pagination: { total: number; limit: number; offset: number };
}

/** Gupy public job-search endpoint (research R1). No login; 1 s between pages; stops at `limit`. */
export class GupySource implements JobSource {
  readonly type = 'gupy' as const;

  constructor(
    private readonly f: typeof fetch = fetch,
    private readonly pauseMs = 1000,
  ) {}

  async search(input: DiscoverPayload): Promise<RawJob[]> {
    const out: RawJob[] = [];
    for (let offset = 0; out.length < input.limit; offset += PAGE) {
      const url = `${GUPY_SEARCH_URL}?jobName=${encodeURIComponent(input.query)}&offset=${offset}&limit=${Math.min(PAGE, input.limit - out.length)}`;
      const res = await this.f(url, { headers: { 'user-agent': 'autoapply (personal job search)', accept: 'application/json' } });
      if (res.status === 403 || res.status === 429) throw new SourceError('blocked', `Gupy ${res.status}`);
      if (!res.ok) throw new Error(`Gupy ${res.status}`); // transient → BullMQ retry
      const body = (await res.json()) as GupyResponse;
      if (!Array.isArray(body?.data)) throw new SourceError('bad_response', 'Gupy: unexpected response shape');
      for (const j of body.data) {
        if (!j.jobUrl || !j.name) continue;
        out.push({
          source: 'gupy',
          externalId: String(j.id),
          url: j.jobUrl,
          applyUrl: j.jobUrl,
          company: j.careerPageName?.trim() || 'Empresa não informada',
          title: j.name.trim(),
          description: cleanDescription(j.description) ?? undefined,
          city: j.city || undefined,
          uf: j.state || undefined,
          location: [j.city, j.state].filter(Boolean).join(', ') || undefined,
          workMode: j.workplaceType === 'remote' ? 'remote' : j.workplaceType === 'hybrid' ? 'hybrid' : j.workplaceType === 'on-site' ? 'onsite' : undefined,
          postedAt: j.publishedDate ?? undefined,
        });
      }
      const p = body.pagination;
      if (!body.data.length || !p || p.offset + p.limit >= p.total) break;
      if (this.pauseMs) await new Promise((r) => setTimeout(r, this.pauseMs));
    }
    return out.slice(0, input.limit);
  }
}
