import type { FactKind, FactOrigin } from '@autoapply/shared';

/** Where a candidate value came from (becomes a FactSource row). */
export interface CandidateSource {
  origin: FactOrigin;
  ref: string;
  rawValue: unknown;
  snippet?: string;
}

/** A fact proposed by an importer, before merging with the store. */
export interface Candidate {
  kind: FactKind;
  key: string;
  value: unknown;
  source: CandidateSource;
  /** Draft item id when coming from a ResumeDraft (e.g. "work-0"). */
  itemId?: string;
}

/** Minimal shape of a stored fact needed by the pure merge logic. */
export interface FactLike {
  id: string;
  kind: FactKind;
  key: string;
  value: unknown;
  verifiedByUser: boolean;
  status: 'active' | 'archived';
  sources: { origin: FactOrigin; ref: string }[];
  missingFrom?: string[];
}

export interface NewFact {
  kind: FactKind;
  key: string;
  value: unknown;
  sources: CandidateSource[];
  itemIds: string[];
}

export interface MergeResult {
  /** New facts (batch-deduplicated by key). */
  create: NewFact[];
  /** Equal value already stored → only add/refresh the source. */
  addSource: { factId: string; source: CandidateSource }[];
  /** Unverified fact whose only sources are the same origin → value refreshed from that origin. */
  update: { factId: string; before: unknown; value: unknown; source: CandidateSource }[];
  /** Same key, different value, cannot be updated silently → FactConflict(value_mismatch). */
  conflicts: { factId: string; existingValue: unknown; candidate: Candidate }[];
  /** New fact that looks like an existing one (e.g. "Itaú" vs "Itau Unibanco") → FactConflict(possible_duplicate). */
  duplicates: { newKey: string; kind: FactKind; existingFactId: string }[];
}
