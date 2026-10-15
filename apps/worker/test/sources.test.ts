import { describe, expect, it } from 'vitest';
import { GupySource } from '../src/sources/gupy.source.js';
import { LinkedinSource } from '../src/sources/linkedin.source.js';
import { runDiscover } from '../src/processors/discover.processor.js';
import { json } from './helpers.js';

const payload = (over = {}) => ({ runId: 'r1', source: 'gupy' as const, query: 'desenvolvedor full stack', location: 'Brasil', limit: 50, ...over });

describe('GupySource (recorded live response, 2026-10-15)', () => {
  it('maps the real response shape to RawJobs and stops at the limit', async () => {
    const urls: string[] = [];
    const f = (async (url: string) => (urls.push(url), new Response(JSON.stringify(json('gupy/search-fullstack.json'))))) as unknown as typeof fetch;
    const jobs = await new GupySource(f, 0).search(payload({ limit: 4 }));
    expect(jobs).toHaveLength(4);
    expect(urls[0]).toContain('portal.gupy.io/api/job-search/jobs?jobName=desenvolvedor%20full%20stack&offset=0&limit=4');
    const j = jobs[0]!;
    expect(j).toMatchObject({ source: 'gupy', externalId: expect.any(String), url: expect.stringContaining('gupy.io/job/') });
    expect(j.company.length).toBeGreaterThan(0);
    expect(j.description).not.toMatch(/&nbsp;|<\w+>/);
    expect(jobs.every((x) => ['remote', 'hybrid', 'onsite', undefined].includes(x.workMode))).toBe(true);
  });

  it('403 → blocked (no retry, no evasion)', async () => {
    const f = (async () => new Response('captcha', { status: 403 })) as unknown as typeof fetch;
    const r = await runDiscover(payload(), { gupy: new GupySource(f, 0) });
    expect(r).toEqual({ source: 'gupy', jobs: [], error: 'blocked' });
  });

  it('5xx is transient → throws for BullMQ retry', async () => {
    const f = (async () => new Response('down', { status: 502 })) as unknown as typeof fetch;
    await expect(runDiscover(payload(), { gupy: new GupySource(f, 0) })).rejects.toThrow('Gupy 502');
  });
});

describe('LinkedinSource (synthetic MCP output)', () => {
  const details = json<Record<string, unknown>>('linkedin/job_details.json');
  const mcp = (fail?: Error) => ({
    calls: [] as string[],
    async call(name: string, args: Record<string, unknown>) {
      this.calls.push(name);
      if (fail) throw fail;
      return name === 'search_jobs' ? json('linkedin/search_jobs.json') : details[String(args.job_id)];
    },
  });
  it('search → details → RawJobs', async () => {
    const m = mcp();
    const jobs = await new LinkedinSource(m).search(payload({ source: 'linkedin_mcp', limit: 15 }));
    expect(jobs.map((j) => [j.externalId, j.company, j.workMode])).toEqual([
      ['4100000001', 'Nimbus Pagamentos', 'remote'],
      ['4100000002', 'Banco Horizonte', 'onsite'],
    ]);
    expect(m.calls).toEqual(['search_jobs', 'get_job_details', 'get_job_details']);
  });
  it('session error → session_expired result', async () => {
    const r = await runDiscover(payload({ source: 'linkedin_mcp' }), { linkedin_mcp: new LinkedinSource(mcp(new Error('Please log in again'))) });
    expect(r.error).toBe('session_expired');
  });
});
