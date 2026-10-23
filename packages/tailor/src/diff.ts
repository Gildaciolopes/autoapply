/** Structural shape shared with @autoapply/resume RenderModel (kept local to avoid a render dependency). */
export interface DiffModel {
  sections: { id: string; entries: { id: string; text?: string; bullets: { id: string; text: string }[] }[] }[];
}

export interface PlanDiff {
  moved: { id: string; from: number; to: number }[];
  hidden: string[];
  summary: { before: string | null; after: string | null };
  skillsReordered: boolean;
}

const items = (m: DiffModel) =>
  m.sections.flatMap((s) => (s.id === 'summary' || s.id === 'skills' ? [] : s.entries.flatMap((e) => [e.id, ...e.bullets.map((b) => b.id)])));
const summaryOf = (m: DiffModel) => m.sections.find((s) => s.id === 'summary')?.entries[0]?.text ?? null;
const skillsOf = (m: DiffModel) => m.sections.find((s) => s.id === 'skills')?.entries.map((e) => e.text ?? '').join('|') ?? '';

/** Base vs tailored: what moved, what was hidden, the new summary, and whether skills were reordered (FR-010). */
export function diffModels(base: DiffModel, tailored: DiffModel): PlanDiff {
  const a = items(base);
  const b = items(tailored);
  const posB = new Map(b.map((id, i) => [id, i]));
  const kept = a.filter((id) => posB.has(id));
  const moved = kept
    .map((id, i) => ({ id, from: i, to: kept.indexOf(id) === i ? b.filter((x) => kept.includes(x)).indexOf(id) : i }))
    .filter((m) => m.from !== m.to);
  return {
    moved,
    hidden: a.filter((id) => !posB.has(id)),
    summary: { before: summaryOf(base), after: summaryOf(tailored) },
    skillsReordered: skillsOf(base) !== skillsOf(tailored),
  };
}
