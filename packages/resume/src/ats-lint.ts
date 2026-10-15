import { normalizeText } from '@autoapply/kb';
import { countImages, extractPdfText } from './pdf-text.js';
import { expectedLines, type RenderModel } from './model.js';

export interface AtsCheck {
  id: string;
  pass: boolean;
  detail: string;
}

const A4_HEIGHT_PT = 842;
const STANDARD_HEADINGS = new Set(
  ['resumo', 'experiencia', 'formacao', 'habilidades', 'idiomas', 'certificacoes', 'projetos',
   'summary', 'experience', 'education', 'skills', 'languages', 'certifications', 'projects'],
);

/** Bullet characters that ATS parsers keep as text. */
const TEXT_BULLET = /(^|\n)\s*•\s+\S/;

/**
 * Deterministic ATS lint, 0–100 (research R4: proxy for the "cvlint" target). Equal-weight checks
 * over what commonly breaks ATS parsing.
 */
export async function atsLint(pdf: Uint8Array, model: RenderModel): Promise<{ score: number; checks: AtsCheck[] }> {
  const t = await extractPdfText(pdf);
  const norm = normalizeText(t.text);
  const raw = Buffer.from(pdf).toString('latin1');
  const checks: AtsCheck[] = [];
  const add = (id: string, pass: boolean, detail: string) => checks.push({ id, pass, detail });

  add('one_page', t.totalPages === 1, `${t.totalPages} página(s)`);
  add('text_layer', t.chars >= 200, `${t.chars} caracteres extraídos`);

  const lines = expectedLines(model).map(normalizeText).filter(Boolean);
  let cursor = 0;
  const missing: string[] = [];
  for (const line of lines) {
    const at = norm.indexOf(line, cursor);
    if (at < 0) missing.push(line);
    else cursor = at + line.length;
  }
  add('reading_order', missing.length === 0, missing.length ? `fora de ordem/ausente: ${missing.slice(0, 3).join(' | ')}` : 'ordem preservada');

  const images = await countImages(pdf);
  add('no_images', images === 0, `${images} imagem(ns)`);

  const hasBulletsInModel = model.sections.some((s) => s.entries.some((e) => e.bullets.length));
  add('text_bullets', !hasBulletsInModel || TEXT_BULLET.test(t.text), hasBulletsInModel ? 'bullets "•" no texto' : 'sem bullets');

  const headings = model.sections.map((s) => normalizeText(s.title));
  const nonStandard = headings.filter((h) => !STANDARD_HEADINGS.has(h));
  add('standard_headings', nonStandard.length === 0 && headings.every((h) => norm.includes(h)), nonStandard.join(', ') || 'ok');

  const email = /[\w.+-]+@[\w-]+\.[\w.]+/.test(t.text);
  const phone = /\+?\d[\d\s().-]{7,}\d/.test(t.text);
  add('contact_in_text', email && phone, `email ${email ? 'ok' : 'ausente'}, telefone ${phone ? 'ok' : 'ausente'}`);

  const descriptors = (raw.match(/\/Type\s*\/FontDescriptor/g) ?? []).length;
  const fontFiles = (raw.match(/\/FontFile[23]?\b/g) ?? []).length;
  add('fonts_embedded', descriptors === 0 ? true : fontFiles >= descriptors, `${fontFiles}/${descriptors} fontes embutidas`);

  const edgeItems = t.items.flat().filter((i) => i.str.trim() && (i.y > A4_HEIGHT_PT - 20 || i.y < 20));
  add('no_header_footer_text', edgeItems.length === 0, edgeItems.length ? `${edgeItems.length} itens na margem` : 'ok');

  const score = Math.round((checks.filter((c) => c.pass).length / checks.length) * 100);
  return { score, checks };
}
