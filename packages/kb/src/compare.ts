import type { FactKind } from '@autoapply/shared';
import { normalizeCompany, normalizeText } from './normalize.js';

const n = (v: unknown) => (typeof v === 'string' ? normalizeText(v) : JSON.stringify(v ?? null));

/**
 * Projection of the fields that define "same value" per kind. Extra details (highlights,
 * GitHub evidence, descriptions) are not part of identity: they are merged or shown, not conflicts.
 */
export function comparable(kind: FactKind, value: unknown): string {
  const v = (value ?? {}) as Record<string, unknown>;
  switch (kind) {
    case 'experience':
      return [normalizeCompany(String(v.company ?? '')), n(v.title), n(v.start), n(v.end)].join('|');
    case 'education':
      return [normalizeCompany(String(v.institution ?? '')), n(v.degree), n(v.area), n(v.start), n(v.end)].join('|');
    case 'skill':
      return 'skill'; // identity is the key (canonical id)
    case 'certification':
      return [n(v.name), n(v.issuer)].join('|');
    case 'language':
      return [n(v.language), n(v.fluency)].join('|');
    case 'project':
      return n(v.name);
    default:
      return JSON.stringify(value ?? null);
  }
}

export function sameValue(kind: FactKind, a: unknown, b: unknown): boolean {
  return comparable(kind, a) === comparable(kind, b);
}
