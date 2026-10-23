import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { RenderModel } from './model.js';

const require = createRequire(import.meta.url);
const font = (weight: 400 | 700) =>
  readFileSync(require.resolve(`@fontsource/inter/files/inter-latin-${weight}-normal.woff2`)).toString('base64');
let fontCss: string | undefined;
export const fonts = () =>
  (fontCss ??= [400, 700]
    .map((w) => `@font-face{font-family:Inter;font-weight:${w};src:url(data:font/woff2;base64,${font(w as 400 | 700)}) format('woff2');}`)
    .join(''));

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * ATS-friendly HTML (research R3): single column, real text bullets ("• " characters, no list
 * markers or ::before), standard headings, no images/tables/icons, contact as plain text.
 */
export function renderHtml(m: RenderModel): string {
  const sections = m.sections
    .map(
      (s) => `<section><h2>${esc(s.title)}</h2>${s.entries
        .map(
          (e) => `<div class="entry">${
            e.heading || e.dates
              ? `<div class="row"><h3>${esc(e.heading)}${e.sub ? `<span class="sub"> — ${esc(e.sub)}</span>` : ''}</h3>${e.dates ? `<span class="dates">${esc(e.dates)}</span>` : ''}</div>`
              : ''
          }${e.text ? `<p>${esc(e.text)}</p>` : ''}${e.bullets.map((b) => `<p class="b">• ${esc(b.text)}</p>`).join('')}</div>`,
        )
        .join('')}</section>`,
    )
    .join('');
  return `<!doctype html><html lang="${m.lang === 'pt' ? 'pt-BR' : 'en'}"><head><meta charset="utf-8"><title>${esc(m.name)}</title><style>
${fonts()}
@page{size:A4;margin:12mm 14mm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,Arial,sans-serif;font-size:9.6pt;line-height:1.32;color:#111}
h1{font-size:17pt;font-weight:700}
.headline{font-size:10.5pt;margin-top:1pt}
.contact{margin-top:3pt;font-size:9pt}
h2{font-size:10.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.4pt;margin-top:9pt;padding-bottom:1.5pt;border-bottom:.6pt solid #111}
h3{font-size:9.8pt;font-weight:700;display:inline}
.sub{font-weight:400}
.entry{margin-top:4pt}
.row{display:flex;justify-content:space-between;gap:8pt}
.dates{white-space:nowrap}
p{margin-top:1.5pt}
p.b{padding-left:9pt;text-indent:-7pt}
.wm{margin-top:4pt;font-weight:700}
</style></head><body>
<h1>${esc(m.name)}</h1>${m.headline ? `<p class="headline">${esc(m.headline)}</p>` : ''}
<p class="contact">${m.contact.map(esc).join(' | ')}</p>${m.watermark ? `<p class="wm">${esc(m.watermark)}</p>` : ''}
${sections}
</body></html>`;
}
