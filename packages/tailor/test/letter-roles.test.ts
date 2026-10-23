import { describe, expect, it } from 'vitest';
import type { ProfileFact } from '@autoapply/jobs';
import { inferLetterRoles, stripCitationMarkers, validateSentences } from '../src/validate.js';
import cases from './fixtures/validator-cases.json' with { type: 'json' };

const ctx = { usableFacts: cases.facts as ProfileFact[], knownOrgs: cases.knownOrgs, targetCompany: 'Acme Pagamentos', candidateName: 'Ana Beatriz Souza' };
const v = (text: string, role?: 'greeting' | 'body' | 'closing') => validateSentences([{ text, factIds: [], role }], ctx).findings.map((f) => f.type);

describe('courtesy lines without citations', () => {
  it('greeting / closing / interest lines with nothing checkable are accepted', () => {
    expect(v('Prezados da Acme Pagamentos,', 'greeting')).toEqual([]);
    expect(v('Atenciosamente, Ana Beatriz Souza', 'closing')).toEqual([]);
    expect(v('Ana Beatriz Souza', 'closing')).toEqual([]);
    expect(v('Estou interessada em contribuir com a equipe da Acme Pagamentos.')).toEqual([]);
    expect(v('Agradeço pela atenção e fico no aguardo do seu retorno.')).toEqual([]);
  });
  it('anything checkable still needs evidence', () => {
    expect(v('Estou interessada em contribuir com minha experiência em Kubernetes.')).toEqual(['uncited']);
    expect(v('Agradeço, e lembro que liderei 30 pessoas.')).toEqual(['uncited']);
    expect(v('Interesse em contribuir como fiz no Google.')).toEqual(['uncited']);
    expect(v('Engenheira full-stack apaixonada por tecnologia.')).toEqual(['uncited']);
    expect(v('Estou interessada em contribuir com minha experiência em desenvolvimento cloud e serverless para a Acme Pagamentos.')).toEqual(['uncited']);
  });
  it('"arquiteturas escaláveis" is not a job title', () => {
    expect(validateSentences([{ text: 'Migrei a API para NestJS com arquiteturas escaláveis.', factIds: ['f-exp1'] }], ctx).findings).toEqual([]);
  });
});

describe('inferLetterRoles', () => {
  it('marks salutation as greeting and sign-off/name as closing', () => {
    const r = inferLetterRoles(
      [
        { text: 'Prezados da Acme,', factIds: [] },
        { text: 'Migrei a API.', factIds: ['f-exp1'] },
        { text: 'Atenciosamente,', factIds: [] },
        { text: 'Ana Beatriz Souza', factIds: [] },
      ],
      'Ana Beatriz Souza',
    );
    expect(r.map((s) => s.role)).toEqual(['greeting', 'body', 'closing', 'closing']);
  });
});

describe('stripCitationMarkers', () => {
  it('removes echoed fact ids but keeps normal brackets', () => {
    expect(stripCitationMarkers('Reduzi a latência em 40% [smk-f-exp1].', ['smk-f-exp1'])).toBe('Reduzi a latência em 40%.');
    expect(stripCitationMarkers('Uso TypeScript (f-ts) e React [f-react][f-ts].', ['f-ts', 'f-react'])).toBe('Uso TypeScript e React.');
    expect(stripCitationMarkers('Sistemas [legados] em produção.', ['f-ts'])).toBe('Sistemas [legados] em produção.');
    expect(stripCitationMarkers('Modelei o banco de pedidos e estoque[smk. f-pg].', ['smk-f-pg'])).toBe('Modelei o banco de pedidos e estoque.');
    expect(stripCitationMarkers('Uso Node.js (back-end) e React.', [])).toBe('Uso Node.js (back-end) e React.');
  });
});
