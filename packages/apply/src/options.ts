import { normalizeText } from '@autoapply/kb';

export { normalizeText };

export type Polarity = 'yes' | 'no' | null;

/** "Sim", "Yes, I am" → yes; "Não", "No" → no. */
export function yesNoPolarity(option: string): Polarity {
  const n = normalizeText(option);
  if (/^(sim|yes|y|s|true|i do|i am|i have|tenho|possuo|sou)\b/.test(n)) return 'yes';
  if (/^(nao|no|n|false|i don t|i do not|i am not|i have not|nunca|never)\b/.test(n)) return 'no';
  return null;
}

/** True when the options are a yes/no pair (any order, maybe plus "prefer not"). */
export function isYesNo(options: string[]): boolean {
  const pol = options.map(yesNoPolarity);
  return pol.includes('yes') && pol.includes('no');
}

/** Canonical value → accepted spellings (pt/en). */
const SYNONYMS: Record<string, string[]> = {
  yes: ['sim', 'yes', 'y', 's'],
  no: ['nao', 'no', 'n'],
  remote: ['remoto', 'remote', 'home office', '100 remoto', 'trabalho remoto', 'anywhere'],
  hybrid: ['hibrido', 'hybrid'],
  onsite: ['presencial', 'on site', 'onsite', 'in office', 'no escritorio', 'office'],
  depends: ['depende', 'talvez', 'maybe', 'depends', 'open to discuss', 'a combinar'],
  clt: ['clt', 'efetivo', 'full time employee', 'employee'],
  pj: ['pj', 'pessoa juridica', 'contractor', 'freelancer', 'contract'],
  citizen: ['brasileiro', 'brasileira', 'cidadao', 'citizen', 'brazilian'],
  native: ['nativo', 'native', 'lingua materna', 'bilingual', 'bilingue'],
  fluent: ['fluente', 'fluent', 'proficient', 'c2'],
  advanced: ['avancado', 'advanced', 'c1'],
  intermediate: ['intermediario', 'intermediate', 'b1', 'b2', 'conversational', 'conversacao'],
  basic: ['basico', 'basic', 'beginner', 'iniciante', 'elementary', 'a1', 'a2'],
};

const canon = (wanted: string): string[] => {
  const n = normalizeText(wanted);
  for (const [key, list] of Object.entries(SYNONYMS)) if (key === n || list.includes(n)) return [key, ...list];
  return [n];
};

/**
 * Index of the option that means `wanted` (exact → normalized → synonyms → containment), or null.
 * Containment only for terms ≥ 4 chars, so "no" never matches "Nordeste".
 */
export function matchOption(options: string[], wanted: string): number | null {
  const norm = options.map(normalizeText);
  const w = normalizeText(wanted);
  let i = options.findIndex((o) => o === wanted);
  if (i >= 0) return i;
  i = norm.indexOf(w);
  if (i >= 0) return i;
  const variants = canon(wanted);
  for (const v of variants) {
    i = norm.findIndex((o) => o === v || o.split(' ')[0] === v || (v.length >= 4 && new RegExp(`\\b${v}\\b`).test(o)));
    if (i >= 0) return i;
  }
  if (w.length >= 4) {
    i = norm.findIndex((o) => o.length >= 4 && (o.includes(w) || w.includes(o)));
    if (i >= 0) return i;
  }
  return null;
}

const PREFER_NOT = /(prefiro nao|prefer not|decline|nao desejo|nao quero|nao informar|i don t wish|i do not wish|rather not|nao declarar|choose not)/;

export function preferNotOption(options: string[]): number | null {
  const i = options.findIndex((o) => PREFER_NOT.test(normalizeText(o)));
  return i >= 0 ? i : null;
}

const LOWEST = /^(nenhum|nenhuma|none|nao tenho|i don t have|no experience|sem experiencia|0|zero|menos de|less than|basico|basic|iniciante|beginner)\b/;

/** The most conservative answer: "No" / "None" / lowest bucket (constitution §I, FR-007). */
export function lowestHonestOption(options: string[]): number | null {
  const no = options.findIndex((o) => yesNoPolarity(o) === 'no');
  if (no >= 0) return no;
  const low = options.findIndex((o) => LOWEST.test(normalizeText(o)));
  if (low >= 0) return low;
  const ranges = options.map(parseRange);
  let best: number | null = null;
  ranges.forEach((r, idx) => {
    if (r && (best === null || r.min < ranges[best]!.min)) best = idx;
  });
  return best;
}

/** "R$ 5.000", "5k", "3,5" → number. */
export function parseNumber(token: string): number | null {
  const t = token.trim().toLowerCase();
  const k = /k$/.test(t);
  let s = t.replace(/k$/, '').replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? (k ? n * 1000 : n) : null;
}

/** Numeric range an option denotes: "3-5 anos", "5+", "Mais de 10", "Até 2", "R$ 5.000 a R$ 8.000". */
export function parseRange(option: string): { min: number; max: number } | null {
  const n = normalizeText(option).replace(/r\$/g, '');
  const nums = [...option.matchAll(/\d[\d.,]*k?/gi)].map((m) => parseNumber(m[0])).filter((x): x is number => x !== null);
  if (!nums.length) return null;
  if (/(mais de|more than|acima de|above|over|\+)/.test(n) || /\d\s*\+/.test(option)) return { min: nums[0]! + (/\+/.test(option) ? 0 : 1e-9), max: Infinity };
  if (/(menos de|less than|abaixo de|under|below)/.test(n)) return { min: 0, max: nums[0]! - 1e-9 };
  if (/(ate|up to)\b/.test(n) && nums.length === 1) return { min: 0, max: nums[0]! };
  if (nums.length >= 2) return { min: Math.min(nums[0]!, nums[1]!), max: Math.max(nums[0]!, nums[1]!) };
  return { min: nums[0]!, max: nums[0]! };
}

/** Option whose range contains `value` (lowest matching first). */
export function matchNumericOption(options: string[], value: number): number | null {
  const i = options.findIndex((o) => {
    const r = parseRange(o);
    return r !== null && value >= r.min && value <= r.max;
  });
  return i >= 0 ? i : null;
}
