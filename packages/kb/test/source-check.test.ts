import { describe, expect, it } from 'vitest';
import { foundInSource, prepareSource, quoteInSource } from '../src/source-check.js';

const text = `Ana Souza — Engenheira de Software Sênior
Xenó Tecnologia Ltda · mar 2021 – atual
• Migrei a API para NestJS e Postgres, reduzindo latência em 40%
Habilidades: TypeScript, React, Docker`;

describe('foundInSource', () => {
  const src = prepareSource(text);
  it('accepts accent/case/whitespace variants', () => {
    expect(foundInSource(src, ['XENO TECNOLOGIA', 'engenheira de software senior'])).toEqual([]);
  });
  it('accepts skill aliases (Postgres ↔ PostgreSQL)', () => {
    expect(foundInSource(src, ['PostgreSQL'], { skill: true })).toEqual([]);
  });
  it('flags hallucinated items', () => {
    expect(foundInSource(src, ['Kubernetes'], { skill: true })).toEqual(['not_in_source']);
    expect(foundInSource(src, ['Google', 'Staff Engineer'])).toEqual(['not_in_source']);
  });
  it('does not match partial words', () => {
    expect(foundInSource(prepareSource('JavaScript developer'), ['Java'], { skill: true })).toEqual(['not_in_source']);
  });
  it('checks quotes', () => {
    expect(quoteInSource(src, 'Migrei a API para NestJS e Postgres')).toBe(true);
    expect(quoteInSource(src, 'Liderei um time de 20 pessoas no Google')).toBe(false);
  });
});
