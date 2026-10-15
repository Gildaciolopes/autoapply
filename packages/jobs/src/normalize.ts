import { normalizeText, stripAccents } from '@autoapply/kb';
import type { Seniority, WorkMode } from '@autoapply/shared';

/** 27 Brazilian federative units: sigla → name. */
export const UFS: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
  ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí',
  RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima',
  SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};
const UF_BY_NAME = new Map(Object.entries(UFS).map(([sigla, name]) => [normalizeText(name), sigla]));

const REMOTE_RE = /\b(remoto|remota|home office|homeoffice|100% remoto|trabalho remoto|remote|anywhere|teletrabalho)\b/;
const HYBRID_RE = /\b(hibrido|hibrida|hybrid)\b/;
const ONSITE_RE = /\b(presencial|on-site|onsite|on site)\b/;

const SENIORITY_WORDS =
  /\b(estagio|estagiari[oa]s?|intern(ship)?|trainee|junior|jr|pleno|pl|mid|middle|senior|sr|especialista|specialist|staff|principal|lead|tech lead|lider tecnic[oa]|i{1,3}|iv)\b/g;

/**
 * Title for dedupe: lowercase, no accents, no gender markers "(a)", "(o/a)", "/a",
 * no bracketed codes, no seniority words, no punctuation.
 */
export function normalizeTitle(title: string): string {
  let t = stripAccents(title).toLowerCase();
  t = t.replace(/\[[^\]]*\]|\{[^}]*\}/g, ' ');
  t = t.replace(/\((?:a|o|as|os|o\/a|a\/o|e|x)\)/g, ' ').replace(/\/(?:a|as|o|e)\b/g, ' ');
  t = t.replace(/\([^)]*\)/g, ' ');
  t = t.replace(/[-–—|:,;]+/g, ' ');
  t = normalizeText(t).replace(SENIORITY_WORDS, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

export interface ParsedLocation {
  city: string | null;
  uf: string | null;
  remote: boolean;
}

/** "São Paulo, SP" | "Recife - PE" | "Remoto" | "Belo Horizonte, Minas Gerais, Brasil" → parts. */
export function parseLocation(raw: string | null | undefined, cityField?: string | null, ufField?: string | null): ParsedLocation {
  const text = [raw, cityField, ufField].filter(Boolean).join(', ');
  const n = normalizeText(text);
  const remote = REMOTE_RE.test(n);
  let uf: string | null = null;
  const ufFieldNorm = ufField?.trim();
  if (ufFieldNorm) uf = ufFieldNorm.length === 2 ? ufFieldNorm.toUpperCase() : (UF_BY_NAME.get(normalizeText(ufFieldNorm)) ?? null);
  if (!uf) {
    const sigla = /(?:^|[\s,\-/(])([A-Z]{2})(?=$|[\s,\-/)])/.exec(text);
    if (sigla && UFS[sigla[1]!]) uf = sigla[1]!;
  }
  if (!uf) {
    for (const [name, sigla] of UF_BY_NAME) {
      if (` ${n} `.includes(` ${name} `)) {
        uf = sigla;
        break;
      }
    }
  }
  let city = cityField?.trim() || null;
  if (!city && raw) {
    const parts = raw.split(/[,\-–/]/).map((p) => p.trim()).filter(Boolean);
    const first = parts[0] ?? '';
    const fn = normalizeText(first);
    // "São Paulo" alone is the state; "São Paulo, SP" is the city.
    if (first && !REMOTE_RE.test(fn) && (parts.length > 1 || !UF_BY_NAME.has(fn)) && !(first.length === 2 && UFS[first.toUpperCase()]) && fn !== 'brasil' && fn !== 'brazil') {
      city = first;
    }
  }
  return { city, uf, remote };
}

/** Source field wins; otherwise keywords in title/location/description; unknown → null. */
export function detectWorkMode(sourceValue: string | null | undefined, ...texts: (string | null | undefined)[]): WorkMode | null {
  const v = sourceValue ? normalizeText(sourceValue) : '';
  if (v) {
    if (v.includes('remote') || v.includes('remoto')) return 'remote';
    if (v.includes('hybrid') || v.includes('hibrido')) return 'hybrid';
    if (v.includes('on site') || v.includes('onsite') || v.includes('presencial')) return 'onsite';
  }
  const t = normalizeText(texts.filter(Boolean).join(' '));
  if (HYBRID_RE.test(t)) return 'hybrid';
  if (REMOTE_RE.test(t)) return 'remote';
  if (ONSITE_RE.test(t)) return 'onsite';
  return null;
}

/** From the title only (descriptions mention many levels). Unknown → null. */
export function detectSeniority(title: string): Seniority | null {
  const t = normalizeText(title);
  if (/\b(estagio|estagiari[oa]s?|intern|internship|trainee)\b/.test(t)) return 'intern';
  if (/\b(tech lead|lider tecnic[oa]|staff|principal|especialista|specialist|lead)\b/.test(t)) return 'lead';
  if (/\b(senior|sr|iii)\b/.test(t)) return 'senior';
  if (/\b(pleno|pl|mid|middle|ii)\b/.test(t)) return 'mid';
  if (/\b(junior|jr|i)\b/.test(t)) return 'junior';
  return null;
}

export interface ParsedSalary {
  min: number | null;
  max: number | null;
  text: string | null;
}

const num = (s: string): number => {
  const k = /k$/i.test(s);
  const clean = s.replace(/k$/i, '').replace(/\./g, '').replace(',', '.');
  const v = Number(clean);
  return k ? v * 1000 : v;
};

/**
 * Monthly BRL salary. Structured values (already monthly BRL) win; otherwise parses "R$ 8.000 - 12.000",
 * "R$ 15k/mês", "R$ 180.000/ano" (÷12). Hourly, "a combinar" and non-BRL → unknown (null).
 */
export function parseSalary(min: number | null | undefined, max: number | null | undefined, text: string | null | undefined): ParsedSalary {
  if (min || max) return { min: min ? Math.round(min) : null, max: max ? Math.round(max) : null, text: text ?? null };
  if (!text) return { min: null, max: null, text: null };
  const m = /R\$\s*([\d.,]+k?)(?:\s*(?:-|–|a|até)\s*(?:R\$\s*)?([\d.,]+k?))?\s*(\/\s*(m[eê]s|ano|hora|h)|por\s+(m[eê]s|ano|hora))?/i.exec(text);
  if (!m) return { min: null, max: null, text: null };
  const period = (m[4] ?? m[5] ?? 'mes').toLowerCase();
  if (period.startsWith('h')) return { min: null, max: null, text: m[0].trim() };
  const div = period.startsWith('ano') ? 12 : 1;
  const a = num(m[1]!) / div;
  const b = m[2] ? num(m[2]) / div : null;
  if (!Number.isFinite(a) || a < 500) return { min: null, max: null, text: m[0].trim() };
  return { min: Math.round(a), max: b && Number.isFinite(b) ? Math.round(b) : null, text: m[0].trim() };
}

/** Gupy descriptions carry HTML entities and tags. */
export function cleanDescription(html: string | null | undefined): string | null {
  if (!html) return null;
  const ents: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|li|div|h\d)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/gi, (e) => ents[e.toLowerCase()] ?? ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
