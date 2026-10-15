/** Deterministic text normalization used for keys, matching and provenance checks. */

export function stripAccents(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** lowercase, no accents, punctuation → space, collapsed whitespace. */
export function normalizeText(t: string): string {
  return stripAccents(t)
    .toLowerCase()
    .replace(/[•·▪●◦‣∙\-–—_/\\|,;:!?()[\]{}"'“”‘’`]+/g, ' ')
    .replace(/\.(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slug(t: string): string {
  return stripAccents(t)
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .replace(/-{2,}/g, '-');
}

const LEGAL_SUFFIXES = /\b(s\.?\s?a\.?|ltda\.?|me|eireli|epp|inc\.?|llc|ltd\.?|corp\.?|gmbh|co\.?)$/i;

/** "Itaú Unibanco S.A." → "itau unibanco". Strips trailing legal-entity suffixes repeatedly. */
export function normalizeCompany(name: string): string {
  let n = stripAccents(name).toLowerCase().replace(/[.,]+$/g, '').trim();
  for (let i = 0; i < 3; i++) {
    const next = n.replace(LEGAL_SUFFIXES, '').replace(/[\s,.-]+$/g, '').trim();
    if (next === n) break;
    n = next;
  }
  return normalizeText(n);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** 1 = identical, 0 = completely different. */
export function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

/** Same organization? Similarity ≥ 0.85 or whole-word containment after normalization. */
export function sameOrganization(a: string, b: string): boolean {
  const x = normalizeCompany(a);
  const y = normalizeCompany(b);
  if (!x || !y) return false;
  if (x === y || similarity(x, y) >= 0.85) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 3 && ` ${long} `.includes(` ${short} `);
}
