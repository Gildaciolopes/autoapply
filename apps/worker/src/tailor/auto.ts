import { loadPreferences, queueTailorDocuments, type PrismaClient } from '@autoapply/db';
import { requiresCoverLetter } from '@autoapply/tailor';
import type { TailorPayload } from '@autoapply/shared';

export type EnqueueTailor = (payload: TailorPayload) => Promise<unknown>;

/**
 * US6: after a run, prepare tailored drafts for the best jobs ≥ threshold (bounded, off by default).
 * Jobs that already have a current (not failed/outdated) resume document are skipped.
 */
export async function autoTailor(db: PrismaClient, enqueue: EnqueueTailor): Promise<string[]> {
  const prefs = await loadPreferences(db);
  if (!prefs.autoTailor) return [];
  const jobs = await db.job.findMany({
    where: {
      hidden: false,
      score: { is: { passed: true, score: { gte: prefs.scoreThreshold } } },
      NOT: { tailored: { some: { kind: 'resume', status: { notIn: ['failed', 'outdated'] } } } },
    },
    include: { score: true },
    orderBy: [{ score: { score: 'desc' } }],
    take: prefs.autoTailorN,
  });
  for (const j of jobs) {
    const kinds = requiresCoverLetter(`${j.title}\n${j.description ?? ''}`) ? (['resume', 'cover_letter'] as const) : (['resume'] as const);
    const documentIds = await queueTailorDocuments(db, j.id, [...kinds]);
    await enqueue({ jobId: j.id, documentIds });
  }
  return jobs.map((j) => j.id);
}
