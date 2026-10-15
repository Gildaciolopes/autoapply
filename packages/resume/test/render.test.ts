import { afterAll, describe, expect, it } from 'vitest';
import { atsLint, closeRenderer, expectedLines, extractPdfText, factsToRenderModel, renderResumePdf } from '../src/index.js';
import { anaFacts, anaProfile, longFacts } from './fixtures/personas.js';
import { normalizeText } from '@autoapply/kb';

afterAll(() => closeRenderer());

describe('renderResumePdf', () => {
  it('renders persona Ana on one page with text bullets and ATS score 100', async () => {
    const model = factsToRenderModel(anaProfile, anaFacts, { lang: 'pt' });
    const r = await renderResumePdf(model);
    expect(r.overflow).toBe(false);
    if (r.overflow) return;
    const text = await extractPdfText(r.pdf);
    expect(text.totalPages).toBe(1);
    expect(text.text).toContain('• Migrei a API de pagamentos');
    // reading order = model order
    const norm = normalizeText(text.text);
    let cursor = 0;
    for (const line of expectedLines(model).map(normalizeText)) {
      const at = norm.indexOf(line, cursor);
      expect(at, line).toBeGreaterThanOrEqual(0);
      cursor = at + line.length;
    }
    const lint = await atsLint(r.pdf, model);
    expect(lint.checks.filter((c) => !c.pass)).toEqual([]);
    expect(lint.score).toBe(100);
  }, 60_000);

  it('reports overflow instead of cutting content', async () => {
    const model = factsToRenderModel(anaProfile, longFacts, { lang: 'pt' });
    const r = await renderResumePdf(model);
    expect(r.overflow).toBe(true);
    if (!r.overflow) return;
    expect(r.pages).toBeGreaterThan(1);
    expect(r.items.map((i) => i.id)).toContain('exp-extra-0#h0');
  }, 60_000);

  it('hidden items are left out of the rendering only', () => {
    const model = factsToRenderModel(anaProfile, anaFacts, { hiddenItemIds: ['exp-loja', 'exp-xeno#h1'] });
    const exp = model.sections.find((s) => s.id === 'experience')!;
    expect(exp.entries.map((e) => e.id)).toEqual(['exp-xeno']);
    expect(exp.entries[0]!.bullets.map((b) => b.id)).toEqual(['exp-xeno#h0', 'exp-xeno#h2']);
  });
});
