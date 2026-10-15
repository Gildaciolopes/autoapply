import type { Candidate, CandidateSource, FactLike, MergeResult } from '@autoapply/kb';
import type { ConflictCandidate } from '@autoapply/shared';
import type { Prisma, PrismaClient, RevisionActor } from './generated/prisma/client.js';

type Tx = Prisma.TransactionClient;
const json = (v: unknown) => (v ?? null) as Prisma.InputJsonValue;

export interface ApplyOptions {
  actor: RevisionActor;
  /** Only user actions (resume confirm, manual entry) may verify facts (constitution §II). */
  verify: boolean;
  note?: string;
}

export interface ApplyResult {
  created: string[];
  updated: string[];
  sourced: string[];
  conflicts: string[];
}

/** Loads active + archived facts in the shape the pure merge logic expects. */
export async function loadFactLikes(db: PrismaClient | Tx, where: Prisma.FactWhereInput = {}): Promise<FactLike[]> {
  const rows = await db.fact.findMany({ where, include: { sources: { select: { origin: true, ref: true } } } });
  return rows.map((f) => ({
    id: f.id,
    kind: f.kind,
    key: f.key,
    value: f.value,
    verifiedByUser: f.verifiedByUser,
    status: f.status,
    sources: f.sources,
    missingFrom: f.missingFrom,
  }));
}

async function upsertSource(tx: Tx, factId: string, s: CandidateSource): Promise<boolean> {
  const where = { factId_origin_ref: { factId, origin: s.origin, ref: s.ref } };
  const existing = await tx.factSource.findUnique({ where, select: { id: true } });
  if (existing) {
    await tx.factSource.update({ where, data: { rawValue: json(s.rawValue), snippet: s.snippet ?? null, lastSeenAt: new Date() } });
    return false;
  }
  await tx.factSource.create({ data: { factId, origin: s.origin, ref: s.ref, rawValue: json(s.rawValue), snippet: s.snippet ?? null } });
  return true;
}

async function existingAsCandidate(tx: Tx, factId: string, value: unknown): Promise<ConflictCandidate> {
  const src = await tx.factSource.findFirst({ where: { factId }, orderBy: { importedAt: 'asc' } });
  return {
    origin: src?.origin ?? 'user',
    ref: src?.ref ?? 'unknown',
    value,
    importedAt: (src?.importedAt ?? new Date()).toISOString(),
  };
}

const asCandidate = (c: Candidate): ConflictCandidate => ({
  origin: c.source.origin,
  ref: c.source.ref,
  value: c.value,
  importedAt: new Date().toISOString(),
});

/**
 * Applies a MergeResult in one transaction, writing FactSource + FactRevision rows.
 * Invariants (contracts/queue-sync-profile.md): every created fact has ≥1 source; with
 * `verify:false` nothing becomes verified; verified values only change through `update`
 * entries, which the pure merge produces for user-trusted input only.
 */
export async function applyMerge(db: PrismaClient, merge: MergeResult, opts: ApplyOptions): Promise<ApplyResult> {
  const out: ApplyResult = { created: [], updated: [], sourced: [], conflicts: [] };
  await db.$transaction(async (tx) => {
    const createdByKey = new Map<string, string>();

    for (const nf of merge.create) {
      if (nf.sources.length === 0) throw new Error(`fact ${nf.key} has no source (constitution §I)`);
      const f = await tx.fact.create({
        data: {
          kind: nf.kind,
          key: nf.key,
          value: json(nf.value),
          verifiedByUser: opts.verify,
          sources: {
            create: nf.sources.map((s) => ({ origin: s.origin, ref: s.ref, rawValue: json(s.rawValue), snippet: s.snippet ?? null })),
          },
          revisions: { create: { action: 'created', after: json(nf.value), actor: opts.actor, note: opts.note ?? null } },
        },
      });
      createdByKey.set(`${nf.kind}|${nf.key}`, f.id);
      out.created.push(f.id);
    }

    for (const { factId, source } of merge.addSource) {
      const added = await upsertSource(tx, factId, source);
      if (added) {
        await tx.factRevision.create({ data: { factId, action: 'source_added', after: json({ origin: source.origin, ref: source.ref }), actor: opts.actor } });
      }
      if (opts.verify) {
        const f = await tx.fact.findUniqueOrThrow({ where: { id: factId }, select: { verifiedByUser: true, status: true } });
        if (!f.verifiedByUser || f.status !== 'active') {
          await tx.fact.update({ where: { id: factId }, data: { verifiedByUser: true, status: 'active', missingFrom: [] } });
          await tx.factRevision.create({ data: { factId, action: 'verified', actor: opts.actor } });
        }
      }
      out.sourced.push(factId);
    }

    for (const u of merge.update) {
      await tx.fact.update({
        where: { id: u.factId },
        data: { value: json(u.value), ...(opts.verify ? { verifiedByUser: true, status: 'active' as const } : {}) },
      });
      await upsertSource(tx, u.factId, u.source);
      await tx.factRevision.create({
        data: { factId: u.factId, action: 'edited', before: json(u.before), after: json(u.value), actor: opts.actor, note: opts.note ?? null },
      });
      out.updated.push(u.factId);
    }

    for (const c of merge.conflicts) {
      const cand = asCandidate(c.candidate);
      const open = await tx.factConflict.findFirst({ where: { factId: c.factId, status: 'open', type: 'value_mismatch' } });
      if (open) {
        // Same open conflict: refresh/append this origin's candidate instead of stacking conflicts.
        const list = (open.candidates as ConflictCandidate[]).filter((x) => !(x.origin === cand.origin && x.ref === cand.ref));
        await tx.factConflict.update({ where: { id: open.id }, data: { candidates: json([...list, cand]) } });
        out.conflicts.push(open.id);
        continue;
      }
      const conflict = await tx.factConflict.create({
        data: {
          factId: c.factId,
          type: 'value_mismatch',
          candidates: json([await existingAsCandidate(tx, c.factId, c.existingValue), cand]),
        },
      });
      await tx.fact.update({ where: { id: c.factId }, data: { hasOpenConflict: true } });
      out.conflicts.push(conflict.id);
    }

    for (const d of merge.duplicates) {
      const newId = createdByKey.get(`${d.kind}|${d.newKey}`);
      if (!newId) continue;
      const [a, b] = await Promise.all([
        tx.fact.findUniqueOrThrow({ where: { id: newId } }),
        tx.fact.findUniqueOrThrow({ where: { id: d.existingFactId } }),
      ]);
      const conflict = await tx.factConflict.create({
        data: {
          factId: newId,
          otherFactId: d.existingFactId,
          type: 'possible_duplicate',
          candidates: json([await existingAsCandidate(tx, b.id, b.value), await existingAsCandidate(tx, a.id, a.value)]),
        },
      });
      await tx.fact.update({ where: { id: newId }, data: { hasOpenConflict: true } });
      out.conflicts.push(conflict.id);
    }
  });
  return out;
}

/** Recomputes the denormalized flag after a conflict changes state. */
export async function refreshConflictFlag(db: PrismaClient | Tx, factId: string): Promise<void> {
  const open = await db.factConflict.count({ where: { factId, status: 'open' } });
  await db.fact.update({ where: { id: factId }, data: { hasOpenConflict: open > 0 } });
}
