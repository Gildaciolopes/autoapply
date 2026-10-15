import { extractImages, extractTextItems, getDocumentProxy, renderPageAsImage, type StructuredTextItem } from 'unpdf';

export interface PdfText {
  /** Full text in reading order, pages separated by "\n\f\n". */
  text: string;
  pages: string[];
  chars: number;
  totalPages: number;
  items: StructuredTextItem[][];
}

/** pdf.js detaches the buffer it receives: always hand it a copy. */
const copy = (buf: Uint8Array) => new Uint8Array(buf);

export async function extractPdfText(buf: Uint8Array): Promise<PdfText> {
  const { totalPages, items } = await extractTextItems(copy(buf));
  const pages = items.map((page) =>
    page
      .map((i) => i.str + (i.hasEOL ? '\n' : ''))
      .join('')
      .replace(/[ \t]+\n/g, '\n')
      .trim(),
  );
  const text = pages.join('\n\f\n');
  return { text, pages, chars: text.replace(/\s/g, '').length, totalPages, items };
}

/** Scanned / image-only PDF: too little text layer to parse (research R1). */
export function isImageOnly(t: Pick<PdfText, 'chars'>): boolean {
  return t.chars < 200;
}

export async function countImages(buf: Uint8Array): Promise<number> {
  const pdf = await getDocumentProxy(copy(buf));
  let n = 0;
  for (let p = 1; p <= pdf.numPages; p++) n += (await extractImages(pdf, p)).length;
  return n;
}

/** Page PNGs (base64) for the vision fallback (qwen2.5vl). */
export async function renderPagesPng(buf: Uint8Array, scale = 2, maxPages = 3): Promise<string[]> {
  const pdf = await getDocumentProxy(copy(buf));
  const out: string[] = [];
  for (let p = 1; p <= Math.min(pdf.numPages, maxPages); p++) {
    const png = await renderPageAsImage(pdf, p, { canvasImport: () => import('@napi-rs/canvas'), scale });
    out.push(Buffer.from(png).toString('base64'));
  }
  return out;
}
