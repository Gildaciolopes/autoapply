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
