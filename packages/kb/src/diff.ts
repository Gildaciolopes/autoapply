import type { FactOrigin } from '@autoapply/shared';
import type { Candidate, FactLike } from './types.js';

export interface SnapshotDiff {
  /** Facts that had sources from this origin and none of them was seen now → flag missingFrom. */
  missing: string[];
  /** Facts previously flagged missing from this origin that came back. */
  returned: string[];
  /** Refs seen now (for lastSeenAt refresh). */
  seenRefs: Set<string>;
}

/**
 * Sync diff (FR-025): vanished items are flagged, never deleted or archived. Only call with a
 * COMPLETE snapshot — a partial import (rate limit) must not mark anything missing.
 */
export function diffSnapshot(existing: FactLike[], candidates: Candidate[], origin: FactOrigin): SnapshotDiff {
  const seenRefs = new Set(candidates.map((c) => c.source.ref));
  const seenKeys = new Set(candidates.map((c) => `${c.kind}|${c.key}`));
  const missing: string[] = [];
  const returned: string[] = [];
  for (const f of existing) {
    if (f.status !== 'active') continue;
    const fromOrigin = f.sources.filter((s) => s.origin === origin);
    const present = seenKeys.has(`${f.kind}|${f.key}`) || fromOrigin.some((s) => seenRefs.has(s.ref));
    if (fromOrigin.length && !present && !f.missingFrom?.includes(origin)) missing.push(f.id);
    if (present && f.missingFrom?.includes(origin)) returned.push(f.id);
  }
  return { missing, returned, seenRefs };
}
