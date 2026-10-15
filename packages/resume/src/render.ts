import { chromium, type Browser } from 'playwright';
import type { RenderItem } from '@autoapply/shared';
import { extractPdfText } from './pdf-text.js';
import { renderItems, type RenderModel } from './model.js';
import { renderHtml } from './template.js';

let browser: Promise<Browser> | undefined;

/** One shared Chromium per process, launched lazily (renders are rare and user-initiated). */
function getBrowser(): Promise<Browser> {
  browser ??= chromium.launch({ headless: true }).then((b) => {
    b.on('disconnected', () => (browser = undefined));
    return b;
  });
  return browser;
}

export async function closeRenderer(): Promise<void> {
  const b = browser;
  browser = undefined;
  if (b) await (await b).close();
}

export type RenderResult =
  | { overflow: false; pdf: Buffer; pages: 1 }
  | { overflow: true; pages: number; items: RenderItem[] };

/**
 * HTML → A4 PDF. Never cuts content (FR-022): more than one page → overflow with the item list
 * so the user picks what to hide.
 */
export async function renderResumePdf(model: RenderModel): Promise<RenderResult> {
  const page = await (await getBrowser()).newPage();
  try {
    await page.setContent(renderHtml(model), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({ format: 'A4', printBackground: false, preferCSSPageSize: true });
    const { totalPages } = await extractPdfText(pdf);
    if (totalPages > 1) return { overflow: true, pages: totalPages, items: renderItems(model) };
    return { overflow: false, pdf, pages: 1 };
  } finally {
    await page.close();
  }
}
