import { describe, expect, it } from 'vitest';
import { parseLooseDate, splitRange } from '../src/dates.js';

describe('parseLooseDate', () => {
  it.each([
    ['atual', 'present'],
    ['Presente', 'present'],
    ['hoje', 'present'],
    ['até o momento', 'present'],
    ['Present', 'present'],
  ])('%s → present', (input, out) => expect(parseLooseDate(input)).toBe(out));

  it('parses month forms', () => {
    expect(parseLooseDate('mar 2021')).toEqual({ year: 2021, month: 3, precision: 'month' });
    expect(parseLooseDate('Março de 2021')).toEqual({ year: 2021, month: 3, precision: 'month' });
    expect(parseLooseDate('Set. 2019')).toEqual({ year: 2019, month: 9, precision: 'month' });
    expect(parseLooseDate('September 2019')).toEqual({ year: 2019, month: 9, precision: 'month' });
    expect(parseLooseDate('03/2021')).toEqual({ year: 2021, month: 3, precision: 'month' });
    expect(parseLooseDate('2021-03')).toEqual({ year: 2021, month: 3, precision: 'month' });
  });

  it('keeps year precision without inventing a month', () => {
    expect(parseLooseDate('2020')).toEqual({ year: 2020, precision: 'year' });
  });

  it('returns null for garbage', () => {
    expect(parseLooseDate('algum dia')).toBeNull();
    expect(parseLooseDate('13/2021')).toBeNull();
    expect(parseLooseDate('')).toBeNull();
  });

  it('splits ranges', () => {
    expect(splitRange('2021 – hoje')).toEqual(['2021', 'hoje']);
    expect(splitRange('mar 2019 - dez 2020')).toEqual(['mar 2019', 'dez 2020']);
  });
});
