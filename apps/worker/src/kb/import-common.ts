import { applyMerge, loadFactLikes, type Prisma, type PrismaClient } from '@autoapply/db';
import { diffSnapshot, mergeCandidates, type Candidate } from '@autoapply/kb';
import { SourceOutcome, SyncSummary, type FactOrigin } from '@autoapply/shared';

export interface ImportCounts {
  added: string[];
  conflicted: string[];
  missing: string[];
  sourced: number;
}

/**
 * Applies importer candidates: merge (never trusted → verified facts untouched, FR-025),
 * write facts/sources/conflicts, and when the snapshot is complete flag vanished facts
 * (`missingFrom`) without deleting them.
 */
export async function applyImport(
  db: PrismaClient,
  origin: FactOrigin,
  candidates: Candidate[],
  opts: { complete: boolean; actor: 'import' | 'sync' },
): Promise<ImportCounts> {
  const existing = await loadFactLikes(db);
  const merge = mergeCandidates(existing, candidates, {});
  const res = await applyMerge(db, merge, { actor: opts.actor, verify: false, note: `${origin} import` });

  const missing: string[] = [];
  if (opts.complete) {
    const diff = diffSnapshot(existing, candidates, origin);
    for (const id of diff.missing) {
      const f = existing.find((x) => x.id === id)!;
      await db.fact.update({ where: { id }, data: { missingFrom: [...(f.missingFrom ?? []), origin] } });
      missing.push(id);
    }
    for (const id of diff.returned) {
      const f = existing.find((x) => x.id === id)!;
      await db.fact.update({ where: { id }, data: { missingFrom: (f.missingFrom ?? []).filter((o) => o !== origin) } });
    }
  }
  return { added: res.created, conflicted: res.conflicts, missing, sourced: res.sourced.length };
}

/** Records one source's outcome in its SyncRun and the ProfileSource status. */
export async function recordOutcome(
  db: PrismaClient,
  syncRunId: string,
  origin: 'github' | 'linkedin',
  outcome: SourceOutcome,
  counts?: ImportCounts,
  extra: Prisma.ProfileSourceUpdateInput = {},
) {
  const run = await db.syncRun.findUniqueOrThrow({ where: { id: syncRunId } });
  const outcomes = { ...(run.outcomes as Record<string, unknown>), [origin]: outcome };
  const prev = SyncSummary.parse(run.summary ?? {});
  const summary = counts
    ? {
        added: [...prev.added, ...counts.added],
        conflicted: [...new Set([...prev.conflicted, ...counts.conflicted])],
        missing: [...prev.missing, ...counts.missing],
      }
    : prev;
  await db.syncRun.update({
    where: { id: syncRunId },
    data: { outcomes: outcomes as Prisma.InputJsonValue, summary: summary as Prisma.InputJsonValue, finishedAt: new Date() },
  });
  await db.profileSource.update({
    where: { origin },
    data: {
      lastSyncAt: new Date(),
      lastStatus: outcome.status === 'skipped' ? undefined : outcome.status,
      lastError: outcome.error ?? null,
      ...extra,
    },
  });
}

export const countsOf = (c: ImportCounts): SourceOutcome['counts'] => ({
  added: c.added.length,
  sourced: c.sourced,
  conflicts: c.conflicted.length,
  missing: c.missing.length,
});

