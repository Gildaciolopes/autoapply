import { describe, expect, it } from 'vitest';
import { normalizeCompany, normalizeText, sameOrganization, slug } from '../src/normalize.js';

describe('normalize', () => {
  it('normalizes text', () => {
    expect(normalizeText('  Engenheiro  de SOFTWARE – Sênior ')).toBe('engenheiro de software senior');
    expect(slug('Itaú Unibanco S.A.')).toBe('itau-unibanco-s.a');
  });
  it('strips legal suffixes', () => {
    expect(normalizeCompany('Itaú Unibanco S.A.')).toBe('itau unibanco');
    expect(normalizeCompany('Xeno Tecnologia Ltda.')).toBe('xeno tecnologia');
    expect(normalizeCompany('Acme, Inc.')).toBe('acme');
  });
  it('detects same organization written differently', () => {
    expect(sameOrganization('Itaú', 'Itau Unibanco S.A.')).toBe(true);
    expect(sameOrganization('Nubank', 'Nu Bank')).toBe(true);
    expect(sameOrganization('Nubank', 'Stone')).toBe(false);
    expect(sameOrganization('Go', 'Google')).toBe(false);
  });
});
