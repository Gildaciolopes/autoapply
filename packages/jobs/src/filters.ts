import { findSkillsInText } from '@autoapply/shared';
import { normalizeText, sameOrganization } from '@autoapply/kb';
import type { FilterReason, Preferences } from '@autoapply/shared';
import { normalizeTitle } from './normalize.js';

export interface FilterableJob {
  company: string;
  title: string;
  description?: string | null;
  city?: string | null;
  uf?: string | null;
  remote: boolean;
  workMode?: string | null;
  seniority?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
}

/** Maps a Job row (with its company) to the filter input; shared by the scoring stage and API re-filter. */
export function toFilterable(j: Omit<FilterableJob, 'company'> & { company: { name: string } | null }): FilterableJob {
  return {
    company: j.company?.name ?? '',
    title: j.title,
    description: j.description,
    city: j.city,
    uf: j.uf,
    remote: j.remote,
    workMode: j.workMode,
    seniority: j.seniority,
    salaryMin: j.salaryMin,
    salaryMax: j.salaryMax,
  };
}

export interface FilterResult {
  passed: boolean;
  reason: FilterReason | null;
}

const STOP = new Set(['de', 'da', 'do', 'em', 'e', 'para', 'com', 'of', 'and', 'the', 'pessoa']);
const tokens = (t: string) => normalizeTitle(t).split(' ').filter((w) => w.length > 1 && !STOP.has(w));

function wholeWord(hay: string, word: string): boolean {
  const w = normalizeText(word);
  return w.length > 0 && ` ${hay} `.includes(` ${w} `);
}

function parsePrefLocation(loc: string): { city: string | null; uf: string | null; remote: boolean } {
  if (normalizeText(loc) === 'remote' || normalizeText(loc) === 'remoto') return { city: null, uf: null, remote: true };
  const [a, b] = loc.split('/').map((x) => x.trim());
  if (b) return { city: a ?? null, uf: b.toUpperCase(), remote: false };
  return a && a.length === 2 ? { city: null, uf: a.toUpperCase(), remote: false } : { city: a ?? null, uf: null, remote: false };
}

function locationMatches(job: FilterableJob, prefs: Preferences): boolean {
  const places = prefs.locations.map(parsePrefLocation).filter((p) => !p.remote);
  if (!places.length || !job.uf) return true; // no constraint or unknown location → pass (FR-011)
  return places.some((p) => {
    if (p.uf && p.uf !== job.uf) return false;
    if (p.city && job.city) return normalizeText(p.city) === normalizeText(job.city);
    return true;
  });
}

/**
 * Hard filters (FR-010/FR-011, research R6). First failing rule wins. Unknown values never filter.
 */
export function applyHardFilters(job: FilterableJob, prefs: Preferences): FilterResult {
  const fail = (reason: FilterReason): FilterResult => ({ passed: false, reason });

  if (prefs.blockedCompanies.some((c) => sameOrganization(c, job.company))) return fail('blocked_company');

  const text = ` ${normalizeText(`${job.title} ${job.description ?? ''}`)} `;
  if (prefs.excludeKeywords.some((k) => wholeWord(text, k))) return fail('excluded_keyword');

  const modes = prefs.workModes;
  const isRemote = job.remote || job.workMode === 'remote';
  if (modes.length) {
    if (isRemote && !modes.includes('remote')) return fail('location_mode');
    if (!isRemote && (job.workMode === 'hybrid' || job.workMode === 'onsite')) {
      if (!modes.includes(job.workMode)) return fail('location_mode');
    }
  }
  if (!isRemote && (job.workMode === 'hybrid' || job.workMode === 'onsite') && !locationMatches(job, prefs)) {
    return fail('location_mode');
  }

  const salary = job.salaryMax ?? job.salaryMin;
  if (prefs.minSalary && salary && salary < prefs.minSalary) return fail('salary_below_min');

  if (job.seniority && prefs.seniority.length && !prefs.seniority.includes(job.seniority as Preferences['seniority'][number])) {
    return fail('seniority');
  }

  if (prefs.roles.length) {
    const titleTokens = new Set(tokens(job.title));
    const roleHit = prefs.roles.some((r) => tokens(r).some((t) => titleTokens.has(t)));
    const titleSkills = new Set(findSkillsInText(job.title).map((s) => s.id));
    const stackHit = prefs.stack.some((s) => findSkillsInText(s).some((d) => titleSkills.has(d.id)) || wholeWord(` ${normalizeText(job.title)} `, s));
    if (!roleHit && !stackHit) return fail('off_target');
  }
  return { passed: true, reason: null };
}

export const FILTER_REASON_LABELS: Record<FilterReason, string> = {
  blocked_company: 'empresa bloqueada',
  excluded_keyword: 'palavra excluída',
  location_mode: 'modalidade/local',
  salary_below_min: 'salário abaixo do mínimo',
  seniority: 'senioridade',
  off_target: 'cargo fora do alvo',
};
