import { describe, expect, it } from 'vitest';
import { findNumbers, numberInText } from '../src/numbers.js';

describe('findNumbers', () => {
  it('digits, percents, separators, multipliers and words', () => {
    expect(findNumbers('latência p95 em 40% para 2 milhões de eventos e 300 lojas')).toEqual([40, 2_000_000, 300]);
    expect(findNumbers('R$ 2.000 e 3,5 anos, 10k usuários')).toEqual([2000, 3.5, 10_000]);
    expect(findNumbers('cinco anos, twenty users, um time')).toEqual([5, 20]);
  });
  it('ignores digits that are part of names', () => {
    expect(findNumbers('HTML5, S3, ES6, Vue3 e p95')).toEqual([]);
  });
  it('numberInText', () => {
    expect(numberInText(40, 'reduzindo em 40%')).toBe(true);
    expect(numberInText(60, 'reduzindo em 40%')).toBe(false);
  });
});
