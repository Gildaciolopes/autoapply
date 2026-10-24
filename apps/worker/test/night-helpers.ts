import { db } from './helpers.js';
import { seedPrefs, seedSources } from './jobs-helpers.js';

/** F6 fixtures: scored jobs with an apply URL on a local test host (never a real platform). */
export async function seedScoredJobs(scores: number[], opts: { passed?: boolean; createdAt?: Date } = {}) {
  const source = (await db.source.findFirst({ where: { type: 'gupy' } })) ?? (await db.source.create({ data: { type: 'gupy', enabled: true, dailyCap: 50 } }));
  const ids: string[] = [];
  for (const [i, score] of scores.entries()) {
    const job = await db.job.create({
      data: {
        sourceId: source.id,
        url: `https://test-ats.local.example/job/${i}-${score}-${Math.random().toString(36).slice(2, 7)}`,
        applyUrl: `https://test-ats.local.example/apply/${i}`,
        title: `Vaga ${i}`,
        dedupeHash: `h-${i}-${score}-${Math.random()}`,
        ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
        score: { create: { passed: opts.passed ?? true, score, matched: [], missing: [], demoted: [], reasons: '', model: 'test' } },
      },
    });
    ids.push(job.id);
  }
  return ids;
}

export async function seedNightPrefs(over: Record<string, unknown> = {}) {
  await seedSources();
  await seedPrefs({ scoreThreshold: 70, nightEnabled: true, ...over });
}
