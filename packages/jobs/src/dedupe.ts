import { createHash } from 'node:crypto';
import { normalizeCompany } from '@autoapply/kb';
import type { RawJob } from '@autoapply/shared';
import { normalizeTitle, type ParsedLocation } from './normalize.js';

/** Same company + normalized title + (remote | UF) = same job across boards (research R5). */
export function dedupeHash(company: string, title: string, loc: ParsedLocation): string {
  const where = loc.remote ? 'remote' : (loc.uf ?? 'na');
  return createHash('sha256').update(`${normalizeCompany(company)}|${normalizeTitle(title)}|${where}`).digest('hex');
}

export function originKey(raw: Pick<RawJob, 'externalId' | 'url'>): string {
  return raw.externalId?.trim() || raw.url;
}
