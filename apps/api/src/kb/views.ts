import type { ConflictView, FactRevisionView, FactView, ResumeSummary, SyncRunView } from '@autoapply/shared';
import type { Fact, FactConflict, FactRevision, FactSource, ResumeBase, SyncRun } from '@autoapply/db';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export type FactWithRelations = Fact & { sources: FactSource[]; conflicts?: Pick<FactConflict, 'id' | 'status'>[] };

export function toFactView(f: FactWithRelations): FactView {
  return {
    id: f.id,
    kind: f.kind,
    key: f.key,
    value: f.value,
    verifiedByUser: f.verifiedByUser,
    status: f.status,
    hasOpenConflict: f.hasOpenConflict,
    missingFrom: f.missingFrom,
    sources: f.sources.map((s) => ({
      id: s.id,
      origin: s.origin,
      ref: s.ref,
      rawValue: s.rawValue,
      snippet: s.snippet,
      importedAt: s.importedAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
    })),
    openConflictId: f.conflicts?.find((c) => c.status === 'open')?.id ?? null,
    updatedAt: f.updatedAt.toISOString(),
  };
}

export const toRevisionView = (r: FactRevision): FactRevisionView => ({
  id: r.id,
  action: r.action,
  before: r.before,
  after: r.after,
  actor: r.actor,
  note: r.note,
  createdAt: r.createdAt.toISOString(),
});

export const toResumeSummary = (r: ResumeBase): ResumeSummary => ({
  id: r.id,
  fileName: r.fileName,
  status: r.status,
  extraction: r.extraction,
  version: r.version,
  active: r.active,
  error: r.error,
  createdAt: r.createdAt.toISOString(),
  confirmedAt: iso(r.confirmedAt),
});

export const toConflictView = (c: FactConflict & { fact: Pick<Fact, 'kind' | 'key'> }): ConflictView => ({
  id: c.id,
  factId: c.factId,
  kind: c.fact.kind,
  key: c.fact.key,
  type: c.type,
  candidates: c.candidates as ConflictView['candidates'],
  otherFactId: c.otherFactId,
  status: c.status,
  createdAt: c.createdAt.toISOString(),
});

export const toSyncRunView = (r: SyncRun): SyncRunView => ({
  id: r.id,
  trigger: r.trigger,
  localDate: r.localDate,
  startedAt: r.startedAt.toISOString(),
  finishedAt: iso(r.finishedAt),
  outcomes: r.outcomes as SyncRunView['outcomes'],
  summary: r.summary as SyncRunView['summary'],
});
