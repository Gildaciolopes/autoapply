import type { FormField, LooseDate, PlannedAnswer } from '@autoapply/shared';
import type { StandardKind } from './classify.js';
import { PROFILE_EVIDENCE, type AnswerContext } from './context.js';
import { isYesNo, matchNumericOption, matchOption, preferNotOption, yesNoPolarity } from './options.js';

const hasChoices = (f: FormField) => (f.type === 'select' || f.type === 'radio' || f.type === 'checkbox') && f.options.length > 0;

const fact = (fieldKey: string, value: string | string[], evidence: string[], confidence = 1): PlannedAnswer => ({
  fieldKey,
  value,
  source: 'fato',
  confidence,
  evidence,
  blocking: false,
  findings: [],
});

/** Required → blocking `missing_fact`; optional → left empty. Never invented (CPF, ids, salary…). */
export const missing = (field: FormField, reason: PlannedAnswer['reason'] = 'missing_fact'): PlannedAnswer => ({
  fieldKey: field.key,
  value: null,
  source: 'fato',
  confidence: 0,
  evidence: [],
  blocking: field.required,
  reason,
  findings: [],
});

/** Picks the option meaning `wanted`, or the field's text value when it has no options. */
function choose(field: FormField, wanted: string, evidence: string[]): PlannedAnswer | null {
  if (!hasChoices(field)) return fact(field.key, wanted, evidence);
  const i = matchOption(field.options, wanted);
  return i === null ? null : fact(field.key, field.options[i]!, evidence);
}

function yesNo(field: FormField, yes: boolean, evidence: string[], lang: 'pt' | 'en'): PlannedAnswer | null {
  if (hasChoices(field)) {
    const i = field.options.findIndex((o) => yesNoPolarity(o) === (yes ? 'yes' : 'no'));
    return i >= 0 ? fact(field.key, field.options[i]!, evidence) : null;
  }
  if (field.type === 'checkbox') return fact(field.key, yes ? 'true' : 'false', evidence);
  return fact(field.key, lang === 'pt' ? (yes ? 'Sim' : 'Não') : yes ? 'Yes' : 'No', evidence);
}

/** Brazilian phone in the format the field hints at; default "+55 DD 9XXXX-XXXX". */
export function formatPhone(raw: string, field: Pick<FormField, 'placeholder' | 'pattern'>): string {
  let d = raw.replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return raw.trim();
  const dd = d.slice(0, 2);
  const num = d.slice(2);
  const local = num.length === 9 ? `${num.slice(0, 5)}-${num.slice(5)}` : `${num.slice(0, 4)}-${num.slice(4)}`;
  const ph = field.placeholder ?? '';
  if (field.pattern && /^\^?(\\d|\[0-9\])/.test(field.pattern)) return d; // digits-only pattern
  if (/^\s*\(/.test(ph)) return `(${dd}) ${local}`;
  return `+55 ${dd} ${local}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO for date inputs; DD/MM/YYYY when the placeholder asks for it. */
export function formatDate(iso: string, field: Pick<FormField, 'type' | 'placeholder'>): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  if (field.type === 'date') return `${y}-${pad(m)}-${pad(d)}`;
  if (/mm\s*\/\s*dd/i.test(field.placeholder ?? '')) return `${pad(m)}/${pad(d)}/${y}`;
  if (/yyyy-mm|aaaa-mm/i.test(field.placeholder ?? '')) return `${y}-${pad(m)}-${pad(d)}`;
  return `${pad(d)}/${pad(m)}/${y}`;
}

const monthIndex = (d: LooseDate | null | undefined, now: Date) =>
  !d ? -1 : d === 'present' ? now.getFullYear() * 12 + now.getMonth() : d.year * 12 + (d.month ?? 1) - 1;

/** Most recent experience (current one first). */
export function latestExperience(ctx: AnswerContext) {
  const exps = ctx.facts
    .filter((f) => f.kind === 'experience')
    .map((f) => ({ f, v: f.value as { company?: string; title?: string; start?: LooseDate | null; end?: LooseDate | null } }));
  exps.sort((a, b) => monthIndex(b.v.end ?? 'present', ctx.now) - monthIndex(a.v.end ?? 'present', ctx.now) || monthIndex(b.v.start, ctx.now) - monthIndex(a.v.start, ctx.now));
  return exps[0] ?? null;
}

const BR_UF = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);
const ANNUAL = /\b(annual|anual|per year|por ano|yearly|ao ano)\b/i;
const MONTHLY = /\b(monthly|mensal|per month|por mes|ao mes)\b/i;

const formatMoney = (amount: number, lang: 'pt' | 'en') =>
  lang === 'pt' ? amount.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : amount.toLocaleString('en-US', { maximumFractionDigits: 0 });

/**
 * Standard fields from Profile + personal + experience facts, no LLM (FR-005).
 * Returns null when the kind does not apply to this field shape (falls through to later stages).
 */
export function answerStandard(kind: StandardKind, field: FormField, ctx: AnswerContext): PlannedAnswer | null {
  const p = ctx.profile;
  const P = [PROFILE_EVIDENCE];
  const pid = ctx.personalIds;
  const per = ctx.personal;
  switch (kind) {
    case 'full_name':
      return p?.fullName ? fact(field.key, p.fullName, P) : missing(field);
    case 'first_name':
      return p?.fullName ? fact(field.key, p.fullName.trim().split(/\s+/)[0]!, P) : missing(field);
    case 'last_name': {
      const parts = p?.fullName?.trim().split(/\s+/) ?? [];
      return parts.length > 1 ? fact(field.key, parts.slice(1).join(' '), P) : missing(field);
    }
    case 'email':
      return p?.email ? fact(field.key, p.email, P) : missing(field);
    case 'phone':
      return p?.phone ? fact(field.key, formatPhone(p.phone, field), P) : missing(field);
    case 'city':
      return p?.city ? (choose(field, p.city, P) ?? missing(field, 'low_confidence')) : missing(field);
    case 'state':
      return p?.state ? (choose(field, p.state, P) ?? missing(field, 'low_confidence')) : missing(field);
    case 'location': {
      if (!p?.city) return missing(field);
      const text = [p.city, p.state, ctx.lang === 'pt' ? 'Brasil' : 'Brazil'].filter(Boolean).join(', ');
      return hasChoices(field) ? (choose(field, p.city, P) ?? missing(field, 'low_confidence')) : fact(field.key, text, P);
    }
    case 'country': {
      // Country of residence derived from the Profile state (a Brazilian UF) — never assumed otherwise.
      if (!p?.state || !BR_UF.has(p.state.trim().toUpperCase())) return missing(field);
      const wanted = ctx.lang === 'pt' ? 'Brasil' : 'Brazil';
      if (!hasChoices(field)) return fact(field.key, wanted, P);
      const i = matchOption(field.options, 'Brasil') ?? matchOption(field.options, 'Brazil');
      return i === null ? missing(field, 'low_confidence') : fact(field.key, field.options[i]!, P);
    }
    case 'linkedin':
      return p?.linkedinUrl ? fact(field.key, p.linkedinUrl, P) : missing(field);
    case 'github':
      return p?.githubUser ? fact(field.key, `https://github.com/${p.githubUser}`, P) : missing(field);
    case 'portfolio': {
      const url = p?.portfolio ?? (p?.githubUser ? `https://github.com/${p.githubUser}` : null);
      return url ? fact(field.key, url, P) : missing(field);
    }
    case 'current_company':
    case 'current_title': {
      const e = latestExperience(ctx);
      const val = kind === 'current_company' ? e?.v.company : e?.v.title;
      return e && val ? fact(field.key, val, [e.f.id]) : missing(field);
    }
    case 'salary': {
      const s = per.salaryExpectation;
      const id = pid.salaryExpectation;
      if (!s || !id) return missing(field);
      // Period asked by the question; the conversion (× 12 / ÷ 12) is done by code from the fact.
      const askedAnnual = ANNUAL.test(field.label) && s.period === 'month';
      const askedMonthly = MONTHLY.test(field.label) && s.period === 'year';
      const amount = askedAnnual ? s.amount * 12 : askedMonthly ? Math.round(s.amount / 12) : s.amount;
      const period = askedAnnual ? 'year' : askedMonthly ? 'month' : s.period;
      if (field.type === 'number') return fact(field.key, String(amount), [id]);
      if (hasChoices(field)) {
        const i = matchNumericOption(field.options, amount);
        return i === null ? missing(field, 'low_confidence') : fact(field.key, field.options[i]!, [id]);
      }
      const contract = s.contract === 'both' ? 'CLT ou PJ' : s.contract.toUpperCase();
      const cur = ctx.lang === 'pt' && s.currency === 'BRL' ? 'R$' : s.currency;
      const text =
        ctx.lang === 'pt'
          ? `${cur} ${formatMoney(amount, 'pt')} ${period === 'month' ? 'mensal' : 'anual'} (${contract})`
          : `${cur} ${formatMoney(amount, 'en')} per ${period} (${s.contract === 'both' ? 'CLT or PJ' : contract})`;
      return fact(field.key, text, [id]);
    }
    case 'notice_period': {
      const n = per.noticePeriodDays;
      const id = pid.noticePeriodDays;
      if (n === null || !id) return missing(field);
      if (field.type === 'number') return fact(field.key, String(n), [id]);
      if (hasChoices(field)) {
        const imm = n === 0 ? field.options.findIndex((o) => /imediat|immediate/i.test(o)) : -1;
        const i = imm >= 0 ? imm : matchNumericOption(field.options, n);
        return i === null ? missing(field, 'low_confidence') : fact(field.key, field.options[i]!, [id]);
      }
      const text = n === 0 ? (ctx.lang === 'pt' ? 'Imediata' : 'Immediate') : ctx.lang === 'pt' ? `${n} dias` : `${n} days`;
      return fact(field.key, text, [id]);
    }
    case 'available_from': {
      if (per.availableFrom && pid.availableFrom) return fact(field.key, formatDate(per.availableFrom, field), [pid.availableFrom]);
      if (field.type !== 'date' && !hasChoices(field) && per.noticePeriodDays !== null && pid.noticePeriodDays) {
        const n = per.noticePeriodDays;
        const text = n === 0 ? (ctx.lang === 'pt' ? 'Imediata' : 'Immediately') : ctx.lang === 'pt' ? `Em ${n} dias` : `In ${n} days`;
        return fact(field.key, text, [pid.noticePeriodDays]);
      }
      return missing(field);
    }
    case 'work_auth_brazil': {
      const b = per.workAuthorization.brazil;
      if (b === 'not_provided' || !pid.workAuthorization) return missing(field);
      if (hasChoices(field) && !isYesNo(field.options)) {
        return choose(field, b === 'citizen' ? 'citizen' : b, [pid.workAuthorization]) ?? missing(field, 'low_confidence');
      }
      return yesNo(field, true, [pid.workAuthorization], ctx.lang) ?? missing(field, 'low_confidence');
    }
    case 'sponsorship': {
      const b = per.workAuthorization.brazil;
      if ((b !== 'citizen' && b !== 'permanent') || !pid.workAuthorization) return missing(field);
      return yesNo(field, false, [pid.workAuthorization], ctx.lang) ?? missing(field, 'low_confidence');
    }
    case 'relocate': {
      const r = per.relocate;
      if (r === 'not_provided' || !pid.relocate) return missing(field);
      if (r === 'depends') return choose(field, 'depends', [pid.relocate]) ?? missing(field, 'low_confidence');
      return yesNo(field, r === 'yes', [pid.relocate], ctx.lang) ?? missing(field, 'low_confidence');
    }
    case 'work_mode': {
      const modes = per.workModes;
      if (!modes.length || !pid.workModes) return missing(field);
      if (field.multiple) {
        const picked = modes.map((m) => matchOption(field.options, m)).filter((i): i is number => i !== null);
        return picked.length ? fact(field.key, picked.map((i) => field.options[i]!), [pid.workModes]) : missing(field, 'low_confidence');
      }
      for (const m of modes) {
        const a = choose(field, m, [pid.workModes]);
        if (a) return a;
      }
      return missing(field, 'low_confidence');
    }
    case 'pcd': {
      const v = per.pcd;
      if ((v === 'yes' || v === 'no') && pid.pcd) return yesNo(field, v === 'yes', [pid.pcd], ctx.lang) ?? missing(field, 'low_confidence');
      // Not stated or prefer_not → "prefer not to answer" (US2-6), else leave optional empty.
      if (hasChoices(field)) {
        const i = preferNotOption(field.options);
        if (i !== null) return { ...fact(field.key, field.options[i]!, pid.pcd ? [pid.pcd] : []), source: 'regra' };
      }
      return missing(field);
    }
    case 'follow_company':
      return { ...fact(field.key, 'false', []), source: 'regra' };
    case 'resume':
    case 'cover_letter':
      return null; // attachments are handled by the engine (source `anexo`)
  }
}
