import { createHash } from 'node:crypto';

export interface HashableFact {
  id: string;
  updatedAt: Date | string;
  verifiedByUser: boolean;
  status: string;
  hasOpenConflict: boolean;
}

/** Fingerprint of the facts a document depends on; any change → document outdated (FR-011). */
export function factsHash(facts: HashableFact[]): string {
  const rows = [...facts]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((f) => `${f.id}|${new Date(f.updatedAt).toISOString()}|${f.verifiedByUser}|${f.status}|${f.hasOpenConflict}`);
  return createHash('sha256').update(rows.join('\n')).digest('hex');
}
