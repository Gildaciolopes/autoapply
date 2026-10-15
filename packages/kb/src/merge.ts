import type { FactKind } from '@autoapply/shared';
import { sameValue } from './compare.js';
import { sameOrganization } from './normalize.js';
import type { Candidate, FactLike, MergeResult, NewFact } from './types.js';

export interface MergeOptions {
  /**
   * User-approved candidates (resume confirm, manual edit): a differing value replaces the stored
   * one (recorded as update) instead of opening a conflict. Never used by importers/sync.
   */
  trusted?: boolean;
}

const orgField: Partial<Record<FactKind, string>> = { experience: 'company', education: 'institution' };

/**
 * Pure merge of importer candidates into the fact store (research R7, FR-018, FR-025).
 * Invariant: without `trusted`, a verified fact's value is never changed.
 */
export function mergeCandidates(existing: FactLike[], candidates: Candidate[], opts: MergeOptions = {}): MergeResult {
  const result: MergeResult = { create: [], addSource: [], update: [], conflicts: [], duplicates: [] };
  const byKey = new Map(existing.map((f) => [`${f.kind}|${f.key}`, f]));
  const created = new Map<string, NewFact>();
  const refreshed = new Set<string>();

  for (const c of candidates) {
    const id = `${c.kind}|${c.key}`;
    const fact = byKey.get(id);

    if (fact) {
      const onlySameOrigin = fact.sources.length > 0 && fact.sources.every((s) => s.origin === c.source.origin);
      if (sameValue(c.kind, fact.value, c.value)) {
        // Same identity; refresh details (e.g. GitHub evidence) of unverified facts owned by this origin.
        const detailsChanged = JSON.stringify(fact.value) !== JSON.stringify(c.value);
        if (detailsChanged && !fact.verifiedByUser && onlySameOrigin && !refreshed.has(fact.id)) {
          refreshed.add(fact.id);
          result.update.push({ factId: fact.id, before: fact.value, value: c.value, source: c.source });
        } else {
          result.addSource.push({ factId: fact.id, source: c.source });
        }
        continue;
      }
      if (opts.trusted || (!fact.verifiedByUser && onlySameOrigin)) {
        if (refreshed.has(fact.id)) {
          result.addSource.push({ factId: fact.id, source: c.source });
          continue;
        }
        refreshed.add(fact.id);
        result.update.push({ factId: fact.id, before: fact.value, value: c.value, source: c.source });
      } else {
        result.conflicts.push({ factId: fact.id, existingValue: fact.value, candidate: c });
      }
      continue;
    }

    const pending = created.get(id);
    if (pending) {
      pending.sources.push(c.source);
      if (c.itemId) pending.itemIds.push(c.itemId);
      continue;
    }
    const nf: NewFact = { kind: c.kind, key: c.key, value: c.value, sources: [c.source], itemIds: c.itemId ? [c.itemId] : [] };
    created.set(id, nf);
    result.create.push(nf);

    const field = orgField[c.kind];
    if (field) {
      const org = String((c.value as Record<string, unknown>)[field] ?? '');
      const twin = existing.find(
        (f) => f.kind === c.kind && f.status === 'active' && sameOrganization(org, String((f.value as Record<string, unknown>)[field] ?? '')),
      );
      if (twin) result.duplicates.push({ newKey: c.key, kind: c.kind, existingFactId: twin.id });
    }
  }
  return result;
}
