import { describe, expect, it } from 'vitest';
import { answerComputed, answerDemographic, answerEvidenceYesNo, answerLanguageLevel } from '../src/rules.js';
import { anaContext, field } from './ctx.js';

const yn = { type: 'radio' as const, options: ['Sim', 'Não'] };

describe('computed years (constitution §I)', () => {
  const ctx = anaContext();
  it('years with a skill come from experience dates', () => {
    // React only in Loja Fácil 2018-06..2021-02 → 2 years (never the inflated "5+").
    expect(answerComputed(field('Quantos anos de experiência com React?', { type: 'number' }), ctx)).toMatchObject({ value: '2', source: 'calculado', evidence: ['f-exp0'] });
    expect(answerComputed(field('Years of experience with React', { type: 'select', options: ['0-1', '2-3', '4-5', '5+'] }), ctx)!.value).toBe('2-3');
  });
  it('"anos de experiência você tem com X" phrasing', () => {
    expect(answerComputed(field('Quantos anos de experiência você tem com React?', { type: 'number' }), ctx)).toMatchObject({ value: '2', source: 'calculado' });
  });
  it('total years', () => {
    expect(answerComputed(field('Anos de experiência profissional', { type: 'number' }), ctx)!.value).toBe('8');
  });
  it('dictionary skill without evidence → 0 / lowest option', () => {
    expect(answerComputed(field('Anos de experiência com Kubernetes', { type: 'number' }), ctx)).toMatchObject({ value: '0', evidence: [] });
    expect(answerComputed(field('Years of experience with Kafka', { type: 'select', options: ['None', '1-2', '3+'] }), ctx)!.value).toBe('None');
  });
  it('skill known but no dated experience → blocking low_confidence', () => {
    expect(answerComputed(field('Anos de experiência com Python', { type: 'number' }), ctx)).toMatchObject({ value: null, reason: 'low_confidence' });
  });
});

describe('evidence yes/no (FR-007)', () => {
  const ctx = anaContext();
  it('yes only with a usable fact', () => {
    expect(answerEvidenceYesNo(field('Você tem experiência com NestJS?', yn), ctx)).toMatchObject({ value: 'Sim', source: 'regra', evidence: expect.arrayContaining(['f-nest']) });
    expect(answerEvidenceYesNo(field('Você tem experiência com Kubernetes?', yn), ctx)).toMatchObject({ value: 'Não', evidence: [] });
    expect(answerEvidenceYesNo(field('Do you have experience with Kafka and Postgres?', { type: 'radio', options: ['Yes', 'No'] }), ctx)!.value).toBe('No');
  });
  it('certifications', () => {
    expect(answerEvidenceYesNo(field('Possui certificação AWS?', yn), ctx)).toMatchObject({ value: 'Sim', evidence: ['f-aws'] });
    expect(answerEvidenceYesNo(field('Possui certificação Google Cloud?', yn), ctx)!.value).toBe('Não');
  });
  it('languages', () => {
    expect(answerEvidenceYesNo(field('Você é fluente em alemão?', yn), ctx)!.value).toBe('Não');
    expect(answerEvidenceYesNo(field('Você é fluente em inglês?', yn), ctx)!.value).toBe('Não'); // intermediate ≠ fluent
    expect(answerEvidenceYesNo(field('Do you speak English?', { type: 'radio', options: ['Yes', 'No'] }), ctx)).toMatchObject({ value: 'Yes', evidence: ['f-en'] });
  });
  it('yes/no "proficient at a level" questions go to the polarity rule, not the level rule', () => {
    const f = field('Are you proficient in a written and spoken level in English?', { type: 'radio', options: ['Yes', 'No'] });
    expect(answerLanguageLevel(f, ctx)).toBeNull();
    expect(answerEvidenceYesNo(f, ctx)!.value).toBe('No'); // intermediate ≠ proficient
  });
  it('non-dictionary subjects are not decided by rules', () => {
    expect(answerEvidenceYesNo(field('Você tem experiência com vendas consultivas?', yn), ctx)).toBeNull();
  });
  it('language level never rounds up', () => {
    expect(answerLanguageLevel(field('Nível de inglês', { type: 'select', options: ['Básico', 'Intermediário', 'Avançado', 'Fluente'] }), ctx)!.value).toBe('Intermediário');
    expect(answerLanguageLevel(field('Nível de inglês', { type: 'select', options: ['Básico', 'Avançado', 'Fluente'] }), ctx)!.value).toBe('Básico');
    expect(answerLanguageLevel(field('Nível de espanhol', { type: 'select', options: ['Nenhum', 'Básico', 'Avançado'] }), ctx)!.value).toBe('Nenhum');
  });
  it('demographics → prefer not, never the LLM', () => {
    expect(answerDemographic(field('Gênero', { type: 'select', options: ['Feminino', 'Masculino', 'Prefiro não informar'] })).value).toBe('Prefiro não informar');
    expect(answerDemographic(field('Gender', { type: 'select', options: ['Female', 'Male'], required: false }))).toMatchObject({ value: null, blocking: false });
  });
});
