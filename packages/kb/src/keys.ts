import { findSkillByAlias, type FactKind, type LooseDate, type PersonalField } from '@autoapply/shared';
import { normalizeCompany, slug } from './normalize.js';

const year = (d: LooseDate | null | undefined) => (d && d !== 'present' ? String(d.year) : 'na');

export function skillKey(name: string): string {
  return `skill:${findSkillByAlias(name)?.id ?? slug(name)}`;
}

export function personalKey(field: PersonalField): string {
  return `personal:${field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`;
}

/**
 * Deterministic fact identity (research R7). Same key = same real-world item.
 * Experience is keyed by company + start YEAR so month disagreements between sources
 * surface as value conflicts instead of separate facts.
 */
export function factKey(kind: FactKind, value: Record<string, unknown>): string {
  const str = (k: string) => (typeof value[k] === 'string' ? (value[k] as string) : '');
  switch (kind) {
    case 'skill':
      return skillKey(str('name'));
    case 'experience':
      return `experience:${slug(normalizeCompany(str('company')))}:${year(value.start as LooseDate | null)}`;
    case 'education':
      return `education:${slug(normalizeCompany(str('institution')))}:${slug(str('degree') || str('area') || 'na')}`;
    case 'certification':
      return `certification:${slug(str('name'))}`;
    case 'language':
      return `language:${slug(str('language'))}`;
    case 'project':
      return `project:${slug(str('name'))}`;
    case 'metric':
      return `metric:${slug(str('label'))}`;
    case 'personal':
      return personalKey(str('field') as PersonalField);
    case 'preference':
      return `preference:${slug(str('name'))}`;
  }
}
