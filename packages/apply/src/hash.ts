import { factsHash, type HashableFact } from '@autoapply/tailor';
import { createHash } from 'node:crypto';

/** Fingerprint of what a simulation relied on: cited facts + attached tailored documents (FR-019). */
export function applicationFactsHash(facts: HashableFact[], tailoredDocs: { id: string; updatedAt: Date | string }[]): string {
  const docs = [...tailoredDocs]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((d) => `${d.id}|${new Date(d.updatedAt).toISOString()}`)
    .join('\n');
  return createHash('sha256').update(`${factsHash(facts)}\n${docs}`).digest('hex');
}
