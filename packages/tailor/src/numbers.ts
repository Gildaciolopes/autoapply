import { stripAccents } from '@autoapply/kb';

const WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18,
  dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, cem: 100, mil: 1000,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, thousand: 1000,
};
const MULT: Record<string, number> = { k: 1e3, mil: 1e3, milhao: 1e6, milhoes: 1e6, million: 1e6, millions: 1e6, bi: 1e9, bilhao: 1e9, bilhoes: 1e9, billion: 1e9 };

/** "2.000" → 2000, "3,5" → 3.5, "1.5" → 1.5 */
function parseNumeric(raw: string): number {
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) return Number(raw.replace(/\./g, '').replace(',', '.'));
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw)) return Number(raw.replace(/,/g, ''));
  return Number(raw.replace(',', '.'));
}

/**
 * Every quantity mentioned in a text, normalized to a number. Digits glued to letters (HTML5, S3, ES6,
 * Vue3) are part of names, not claims, and are skipped. "um/uma/one" are ignored as articles unless
 * followed by a multiplier.
 */
export function findNumbers(text: string): number[] {
  const t = stripAccents(text).toLowerCase();
  const out: number[] = [];
  const digitRe = /(?<![a-z0-9.,])(\d+(?:[.,]\d+)*)(?![a-z0-9])(?:\s*(%|k\b|mil\b|milhao\b|milhoes\b|million\b|millions\b|bi\b|bilhao\b|bilhoes\b|billion\b))?|(?<![a-z0-9])(\d+(?:[.,]\d+)?)(k)\b/g;
  for (const m of t.matchAll(digitRe)) {
    const raw = m[1] ?? m[3]!;
    const suffix = (m[2] ?? m[4] ?? '').trim();
    let v = parseNumeric(raw);
    if (suffix && suffix !== '%') v *= MULT[suffix] ?? 1;
    if (Number.isFinite(v)) out.push(v);
  }
  for (const m of t.matchAll(/\b([a-z]+)\b(?:\s+(mil|milhoes|milhao|million|millions|thousand))?/g)) {
    const w = m[1]!;
    if (!(w in WORDS)) continue;
    if ((w === 'um' || w === 'uma' || w === 'one') && !m[2]) continue;
    const v = WORDS[w]! * (m[2] ? (MULT[m[2]] ?? 1e3) : 1);
    out.push(v);
  }
  return out;
}

export function numberInText(value: number, text: string): boolean {
  return findNumbers(text).some((n) => Math.abs(n - value) < 1e-9);
}
