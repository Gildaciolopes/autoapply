import type { PrismaClient } from './generated/prisma/client.js';
import { usableFactsWhere } from './facts.js';

export type TailorKind = 'resume' | 'cover_letter';

/** (Re)creates the documents for a job in `queued` state; returns their ids (one per kind). */
export async function queueTailorDocuments(db: PrismaClient, jobId: string, kinds: TailorKind[]): Promise<string[]> {
  const ids: string[] = [];
  for (const kind of kinds) {
    const doc = await db.tailoredDocument.upsert({
      where: { jobId_kind: { jobId, kind } },
      create: { jobId, kind, status: 'queued' },
      update: { status: 'queued', error: null, approvedAt: null, userEdited: false },
    });
    ids.push(doc.id);
  }
  return ids;
}

/** Usable facts with the fields needed for hashing/validation. */
export function loadUsableFacts(db: PrismaClient) {
  return db.fact.findMany({
    where: usableFactsWhere,
    select: { id: true, kind: true, value: true, updatedAt: true, verifiedByUser: true, status: true, hasOpenConflict: true },
  });
}

/** Job + usable facts + profile + organization names + output language for tailoring (worker and API). */
export async function loadTailorBasics(db: PrismaClient, jobId: string) {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: { company: true } });
  const [facts, profile, companies, resume] = await Promise.all([
    loadUsableFacts(db),
    db.profile.findUnique({ where: { id: 'me' } }),
    db.company.findMany({ select: { name: true }, take: 2000 }),
    db.resumeBase.findFirst({ where: { active: true }, select: { parsed: true } }),
  ]);
  const own = facts.flatMap((f) => {
    const v = (f.value ?? {}) as { company?: string; institution?: string; issuer?: string };
    return [v.company, v.institution, v.issuer].filter((x): x is string => Boolean(x));
  });
  const lang: 'pt' | 'en' = (resume?.parsed as { lang?: string } | null)?.lang === 'en' ? 'en' : 'pt';
  return {
    job: { id: job.id, title: job.title, company: job.company?.name ?? '', description: job.description },
    facts,
    profile,
    knownOrgs: [...new Set([...own, ...companies.map((c) => c.name)])],
    lang,
  };
}
export type TailorBasics = Awaited<ReturnType<typeof loadTailorBasics>>;
