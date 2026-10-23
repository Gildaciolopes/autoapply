import type { RenderProfile } from './model.js';
import { esc, fonts } from './template.js';
import { renderHtmlToPdf } from './render.js';

export interface LetterInput {
  sentences: { text: string; role?: 'greeting' | 'body' | 'closing' }[];
  profile: RenderProfile;
  lang: 'pt' | 'en';
  date?: Date;
}

/** Plain-text cover letter (greeting / body / closing), as text and one-page PDF (FR-012). */
export function letterText(input: LetterInput): string {
  const greeting = input.sentences.filter((s) => s.role === 'greeting').map((s) => s.text);
  const body = input.sentences.filter((s) => !s.role || s.role === 'body').map((s) => s.text);
  const closing = input.sentences.filter((s) => s.role === 'closing').map((s) => s.text);
  return [greeting.join(' '), body.join(' '), closing.join(' ')].filter(Boolean).join('\n\n');
}

export function letterHtml(input: LetterInput): string {
  const p = input.profile;
  const date = (input.date ?? new Date()).toLocaleDateString(input.lang === 'pt' ? 'pt-BR' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  const contact = [p.email, p.phone, p.city].filter(Boolean).map((x) => esc(String(x))).join(' | ');
  const paras = letterText(input)
    .split('\n\n')
    .map((t) => `<p>${esc(t)}</p>`)
    .join('');
  return `<!doctype html><html lang="${input.lang === 'pt' ? 'pt-BR' : 'en'}"><head><meta charset="utf-8"><style>
${fonts()}
@page{size:A4;margin:20mm 22mm}
body{font-family:Inter,Arial,sans-serif;font-size:10.5pt;line-height:1.5;color:#111}
h1{font-size:15pt;margin:0}.c{margin:2pt 0 14pt;font-size:9.5pt}.d{margin-bottom:12pt}p{margin:0 0 10pt}
</style></head><body><h1>${esc(p.fullName)}</h1><p class="c">${contact}</p><p class="d">${esc(date)}</p>${paras}</body></html>`;
}

export async function renderLetterPdf(input: LetterInput): Promise<Buffer> {
  return renderHtmlToPdf(letterHtml(input));
}
