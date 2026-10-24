import { describe, expect, it } from 'vitest';
import { lowestHonestOption, matchNumericOption, matchOption, parseRange, preferNotOption, yesNoPolarity } from '../src/options.js';

describe('options', () => {
  it('polarity', () => {
    expect(yesNoPolarity('Sim')).toBe('yes');
    expect(yesNoPolarity('Yes, I am')).toBe('yes');
    expect(yesNoPolarity('Não')).toBe('no');
    expect(yesNoPolarity("No, I don't")).toBe('no');
    expect(yesNoPolarity('Nordeste')).toBeNull();
  });

  it('matchOption: exact, synonyms, containment; short words never contained', () => {
    const modes = ['Presencial', 'Híbrido', '100% Remoto'];
    expect(matchOption(modes, 'remote')).toBe(2);
    expect(matchOption(modes, 'hybrid')).toBe(1);
    expect(matchOption(['Norte', 'Nordeste', 'Sudeste'], 'no')).toBeNull();
    expect(matchOption(['São Paulo', 'Rio de Janeiro'], 'sao paulo')).toBe(0);
    expect(matchOption(['Básico', 'Intermediário', 'Avançado', 'Fluente'], 'intermediate')).toBe(1);
  });

  it('ranges and numeric buckets', () => {
    expect(parseRange('3-5 anos')).toEqual({ min: 3, max: 5 });
    expect(parseRange('Mais de 10 anos')!.min).toBeGreaterThan(10);
    expect(parseRange('5+ years')).toEqual({ min: 5, max: Infinity });
    expect(parseRange('Menos de 1 ano')!.max).toBeLessThan(1);
    expect(parseRange('R$ 10.000 a R$ 15.000')).toEqual({ min: 10000, max: 15000 });
    const opts = ['Menos de 1 ano', '1-2 anos', '3-5 anos', 'Mais de 5 anos'];
    expect(matchNumericOption(opts, 2)).toBe(1);
    expect(matchNumericOption(opts, 5)).toBe(2);
    expect(matchNumericOption(opts, 8)).toBe(3);
    expect(matchNumericOption(opts, 0)).toBe(0);
  });

  it('lowest honest and prefer-not', () => {
    expect(lowestHonestOption(['Sim', 'Não'])).toBe(1);
    expect(lowestHonestOption(['1-2 anos', 'Nenhuma experiência', '3+ anos'])).toBe(1);
    expect(lowestHonestOption(['3-5', '1-2', '6+'])).toBe(1);
    expect(preferNotOption(['Feminino', 'Masculino', 'Prefiro não informar'])).toBe(2);
    expect(preferNotOption(['Male', 'Female', 'Decline to self-identify'])).toBe(2);
    expect(preferNotOption(['Sim', 'Não'])).toBeNull();
  });
});
