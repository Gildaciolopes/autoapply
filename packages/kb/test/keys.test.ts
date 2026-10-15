import { describe, expect, it } from 'vitest';
import { factKey, personalKey, skillKey } from '../src/keys.js';

describe('factKey', () => {
  it('canonicalizes skills through the dictionary', () => {
    expect(skillKey('Postgres')).toBe('skill:postgresql');
    expect(skillKey('PostgreSQL')).toBe('skill:postgresql');
    expect(skillKey('Node.js')).toBe('skill:nodejs');
    expect(skillKey('Some Unknown Tool')).toBe('skill:some-unknown-tool');
  });
  it('keys experience by company + start year', () => {
    const k = factKey('experience', { company: 'Itaú Unibanco S.A.', title: 'Dev', start: { year: 2021, month: 3, precision: 'month' } });
    expect(k).toBe('experience:itau-unibanco:2021');
    expect(factKey('experience', { company: 'Itau Unibanco', title: 'Other', start: { year: 2021, precision: 'year' } })).toBe(k);
  });
  it('keys personal fields', () => {
    expect(personalKey('salaryExpectation')).toBe('personal:salary_expectation');
    expect(factKey('personal', { field: 'pcd' })).toBe('personal:pcd');
  });
});
