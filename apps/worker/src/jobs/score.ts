import { hasProfileVector, loadPreferences, jobSimilarities, jobsWithoutEmbedding, setJobEmbedding, setProfileVector, usableFactsWhere, type Prisma } from '@autoapply/db';
import { applyHardFilters, buildJudgeMessages, groundMatches, profileHash, profileText, similarityToScore, toFilterable, type ProfileFact } from '@autoapply/jobs';
import { JudgeResult, type FilterReason } from '@autoapply/shared';
import { runEvent, type KbDeps } from '../kb/deps.js';

export interface ScoreOptions {
  judge: boolean;
  /** Re-judge even if already judged with the same profile (rescore). */
  force?: boolean;
}

export interface ScoreStats {
  filtered: Record<string, number>;
  passed: number;
  judged: number;
  judgeFailed: number;
}

const EMBED_BATCH = 16;
const jobText = (j: { title: string; company: { name: string } | null; description: string | null }) =>
  `${j.title}\n${j.company?.name ?? ''}\n${(j.description ?? '').slice(0, 2000)}`;

/**
 * Scoring stage (US3): hard filters → embeddings → cosine vs profile → LLM judge for the top N,
 * with matched skills grounded against usable facts (FR-010..FR-015).
 */
export async function scoreJobs(deps: KbDeps, jobIds: string[], opts: ScoreOptions): Promise<ScoreStats> {
  const { db } = deps;
  const stats: ScoreStats = { filtered: {}, passed: 0, judged: 0, judgeFailed: 0 };
  const prefs = await loadPreferences(db);
  const facts: ProfileFact[] = (await db.fact.findMany({ where: usableFactsWhere, select: { id: true, kind: true, value: true } })).map((f) => ({
    id: f.id,
    kind: f.kind,
    value: f.value,
  }));
  const jobs = await db.job.findMany({ where: { id: { in: jobIds }, hidden: false }, include: { company: true, score: true, origins: true } });

  // 1. hard filters
  const passing: typeof jobs = [];
  for (const j of jobs) {
    const r = applyHardFilters(toFilterable(j), prefs);
    if (!r.passed) {
      for (const o of j.origins) stats.filtered[o.source] = (stats.filtered[o.source] ?? 0) + 1;
      await upsertScore(db, j.id, { passed: false, filterReason: r.reason, score: 0, judged: false, reasons: '', model: 'filters' });
      continue;
    }
    passing.push(j);
  }
  stats.passed = passing.length;
  if (!passing.length) return stats;

  // 2. embeddings (jobs + cached profile)
  const missing = new Set(await jobsWithoutEmbedding(db, passing.map((j) => j.id)));
  const toEmbed = passing.filter((j) => missing.has(j.id));
  for (let i = 0; i < toEmbed.length; i += EMBED_BATCH) {
    const batch = toEmbed.slice(i, i + EMBED_BATCH);
    const vectors = await deps.llm.embed(batch.map(jobText));
    for (const [k, j] of batch.entries()) if (vectors[k]?.length) await setJobEmbedding(db, j.id, vectors[k]!);
  }
  const ptext = profileText(facts, prefs);
  const phash = profileHash(ptext);
  if (!(await hasProfileVector(db, phash))) {
    const [v] = await deps.llm.embed([ptext]);
    if (v?.length) await setProfileVector(db, phash, ptext, v);
  }

  // 3. similarity → pre-judge score
  const sims = new Map((await jobSimilarities(db, phash, passing.map((j) => j.id))).map((s) => [s.jobId, Number(s.cosine)]));
  const embedModel = process.env.OLLAMA_EMBED_MODEL ?? 'bge-m3';
  for (const j of passing) {
    const cos = sims.get(j.id) ?? null;
    const keepJudgement = j.score?.judged && j.score.profileHash === phash && !opts.force;
    if (keepJudgement) {
      await db.jobScore.update({ where: { jobId: j.id }, data: { passed: true, filterReason: null, similarity: cos } });
      continue;
    }
    await upsertScore(db, j.id, {
      passed: true,
      filterReason: null,
      similarity: cos,
      score: cos === null ? 0 : similarityToScore(cos),
      judged: false,
      reasons: '',
      model: embedModel,
      profileHash: phash,
    });
  }

  // 4. judge top N by similarity (skipped without description or without usable facts)
  if (!opts.judge || prefs.judgeTopN === 0) return stats;
  const hasEvidence = facts.some((f) => f.kind === 'skill' || f.kind === 'experience');
  const pending = passing
    .filter((j) => !(j.score?.judged && j.score.profileHash === phash && !opts.force))
    .sort((a, b) => (sims.get(b.id) ?? -1) - (sims.get(a.id) ?? -1));
  if (!hasEvidence) {
    await runEvent(db, 'warn', 'judge skipped: no verified skill/experience facts yet');
    return stats;
  }
  // Jobs without a description can't be judged: they don't take one of the top-N judge slots.
  const candidates: typeof pending = [];
  for (const j of pending) {
    if (j.description?.trim()) {
      if (candidates.length < prefs.judgeTopN) candidates.push(j);
    } else if (candidates.length < prefs.judgeTopN) {
      await db.jobScore.update({ where: { jobId: j.id }, data: { reasons: 'Sem descrição: avaliado só pela similaridade do título.' } });
    }
  }
  for (const j of candidates) {
    try {
      const raw = await deps.llm.generateObject({
        schema: JudgeResult,
        model: deps.models.chat,
        temperature: 0,
        numCtx: 16384,
        messages: buildJudgeMessages(
          { title: j.title, company: j.company?.name ?? '', location: j.location, workMode: j.workMode, seniority: j.seniority, description: j.description },
          facts,
          prefs,
        ),
      });
      const g = groundMatches(raw, facts);
      await db.jobScore.update({
        where: { jobId: j.id },
        data: {
          score: g.score,
          judged: true,
          matched: g.matched.map((m) => m.skill),
          matchedEvidence: g.matched as Prisma.InputJsonValue,
          missing: g.missing,
          demoted: g.demoted,
          reasons: g.reasons,
          model: `${deps.models.chat}+${embedModel}`,
          profileHash: phash,
        },
      });
      stats.judged++;
      if (g.demoted.length) await runEvent(db, 'warn', `judge: ${g.demoted.length} unevidenced skill(s) moved to missing`, { jobId: j.id, demoted: g.demoted });
    } catch (err) {
      stats.judgeFailed++;
      await runEvent(db, 'warn', `judge failed for ${j.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return stats;
}

async function upsertScore(
  db: KbDeps['db'],
  jobId: string,
  data: { passed: boolean; filterReason: FilterReason | null; score: number; judged: boolean; reasons: string; model: string; similarity?: number | null; profileHash?: string },
) {
  const base = { ...data, matched: [], matchedEvidence: [] as Prisma.InputJsonValue, missing: [], demoted: [] };
  await db.jobScore.upsert({ where: { jobId }, create: { jobId, ...base }, update: base });
}
