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
 * across roles (ceil), so a run never asks a board for more than its cap (FR-004, §III).
 */
export function planDiscovery(runId: string, prefs: Preferences, sources: SourceBudget[]): ChildSpec[] {
  const roles = prefs.roles.slice(0, 5);
  const location = 'Brasil';
  const out: ChildSpec[] = [];
  for (const s of sources) {
    if (!s.enabled || s.remaining <= 0 || !roles.length) continue;
    const per = Math.max(1, Math.ceil(s.remaining / roles.length));
    for (const query of roles) {
      out.push({
        queueName: JOBSPY.includes(s.type) ? 'discover-jobspy' : 'discover',
        name: `${s.type}:${query}`,
        data: { runId, source: s.type, query, location, limit: per, ...(JOBSPY.includes(s.type) ? { hoursOld: 72 } : {}) },
      });
    }
  }
  return out;
}
