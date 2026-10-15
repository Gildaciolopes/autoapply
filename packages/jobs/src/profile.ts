import { createHash } from 'node:crypto';
import { compareLooseDate, formatLooseDate, normalizeText } from '@autoapply/kb';
import { Preferences, type FactKind, type LooseDate } from '@autoapply/shared';
import { parseLocation } from './normalize.js';

export interface ProfileFact {
  id: string;
  kind: FactKind;
  value: unknown;
}

const v = (f: ProfileFact) => (f.value ?? {}) as Record<string, unknown>;
const str = (x: unknown) => (typeof x === 'string' ? x : '');

/** One-line, human-readable summary of a fact (used in judge prompt and UI). */
export function factSummary(f: ProfileFact): string {
  const x = v(f);
  switch (f.kind) {
    case 'experience': {
      const dates = [formatLooseDate(x.start as LooseDate), formatLooseDate(x.end as LooseDate)].filter(Boolean).join('–');
      const hl = Array.isArray(x.highlights) ? (x.highlights as string[]).join(' ') : '';
      return `${str(x.title)} at ${str(x.company)}${dates ? ` (${dates})` : ''}${hl ? `: ${hl}` : ''}`;
    }
    case 'skill':
      return str(x.name);
    case 'education':
      return [str(x.degree), str(x.area), str(x.institution)].filter(Boolean).join(', ');
    case 'project':
      return [str(x.name), str(x.description), ...(Array.isArray(x.highlights) ? (x.highlights as string[]) : [])].filter(Boolean).join(' — ');
    case 'certification':
      return [str(x.name), str(x.issuer)].filter(Boolean).join(' — ');
    case 'language':
      return [str(x.language), str(x.fluency)].filter(Boolean).join(' ');
    default:
      return JSON.stringify(f.value);
  }
}

const PROFILE_KINDS: FactKind[] = ['experience', 'skill', 'project', 'education', 'certification', 'language'];

/** Deterministic profile text for embeddings: preferences + usable facts only (constitution §I). */
export function profileText(facts: ProfileFact[], prefs: Preferences): string {
  const byKind = (k: FactKind) =>
    facts
      .filter((f) => f.kind === k)
      .sort((a, b) =>
        k === 'experience' ? compareLooseDate(v(b).start as LooseDate, v(a).start as LooseDate) : factSummary(a).localeCompare(factSummary(b)),
      );
  const lines = [
    prefs.roles.length ? `Cargos: ${prefs.roles.join(', ')}` : '',
    prefs.stack.length ? `Stack: ${prefs.stack.join(', ')}` : '',
    ...PROFILE_KINDS.flatMap((k) => byKind(k).map((f) => `${k}: ${factSummary(f)}`)),
  ];
  return lines.filter(Boolean).join('\n');
}

export const profileHash = (text: string) => createHash('sha256').update(text).digest('hex');

/** Initial preferences suggested from verified facts (FR-002). Never sets salary/blocked/excluded. */
export function suggestPreferences(
  facts: ProfileFact[],
  profile: { city?: string | null } | null,
  personal: { workModes?: string[] } = {},
): Preferences {
  const exps = facts
    .filter((f) => f.kind === 'experience')
    .sort((a, b) => compareLooseDate(v(b).start as LooseDate, v(a).start as LooseDate));
  const roles: string[] = [];
  for (const e of exps) {
    const t = str(v(e).title).trim();
    if (t && !roles.some((r) => normalizeText(r) === normalizeText(t))) roles.push(t);
    if (roles.length === 3) break;
  }
  const skills = facts
    .filter((f) => f.kind === 'skill')
    .map((f) => ({ name: str(v(f).name), ev: v(f).evidence as { repoCount?: number; lastActivity?: string | null } | undefined }))
    .sort((a, b) => (b.ev?.repoCount ?? 0) - (a.ev?.repoCount ?? 0) || str(b.ev?.lastActivity).localeCompare(str(a.ev?.lastActivity)))
    .map((s) => s.name)
    .filter(Boolean);
  const stack = [...new Set(skills)].slice(0, 12);
  const loc = profile?.city ? parseLocation(profile.city) : null;
  const locations = [loc?.city && loc.uf ? `${loc.city}/${loc.uf}` : loc?.uf ?? null, 'remote'].filter((x): x is string => Boolean(x));
  const workModes = (personal.workModes ?? []).filter((m): m is 'remote' | 'hybrid' | 'onsite' => ['remote', 'hybrid', 'onsite'].includes(m));
  return Preferences.parse({ roles, stack, locations, workModes, saved: false });
}
