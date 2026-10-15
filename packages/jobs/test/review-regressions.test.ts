/** Regression tests for PR #2 code-review fixes. */
import { describe, expect, it } from 'vitest';
import { Preferences } from '@autoapply/shared';
import { cleanDescription, detectSeniority, normalizeTitle, parseSalary } from '../src/normalize.js';
import { planDiscovery } from '../src/plan.js';

describe('planDiscovery never asks a board for more than its remaining cap', () => {
  const prefs = Preferences.parse({ roles: ['A', 'B', 'C'] });
  const limits = (remaining: number) => planDiscovery('r', prefs, [{ type: 'gupy', enabled: true, remaining }]).map((c) => c.data.limit);
  it.each([
    [10, [4, 3, 3]],
    [2, [1, 1]],
    [1, [1]],
    [0, []],
  ])('remaining %i → %j', (remaining, expected) => {
    expect(limits(remaining)).toEqual(expected);
    expect(limits(remaining).reduce((a, b) => a + b, 0)).toBe(remaining);
  });
});

describe('normalize edge cases', () => {
  it('decodes numeric and accented named entities', () => {
    expect(cleanDescription('Experi&ecirc;ncia em integra&ccedil;&atilde;o &#233; &#xE9;')).toBe('Experiência em integração é é');
  });
  it('PL/SQL is not "pleno"', () => {
    expect(detectSeniority('Desenvolvedor PL/SQL')).toBeNull();
    expect(detectSeniority('Desenvolvedor PL')).toBe('mid');
    expect(normalizeTitle('Desenvolvedor PL/SQL')).toContain('pl');
  });
  it('"R$ 3.5k" is 3500, "R$ 8.000" is 8000', () => {
    expect(parseSalary(null, null, 'Salário R$ 3.5k')).toMatchObject({ min: 3500 });
    expect(parseSalary(null, null, 'Salário R$ 8.000')).toMatchObject({ min: 8000 });
  });
  it('free-text descriptions only count amounts next to a salary word', () => {
    const d = 'Benefícios: vale refeição R$ 800/mês. Faixa salarial: R$ 12.000 - 15.000';
    expect(parseSalary(null, null, d, { requireContext: true })).toMatchObject({ min: 12000, max: 15000 });
    expect(parseSalary(null, null, 'Vale refeição R$ 800/mês', { requireContext: true })).toMatchObject({ min: null, max: null });
    expect(parseSalary(7000, 9000, d, { requireContext: true }).text).toBeNull();
  });
});
