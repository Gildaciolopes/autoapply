import { prepareSource, skillKey, valueInSource } from '@autoapply/kb';
import type { ChatMessageLike, JudgeResult, MatchedEvidence, Preferences } from './types.js';
import { factSummary, type ProfileFact } from './profile.js';

export const JUDGE_SYSTEM_PROMPT = `You evaluate how well ONE job posting fits ONE candidate. Rules:
- Use ONLY the candidate facts listed below. Never assume skills or experience that are not listed.
- matched: skills the job asks for that the candidate HAS, each with the ids (in brackets) of the facts that prove it.
- missing: skills/requirements the job asks for that no fact proves.
- score 0-100: 90+ near-perfect fit, 70-89 good, 40-69 partial, <40 poor. Penalize missing must-haves and seniority mismatch.
- reasons: 2-3 short sentences in Brazilian Portuguese.`;

export interface JudgeJob {
  title: string;
  company: string;
  location?: string | null;
  workMode?: string | null;
  seniority?: string | null;
  description?: string | null;
}

export function buildJudgeMessages(job: JudgeJob, facts: ProfileFact[], prefs: Preferences): ChatMessageLike[] {
  const factLines = facts
    .filter((f) => ['skill', 'experience', 'project', 'education', 'certification', 'language'].includes(f.kind))
    .map((f) => `[${f.id}] ${f.kind}: ${factSummary(f)}`)
    .join('\n');
  const desc = (job.description ?? '').slice(0, 6000);
  const user = `CANDIDATE FACTS:\n${factLines || '(none)'}\n\nCANDIDATE PREFERENCES: roles=${prefs.roles.join(', ') || '-'}; seniority=${prefs.seniority.join(', ') || '-'}\n\nJOB:\nTitle: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location ?? '-'} (${job.workMode ?? 'mode unknown'})\nSeniority: ${job.seniority ?? 'unknown'}\nDescription:\n${desc || '(no description)'}`;
  return [
    { role: 'system', content: JUDGE_SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

export interface GroundedJudgement {
  score: number;
  matched: MatchedEvidence[];
  missing: string[];
  demoted: string[];
  reasons: string;
}

/**
 * FR-014: keep a "matched" skill only when one of its cited facts is usable AND proves it — a skill fact
 * with the same canonical id, or an experience/project whose text names the skill. Otherwise → missing.
 */
export function groundMatches(result: JudgeResult, usableFacts: ProfileFact[]): GroundedJudgement {
  const byId = new Map(usableFacts.map((f) => [f.id, f]));
  const matched: MatchedEvidence[] = [];
  const demoted: string[] = [];
  for (const m of result.matched) {
    const key = skillKey(m.skill);
    const proving = m.factIds.filter((id) => {
      const f = byId.get(id);
      if (!f) return false;
      if (f.kind === 'skill') return skillKey(String((f.value as { name?: string }).name ?? '')) === key;
      if (f.kind === 'experience' || f.kind === 'project') return valueInSource(prepareSource(factSummary(f)), m.skill, { skill: true });
      return false;
    });
    if (proving.length && !matched.some((x) => skillKey(x.skill) === key)) matched.push({ skill: m.skill, factIds: proving });
    else if (!proving.length) demoted.push(m.skill);
  }
  const matchedKeys = new Set(matched.map((m) => skillKey(m.skill)));
  const missing = [...new Set([...result.missing, ...demoted])].filter((s) => !matchedKeys.has(skillKey(s)));
  return { score: result.score, matched, missing, demoted, reasons: result.reasons };
}
