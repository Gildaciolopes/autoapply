import { compareLooseDate, normalizeText } from '@autoapply/kb';
import { factSummary, type ProfileFact } from '@autoapply/jobs';
import { findSkillsInText, type LooseDate, type TailorPlan } from '@autoapply/shared';
import { techMentions } from './validate.js';

export interface TailorJob {
  title: string;
  company: string;
  description?: string | null;
}

const STOP = new Set(
  'de da do das dos em e para com por a o as os um uma que no na nos nas ao the and of to in for with on as is are be or voce vaga time sera ser area experiencia conhecimento'.split(' '),
);
const words = (t: string) => normalizeText(t).split(' ').filter((w) => w.length >= 3 && !STOP.has(w));

export interface JobRequirements {
  skills: Set<string>; // dictionary ids
  skillOrder: string[];
  keywords: Set<string>;
}

/** Technologies (dictionary) and keywords the job asks for. Deterministic, no LLM (research R1). */
export function jobRequirements(job: TailorJob): JobRequirements {
  const text = `${job.title}\n${job.description ?? ''}`;
  const defs = [...techMentions(text), ...findSkillsInText(text)];
  const skillOrder = [...new Set(defs.map((d) => d.id))];
  return { skills: new Set(skillOrder), skillOrder, keywords: new Set(words(text)) };
}

/** Relevance of a piece of text to the job: 3 × dictionary skills + keyword overlap (capped). */
export function relevance(text: string, req: JobRequirements): number {
  const ids = new Set([...techMentions(text), ...findSkillsInText(text)].map((d) => d.id));
  const skillHits = [...ids].filter((id) => req.skills.has(id)).length;
  const kw = new Set(words(text));
  const kwHits = [...kw].filter((w) => req.keywords.has(w)).length;
  return 3 * skillHits + Math.min(kwHits, 6);
}

const v = (f: ProfileFact) => (f.value ?? {}) as Record<string, unknown>;

/**
 * Selection/ordering plan (FR-002): experiences stay reverse-chronological, their bullets reorder by
 * relevance; projects/certifications sort by relevance; skills: job-matched first (job order), then by
 * evidence. Text is never changed.
 */
export function rankForJob(job: TailorJob, facts: ProfileFact[]): TailorPlan {
  const req = jobRequirements(job);
  const plan: TailorPlan = { bulletOrder: {}, entryOrder: {}, skillOrder: [], hiddenItemIds: [], relevance: {} };

  for (const f of facts.filter((x) => x.kind === 'experience' || x.kind === 'project')) {
    const hl = Array.isArray(v(f).highlights) ? (v(f).highlights as string[]) : [];
    const scores = hl.map((h, i) => ({ i, s: relevance(h, req) }));
    scores.forEach(({ i, s }) => (plan.relevance[`${f.id}#h${i}`] = s));
    plan.bulletOrder[f.id] = [...scores].sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.i);
    plan.relevance[f.id] = relevance(factSummary(f), req);
  }
  for (const kind of ['project', 'certification'] as const) {
    const list = facts.filter((f) => f.kind === kind);
    for (const f of list) plan.relevance[f.id] ??= relevance(factSummary(f), req);
    plan.entryOrder[kind] = [...list].sort((a, b) => plan.relevance[b.id]! - plan.relevance[a.id]!).map((f) => f.id);
  }

  const skills = facts.filter((f) => f.kind === 'skill');
  const skillId = (f: ProfileFact) => (findSkillsInText(String(v(f).name ?? ''))[0] ?? techMentions(String(v(f).name ?? ''))[0])?.id;
  const evidence = (f: ProfileFact) => (v(f).evidence as { repoCount?: number } | undefined)?.repoCount ?? 0;
  plan.skillOrder = [...skills]
    .map((f) => ({ f, pos: req.skillOrder.indexOf(skillId(f) ?? '') }))
    .sort((a, b) => (a.pos < 0 ? 1e9 : a.pos) - (b.pos < 0 ? 1e9 : b.pos) || evidence(b.f) - evidence(a.f))
    .map((x) => x.f.id);
  for (const s of skills) plan.relevance[s.id] = req.skills.has(skillId(s) ?? '') ? 3 : 0;
  return plan;
}

/**
 * Items to hide, in order, when the tailored resume overflows one page: lowest-relevance bullets of
 * the oldest experiences first (never the last bullet of an entry), then least relevant projects.
 */
export function overflowCandidates(plan: TailorPlan, facts: ProfileFact[]): string[] {
  const exps = facts
    .filter((f) => f.kind === 'experience')
    .sort((a, b) => compareLooseDate(v(a).start as LooseDate, v(b).start as LooseDate)); // oldest first
  const out: string[] = [];
  for (const e of exps) {
    const order = plan.bulletOrder[e.id] ?? [];
    for (const i of [...order].reverse().slice(0, Math.max(0, order.length - 1))) out.push(`${e.id}#h${i}`);
  }
  out.sort((a, b) => (plan.relevance[a] ?? 0) - (plan.relevance[b] ?? 0)); // stable: oldest first within ties
  const projects = [...(plan.entryOrder.project ?? [])].reverse();
  return [...out, ...projects];
}
