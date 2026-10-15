import { describe, expect, it } from 'vitest';
import { applyHardFilters, type FilterableJob } from '../src/filters.js';
import { prefs } from './fixtures.js';

const job = (over: Partial<FilterableJob> = {}): FilterableJob => ({
  company: 'Acme',
  title: 'Desenvolvedor Full Stack Sênior',
  description: 'Node.js, React, TypeScript',
  city: null,
  uf: null,
  remote: true,
  workMode: 'remote',
  seniority: 'senior',
  ...over,
});

describe('applyHardFilters', () => {
  const p = prefs();
  it('passes a good job', () => expect(applyHardFilters(job(), p)).toEqual({ passed: true, reason: null }));
  it('blocked company (normalized)', () => expect(applyHardFilters(job({ company: 'Empresa Ruim Ltda.' }), p).reason).toBe('blocked_company'));
  it('excluded keyword whole word only', () => {
    expect(applyHardFilters(job({ description: 'Stack: PHP e Laravel' }), p).reason).toBe('excluded_keyword');
    expect(applyHardFilters(job({ description: 'graphql e phpunit' }), p).passed).toBe(true);
  });
  it('onsite outside preferred modes / places', () => {
    expect(applyHardFilters(job({ remote: false, workMode: 'onsite', uf: 'SP', city: 'São Paulo' }), p).reason).toBe('location_mode');
    expect(applyHardFilters(job({ remote: false, workMode: 'hybrid', uf: 'PE', city: 'Recife' }), p).reason).toBe('location_mode');
    expect(applyHardFilters(job({ remote: false, workMode: 'hybrid', uf: 'SP', city: 'São Paulo' }), p).passed).toBe(true);
  });
  it('remote job when user does not want remote', () => {
    expect(applyHardFilters(job(), prefs({ workModes: ['onsite'] })).reason).toBe('location_mode');
  });
  it('salary only filters when known and below', () => {
    expect(applyHardFilters(job({ salaryMax: 9000 }), p).reason).toBe('salary_below_min');
    expect(applyHardFilters(job({ salaryMax: null, salaryMin: null }), p).passed).toBe(true);
  });
  it('seniority only when detected', () => {
    expect(applyHardFilters(job({ seniority: 'junior', title: 'Desenvolvedor Full Stack Jr' }), p).reason).toBe('seniority');
    expect(applyHardFilters(job({ seniority: null, title: 'Desenvolvedor Full Stack' }), p).passed).toBe(true);
  });
  it('unknown mode/location never filters', () => {
    expect(applyHardFilters(job({ remote: false, workMode: null, uf: 'RS' }), p).passed).toBe(true);
  });
  it('off target role', () => {
    expect(applyHardFilters(job({ title: 'Analista Contábil', description: '' }), p).reason).toBe('off_target');
    expect(applyHardFilters(job({ title: 'React Engineer', description: '' }), p).passed).toBe(true);
  });
});
