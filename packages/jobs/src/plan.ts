import type { DiscoverPayload, JobSourceType, Preferences } from '@autoapply/shared';

export interface SourceBudget {
  type: JobSourceType;
  enabled: boolean;
  /** dailyCap − new jobs already taken today */
  remaining: number;
}

export interface ChildSpec {
  queueName: 'discover' | 'discover-jobspy';
  name: string;
  data: DiscoverPayload;
}

const JOBSPY: JobSourceType[] = ['indeed', 'glassdoor', 'google_jobs'];

/**
 * One discover child per (enabled source with budget, role). The source's remaining daily cap is split
 * across roles (remainder to the first roles; roles beyond the cap get no child), so the limits of a run
 * sum to exactly the cap and a board is never asked for more (FR-004, §III).
 */
export function planDiscovery(runId: string, prefs: Preferences, sources: SourceBudget[]): ChildSpec[] {
  const roles = prefs.roles.slice(0, 5);
  const location = 'Brasil';
  const out: ChildSpec[] = [];
  for (const s of sources) {
    if (!s.enabled || s.remaining <= 0 || !roles.length) continue;
    const active = roles.slice(0, s.remaining);
    const base = Math.floor(s.remaining / active.length);
    const extra = s.remaining % active.length;
    for (const [i, query] of active.entries()) {
      const per = base + (i < extra ? 1 : 0);
      out.push({
        queueName: JOBSPY.includes(s.type) ? 'discover-jobspy' : 'discover',
        name: `${s.type}:${query}`,
        data: { runId, source: s.type, query, location, limit: per, ...(JOBSPY.includes(s.type) ? { hoursOld: 72 } : {}) },
      });
    }
  }
  return out;
}
