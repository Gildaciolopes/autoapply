import { loadTailorBasics, type TailorBasics } from '@autoapply/db';
import type { ProfileFact } from '@autoapply/jobs';
import { factSummary } from '@autoapply/jobs';
import { jobRequirements, relevance, type TailorJob } from '@autoapply/tailor';

export type TailorContext = TailorBasics;
export const loadTailorContext = loadTailorBasics;

/** Facts most relevant to the job first (closed context for the LLM, max 25). */
export function factsForPrompt(ctx: TailorContext, max = 25): ProfileFact[] {
  const req = jobRequirements(ctx.job);
  return ctx.facts
    .filter((f) => ['experience', 'skill', 'project', 'education', 'certification', 'language'].includes(f.kind))
    .map((f) => ({ f, s: relevance(factSummary(f), req) + (f.kind === 'experience' ? 2 : 0) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, max)
    .map((x) => x.f);
}
