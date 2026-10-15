import type { DiscoverPayload, RawJob } from '@autoapply/shared';
import { SourceError, type JobSource } from './types.js';

export interface McpLike {
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
  listTools?(): Promise<string[]>;
}

const SESSION_ERROR = /login|log in|session|sess[aã]o|auth|401|403|cookie|expired|sign in/i;

/** MCP output is either structuredContent or `[{type:'text', text}]`, sometimes JSON-in-text. */
export function mcpPayload(out: unknown): unknown {
  if (Array.isArray(out)) {
    const text = out.map((b) => (b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : '')).join('\n');
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return out;
}

const pick = (o: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) if (typeof o[k] === 'string' && o[k]) return o[k] as string;
  return undefined;
};

function jobIds(payload: unknown): string[] {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? ((payload as Record<string, unknown>).jobs ?? (payload as Record<string, unknown>).job_ids ?? (payload as Record<string, unknown>).results)
      : typeof payload === 'string'
        ? [...payload.matchAll(/jobs\/view\/(\d+)|\b(\d{9,11})\b/g)].map((m) => m[1] ?? m[2])
        : [];
  return (Array.isArray(list) ? list : [])
    .map((x) => (typeof x === 'string' || typeof x === 'number' ? String(x) : pick(x as Record<string, unknown>, 'job_id', 'id', 'jobId')))
    .filter((x): x is string => Boolean(x));
}

/** LinkedIn via the read-only MCP tools search_jobs + get_job_details (research R3). Opt-in, low cap. */
export class LinkedinSource implements JobSource {
  readonly type = 'linkedin_mcp' as const;
  constructor(private readonly mcp: McpLike) {}

  private async call(name: string, args: Record<string, unknown>) {
    try {
      return mcpPayload(await this.mcp.call(name, args));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (SESSION_ERROR.test(msg)) throw new SourceError('session_expired', msg);
      throw err;
    }
  }

  async search(input: DiscoverPayload): Promise<RawJob[]> {
    const ids = jobIds(await this.call('search_jobs', { keywords: input.query, location: input.location })).slice(0, input.limit);
    const out: RawJob[] = [];
    for (const id of ids) {
      const d = await this.call('get_job_details', { job_id: id });
      const o = (d && typeof d === 'object' ? d : { description: String(d ?? '') }) as Record<string, unknown>;
      const title = pick(o, 'title', 'job_title');
      const company = pick(o, 'company', 'company_name');
      if (!title || !company) continue;
      const url = pick(o, 'url', 'job_url') ?? `https://www.linkedin.com/jobs/view/${id}/`;
      const wp = (pick(o, 'workplace_type', 'workplaceType') ?? '').toLowerCase();
      out.push({
        source: 'linkedin_mcp',
        externalId: id,
        url,
        applyUrl: pick(o, 'apply_url', 'applyUrl'),
        company,
        title,
        description: pick(o, 'description', 'job_description'),
        location: pick(o, 'location'),
        workMode: wp.includes('remote') ? 'remote' : wp.includes('hybrid') ? 'hybrid' : wp.includes('site') ? 'onsite' : undefined,
        postedAt: pick(o, 'posted_at', 'listed_at', 'postedAt'),
      });
    }
    return out;
  }
}
