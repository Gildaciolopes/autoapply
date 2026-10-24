import { describe, expect, it } from 'vitest';
import { normalizeQuestion, pickMemory } from '../src/memory.js';
import { field } from './ctx.js';

describe('answer memory (FR-009)', () => {
  const mem = { question: 'Como soube da vaga?', normalized: normalizeQuestion('Como soube da vaga?'), answer: 'LinkedIn', fieldType: 'text', evidence: [] };
  it('exact normalized match', () => {
    expect(normalizeQuestion('Como soube da vaga? *')).toBe('como soube da vaga');
    expect(pickMemory(field('Como soube da vaga?*'), [mem])).toMatchObject({ value: 'LinkedIn', source: 'memória', confidence: 0.95 });
  });
  it('semantic match needs ≥ 0.92 and same type', () => {
    expect(pickMemory(field('Onde encontrou esta oportunidade?'), [{ ...mem, normalized: 'x', similarity: 0.9 }])).toBeNull();
    expect(pickMemory(field('Onde encontrou esta oportunidade?'), [{ ...mem, normalized: 'x', similarity: 0.95 }])!.confidence).toBe(0.95);
    expect(pickMemory(field('Onde encontrou esta oportunidade?', { type: 'textarea' }), [{ ...mem, normalized: 'x', similarity: 0.97 }])).toBeNull();
  });
  it('choice fields must offer the stored answer', () => {
    expect(pickMemory(field('Como soube da vaga?', { type: 'select', options: ['Indicação', 'Site'] }), [{ ...mem, fieldType: null }])).toBeNull();
    expect(pickMemory(field('Como soube da vaga?', { type: 'select', options: ['Indicação', 'LinkedIn'] }), [{ ...mem, fieldType: null }])!.value).toBe('LinkedIn');
  });
});

describe('fact over memory (F6 FR-022)', async () => {
  const { planAnswers } = await import('../src/answer.js');
  const { anaContext } = await import('./ctx.js');
  it('computed years win over a conflicting memory; the conflict is flagged', async () => {
    const f = field('Quantos anos de experiência com React?', { type: 'number' });
    const memory = () => [{ id: 'm1', question: f.label, normalized: normalizeQuestion(f.label), answer: '5', fieldType: 'number', evidence: [] }];
    const r = await planAnswers([f], anaContext(), { threshold: 0.7, memory });
    expect(r.answers[0]).toMatchObject({ value: '2', source: 'calculado' });
    expect(r.answers[0]!.findings).toEqual([{ sentenceIndex: 0, type: 'memory_conflict', token: '5' }]);
  });
  it('agreeing memory → no finding; no fact-backed answer → memory is used', async () => {
    const f = field('Quantos anos de experiência com React?', { type: 'number' });
    const agree = () => [{ question: f.label, normalized: normalizeQuestion(f.label), answer: '2', fieldType: 'number', evidence: [] }];
    expect((await planAnswers([f], anaContext(), { threshold: 0.7, memory: agree })).answers[0]!.findings).toEqual([]);
    const g = field('Como soube da vaga?');
    const mem = () => [{ question: g.label, normalized: normalizeQuestion(g.label), answer: 'LinkedIn', fieldType: 'text', evidence: [] }];
    expect((await planAnswers([g], anaContext(), { threshold: 0.7, memory: mem })).answers[0]).toMatchObject({ value: 'LinkedIn', source: 'memória' });
  });
});
