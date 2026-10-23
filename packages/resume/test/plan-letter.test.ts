import { afterAll, describe, expect, it } from 'vitest';
import { closeRenderer, extractPdfText, factsToRenderModel, letterText, renderLetterPdf } from '../src/index.js';
import { anaFacts, anaProfile } from './fixtures/personas.js';

afterAll(() => closeRenderer());

describe('tailoring plan in the render model (F3)', () => {
  it('reorders bullets/skills, overrides summary, keeps ids and text', () => {
    const base = factsToRenderModel(anaProfile, anaFacts);
    const t = factsToRenderModel(anaProfile, anaFacts, {
      plan: { summary: 'Resumo adaptado.', bulletOrder: { 'exp-xeno': [2, 0, 1] }, skillOrder: ['sk-react', 'sk-ts'], hiddenItemIds: ['exp-loja#h1'] },
    });
    const exp = (m: typeof base) => m.sections.find((s) => s.id === 'experience')!.entries;
    expect(exp(t)[0]!.bullets.map((b) => b.id)).toEqual(['exp-xeno#h2', 'exp-xeno#h0', 'exp-xeno#h1']);
    expect(exp(t)[0]!.bullets[0]!.text).toBe(exp(base)[0]!.bullets[2]!.text);
    expect(exp(t)[1]!.bullets.map((b) => b.id)).toEqual(['exp-loja#h0']);
    expect(t.sections.find((s) => s.id === 'summary')!.entries[0]!.text).toBe('Resumo adaptado.');
    const skillText = t.sections.find((s) => s.id === 'skills')!.entries.map((e) => e.text).join(' | ');
    expect(skillText.indexOf('React')).toBeLessThan(skillText.indexOf('TypeScript'));
  });

  it('renders a one-page cover letter in greeting/body/closing order', async () => {
    const input = {
      profile: anaProfile,
      lang: 'pt' as const,
      sentences: [
        { text: 'Atenciosamente, Ana Beatriz Souza.', role: 'closing' as const },
        { text: 'Prezada equipe da Acme,', role: 'greeting' as const },
        { text: 'Migrei a API de pagamentos para NestJS.', role: 'body' as const },
      ],
    };
    expect(letterText(input)).toBe('Prezada equipe da Acme,\n\nMigrei a API de pagamentos para NestJS.\n\nAtenciosamente, Ana Beatriz Souza.');
    const pdf = await renderLetterPdf(input);
    const t = await extractPdfText(pdf);
    expect(t.totalPages).toBe(1);
    expect(t.text).toContain('Prezada equipe da Acme');
  }, 60_000);
});
