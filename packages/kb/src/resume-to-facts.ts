import { DRAFT_SECTIONS, type ResumeDiff, type ResumeDraft } from '@autoapply/shared';
import { sameValue } from './compare.js';
import { parseLooseDate } from './dates.js';
import { factKey, skillKey } from './keys.js';
import { foundInSource, prepareSource } from './source-check.js';
import type { Candidate, FactLike } from './types.js';

/** Identifying values per draft item, used by the provenance check. */
function identityValues(section: (typeof DRAFT_SECTIONS)[number], item: Record<string, unknown>): string[] {
  const s = (k: string) => (typeof item[k] === 'string' ? (item[k] as string) : '');
  switch (section) {
    case 'work':
      return [s('name'), s('position')];
    case 'education':
      return [s('institution')];
    case 'skills':
      return [s('name')];
    case 'languages':
      return [s('language')];
    case 'certificates':
      return [s('name')];
    case 'projects':
      return [s('name')];
  }
}

/**
 * Sets `not_in_source` on every draft item whose identifying values are absent from the source
 * text. Removes stale `not_in_source` flags when the item is found (e.g. after user edits).
 */
export function flagDraft(draft: ResumeDraft, sourceText: string): ResumeDraft {
  const src = prepareSource(sourceText);
  const out = structuredClone(draft);
  for (const section of DRAFT_SECTIONS) {
    for (const item of out[section] as { flags: string[] }[]) {
      const flags = foundInSource(src, identityValues(section, item as Record<string, unknown>), { skill: section === 'skills' });
      item.flags = [...item.flags.filter((f) => f !== 'not_in_source'), ...flags] as typeof item.flags;
    }
  }
  return out;
}

/** Items still flagged not_in_source, as "section:id" paths. */
export function flaggedItems(draft: ResumeDraft): string[] {
  return DRAFT_SECTIONS.flatMap((section) =>
    (draft[section] as { id: string; flags: string[] }[]).filter((i) => i.flags.includes('not_in_source')).map((i) => i.id),
  );
}

/** Raw date strings from LLM → LooseDate; unparseable → null + date_ambiguous flag. */
export function normalizeDraftDate(raw: string | null | undefined): { date: ReturnType<typeof parseLooseDate>; ambiguous: boolean } {
  if (raw === null || raw === undefined || raw.trim() === '') return { date: null, ambiguous: false };
  const date = parseLooseDate(raw);
  return { date, ambiguous: date === null };
}

/**
 * ResumeDraft → fact candidates with provenance refs `resume:<resumeId>#<section>[<i>]`.
 * Basics (name, contact, summary) go to Profile, not facts.
 */
export function draftToCandidates(draft: ResumeDraft, resumeId: string, origin: 'resume' | 'linkedin' = 'resume'): Candidate[] {
  const ref = (section: string, i: number) => (origin === 'resume' ? `resume:${resumeId}#${section}[${i}]` : `linkedin:${section}[${i}]`);
  const out: Candidate[] = [];
  const push = (kind: Candidate['kind'], value: Record<string, unknown>, section: string, i: number, item: { id: string; quote: string }, raw: unknown) => {
    const clean = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== ''));
    out.push({
      kind,
      key: kind === 'skill' ? skillKey(String(value.name)) : factKey(kind, clean),
      value: clean,
      itemId: item.id,
      source: { origin, ref: ref(section, i), rawValue: raw, snippet: item.quote || undefined },
    });
  };

  draft.work.forEach((w, i) =>
    push('experience', { company: w.name, title: w.position, location: w.location, start: w.startDate, end: w.endDate, highlights: w.highlights }, 'work', i, w, w),
  );
  draft.education.forEach((e, i) =>
    push('education', { institution: e.institution, degree: e.studyType, area: e.area, start: e.startDate, end: e.endDate }, 'education', i, e, e),
  );
  draft.skills.forEach((s, i) => push('skill', { name: s.name, category: s.category }, 'skills', i, s, s));
  draft.languages.forEach((l, i) => push('language', { language: l.language, fluency: l.fluency }, 'languages', i, l, l));
  draft.certificates.forEach((c, i) => push('certification', { name: c.name, issuer: c.issuer, date: c.date }, 'certificates', i, c, c));
  draft.projects.forEach((p, i) =>
    push('project', { name: p.name, description: p.description, url: p.url, highlights: p.highlights, keywords: p.keywords }, 'projects', i, p, p),
  );
  return out;
}

/**
 * Re-upload diff (FR-009): compares a new draft against facts that came from a resume.
 * removed = resume-sourced active facts with no matching key in the new draft.
 */
export function diffDraft(candidates: Candidate[], existing: FactLike[]): ResumeDiff {
  const resumeFacts = existing.filter((f) => f.status === 'active' && f.sources.some((s) => s.origin === 'resume'));
  const byKey = new Map(existing.map((f) => [`${f.kind}|${f.key}`, f]));
  const seen = new Set<string>();
  const diff: ResumeDiff = { added: [], changed: [], removed: [], unchanged: [] };
  for (const c of candidates) {
    const id = `${c.kind}|${c.key}`;
    seen.add(id);
    const f = byKey.get(id);
    if (!f) diff.added.push(c.itemId ?? c.key);
    else if (sameValue(c.kind, f.value, c.value)) diff.unchanged.push(c.itemId ?? c.key);
    else diff.changed.push({ itemId: c.itemId ?? c.key, factId: f.id, before: f.value, after: c.value });
  }
  for (const f of resumeFacts) if (!seen.has(`${f.kind}|${f.key}`)) diff.removed.push({ factId: f.id, key: f.key });
  return diff;
}
