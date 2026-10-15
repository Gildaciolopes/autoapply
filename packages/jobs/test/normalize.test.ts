import { describe, expect, it } from 'vitest';
import { cleanDescription, detectSeniority, detectWorkMode, normalizeTitle, parseLocation, parseSalary } from '../src/normalize.js';

describe('normalizeTitle', () => {
  it('strips gender markers, codes and seniority', () => {
    expect(normalizeTitle('Desenvolvedor(a) Full Stack Sênior [REF-123]')).toBe('desenvolvedor full stack');
    expect(normalizeTitle('Desenvolvedor/a Full-Stack Pleno')).toBe('desenvolvedor full stack');
    expect(normalizeTitle('Engenheiro(a) de Software III')).toBe('engenheiro de software');
    expect(normalizeTitle('Desenvolvedor Full Stack (com ênfase em Frontend)')).toBe('desenvolvedor full stack');
  });
});

describe('parseLocation', () => {
  it.each([
    ['São Paulo, SP', { city: 'São Paulo', uf: 'SP', remote: false }],
    ['Recife - PE', { city: 'Recife', uf: 'PE', remote: false }],
    ['Belo Horizonte, Minas Gerais, Brasil', { city: 'Belo Horizonte', uf: 'MG', remote: false }],
    ['Remoto', { city: null, uf: null, remote: true }],
    ['Brasil', { city: null, uf: null, remote: false }],
  ])('%s', (raw, out) => expect(parseLocation(raw)).toEqual(out));
  it('uses separate city/state fields (Gupy)', () => {
    expect(parseLocation(null, 'Curitiba', 'Paraná')).toEqual({ city: 'Curitiba', uf: 'PR', remote: false });
  });
});

describe('detectWorkMode / detectSeniority', () => {
  it('source value wins, then keywords, else null', () => {
    expect(detectWorkMode('on-site', 'remoto')).toBe('onsite');
    expect(detectWorkMode(null, 'Dev', 'Modelo híbrido em SP')).toBe('hybrid');
    expect(detectWorkMode(null, 'Vaga 100% remoto')).toBe('remote');
    expect(detectWorkMode(null, 'Dev Node')).toBeNull();
  });
  it('seniority from title', () => {
    expect(detectSeniority('Desenvolvedor Full Stack JR')).toBe('junior');
    expect(detectSeniority('Pessoa Engenheira de Software Sênior')).toBe('senior');
    expect(detectSeniority('Tech Lead Node.js')).toBe('lead');
    expect(detectSeniority('Estágio em Desenvolvimento')).toBe('intern');
    expect(detectSeniority('Desenvolvedor Back-end')).toBeNull();
  });
});

describe('parseSalary', () => {
  it('parses BRL ranges and periods', () => {
    expect(parseSalary(null, null, 'Salário: R$ 8.000 - 12.000')).toMatchObject({ min: 8000, max: 12000 });
    expect(parseSalary(null, null, 'R$ 15k/mês + benefícios')).toMatchObject({ min: 15000, max: null });
    expect(parseSalary(null, null, 'R$ 180.000/ano')).toMatchObject({ min: 15000 });
    expect(parseSalary(null, null, 'R$ 50 por hora')).toMatchObject({ min: null, max: null });
    expect(parseSalary(null, null, 'Salário a combinar')).toMatchObject({ min: null, max: null });
    expect(parseSalary(null, null, 'USD 5,000/month')).toMatchObject({ min: null, max: null });
    expect(parseSalary(7000, 9000, null)).toMatchObject({ min: 7000, max: 9000 });
  });
});

it('cleanDescription decodes entities and tags', () => {
  expect(cleanDescription('a&nbsp;b<br>c<p>d</p>')).toBe('a b\nc\nd');
});
