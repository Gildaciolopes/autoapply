import { prepareSource, valueInSource } from '@autoapply/kb';
import { factSummary, type ProfileFact } from '@autoapply/jobs';
import { findSkillByAlias, findSkillsInText, type FormField, type PlannedAnswer, type SkillDef } from '@autoapply/shared';
import { yearsOfExperience } from '@autoapply/tailor';
import type { AnswerContext } from './context.js';
import { isYesNo, lowestHonestOption, matchNumericOption, matchOption, normalizeText, preferNotOption, yesNoPolarity } from './options.js';
import { missing } from './standard.js';

const hasChoices = (f: FormField) => (f.type === 'select' || f.type === 'radio' || f.type === 'checkbox') && f.options.length > 0;
const clean = (label: string) => label.replace(/\s*\*+\s*$/, '').replace(/[?:]\s*$/, '').trim();

/** Dictionary skills named in a phrase ("React e Node.js", "AWS Lambda"). */
export function skillsIn(phrase: string): SkillDef[] {
  const direct = findSkillByAlias(phrase.trim());
  if (direct) return [direct];
  return findSkillsInText(phrase);
}

const YEARS_PATTERNS = [
  /(?:quantos\s+)?anos\s+de\s+experi[eê]ncia(?:\s+profissional)?\s+(?:com|em|no|na|usando|utilizando)\s+(.+)/i,
  /years\s+of\s+(?:professional\s+|hands-on\s+|relevant\s+)?experience\s+(?:with|in|using|working with)\s+(.+)/i,
  /h[aá]\s+quanto\s+tempo\s+(?:voc[eê]\s+)?(?:trabalha|atua|programa)\s+(?:com|em)\s+(.+)/i,
  /how\s+(?:many\s+years|long)\s+(?:have\s+you\s+)?(?:worked|been working|used|experience)\s+(?:with|in)\s+(.+)/i,
];
const TOTAL_YEARS = /(quantos\s+anos\s+de\s+experi[eê]ncia|anos\s+de\s+experi[eê]ncia\s+(profissional|total|na area)|years\s+of\s+(professional\s+|total\s+|relevant\s+)?experience)\s*(voc[eê]\s+tem|do you have)?\s*$/i;

const skillEvidence = (facts: ProfileFact[], skill: SkillDef) =>
  facts.filter((f) => valueInSource(prepareSource(factSummary(f)), skill.label, { skill: true }));

function yearsAnswer(field: FormField, years: number, evidence: string[], lang: 'pt' | 'en'): PlannedAnswer | null {
  const base = { fieldKey: field.key, source: 'calculado' as const, confidence: 0.95, evidence, blocking: false, findings: [] };
  if (hasChoices(field)) {
    const i = years === 0 ? lowestHonestOption(field.options) : matchNumericOption(field.options, years);
    return i === null ? null : { ...base, value: field.options[i]! };
  }
  if (field.type === 'number' || field.type === 'text') {
    const text = field.type === 'number' ? String(years) : lang === 'pt' ? `${years} ${years === 1 ? 'ano' : 'anos'}` : `${years} ${years === 1 ? 'year' : 'years'}`;
    return { ...base, value: text };
  }
  return null;
}

/**
 * "Anos de experiência com React" → computed from experience dates (constitution §I).
 * Dictionary skill without any evidence → 0 / lowest option; skill known but no dated experience,
 * or a non-dictionary subject → undecidable here (null → later stages / needs_input).
 */
export function answerComputed(field: FormField, ctx: AnswerContext): PlannedAnswer | null {
  const label = clean(field.label);
  if (TOTAL_YEARS.test(label)) {
    const { years, source } = yearsOfExperience(ctx.facts, undefined, ctx.now);
    if (!source.length) return missing(field, 'no_evidence');
    return yearsAnswer(field, years, source, ctx.lang) ?? missing(field, 'low_confidence');
  }
  for (const re of YEARS_PATTERNS) {
    const m = label.match(re);
    if (!m) continue;
    const skills = skillsIn(m[1]!);
    if (skills.length !== 1) return null;
    const skill = skills[0]!;
    const { years, source } = yearsOfExperience(ctx.facts, skill.label, ctx.now);
    if (years > 0) return yearsAnswer(field, years, source, ctx.lang) ?? missing(field, 'low_confidence');
    if (skillEvidence(ctx.facts, skill).length) return missing(field, 'low_confidence'); // has the skill, no dated experience
    return yearsAnswer(field, 0, [], ctx.lang) ?? missing(field, 'no_evidence');
  }
  return null;
}

const SKILL_YES_NO = [
  /(?:voc[eê]\s+)?(?:tem|possui|j[aá]\s+teve)\s+(?:experi[eê]ncia|conhecimento|viv[eê]ncia)\s+(?:pr[aá]tica\s+|profissional\s+|s[oó]lida\s+)?(?:com|em|no|na)\s+(.+)/i,
  /(?:voc[eê]\s+)?(?:j[aá]\s+)?(?:trabalhou|atuou|programou|utilizou|usou)\s+(?:com|em)\s+(.+)/i,
  /(?:voc[eê]\s+)?(?:conhece|domina|sabe usar)\s+(.+)/i,
  /do\s+you\s+have\s+(?:any\s+|professional\s+|hands-on\s+|prior\s+)?(?:experience|knowledge)\s+(?:with|in|using)\s+(.+)/i,
  /have\s+you\s+(?:ever\s+)?(?:worked|built|used)\s+(?:with|in)?\s*(.+)/i,
  /are\s+you\s+(?:proficient|experienced|familiar)\s+(?:with|in)\s+(.+)/i,
];
const CERT_YES_NO = /(possui|tem|do you have|have you (?:earned|obtained)|are you)\b.*?\b(certifica\p{L}*|certified|certificate)(.*)/iu;
const LANG_YES_NO = /(fala|e\s+fluente\s+em|é\s+fluente\s+em|tem\s+flu[eê]ncia\s+em|domina|do\s+you\s+speak|are\s+you\s+fluent\s+in|fluent\s+in|proficient\s+in)\s+(.+)/i;

const LANGUAGES: Record<string, string[]> = {
  english: ['ingles', 'english'],
  spanish: ['espanhol', 'spanish', 'castelhano'],
  german: ['alemao', 'german'],
  french: ['frances', 'french'],
  italian: ['italiano', 'italian'],
  japanese: ['japones', 'japanese'],
  mandarin: ['mandarim', 'chines', 'mandarin', 'chinese'],
  portuguese: ['portugues', 'portuguese'],
};
const FLUENT = /(fluente|fluent|avancad|advanced|nativ|native|c1|c2|proficien|bilingue|bilingual)/;

function languageIn(text: string): string | null {
  const n = normalizeText(text);
  for (const [id, names] of Object.entries(LANGUAGES)) if (names.some((x) => new RegExp(`\\b${x}\\b`).test(n))) return id;
  return null;
}

function polarAnswer(field: FormField, yes: boolean, evidence: string[], lang: 'pt' | 'en'): PlannedAnswer | null {
  const base = { fieldKey: field.key, source: 'regra' as const, confidence: 0.9, evidence, blocking: false, findings: [] };
  if (hasChoices(field)) {
    const i = yes ? field.options.findIndex((o) => yesNoPolarity(o) === 'yes') : lowestHonestOption(field.options);
    return i === null || i < 0 ? null : { ...base, value: field.options[i]! };
  }
  if (field.type === 'checkbox') return { ...base, value: yes ? 'true' : 'false' };
  if (field.type === 'text') return { ...base, value: lang === 'pt' ? (yes ? 'Sim' : 'Não') : yes ? 'Yes' : 'No' };
  return null;
}

const isPolarField = (f: FormField) =>
  (hasChoices(f) && f.options.some((o) => yesNoPolarity(o) !== null)) || (f.type === 'checkbox' && f.options.length <= 1) || f.type === 'text';

/**
 * Deterministic yes/no for skill / certification / language questions (FR-007): yes only with a
 * usable fact containing it, otherwise the lowest honest option. Other shapes → null.
 */
export function answerEvidenceYesNo(field: FormField, ctx: AnswerContext): PlannedAnswer | null {
  if (!isPolarField(field)) return null;
  const label = clean(field.label);

  const lang = label.match(LANG_YES_NO);
  if (lang) {
    const id = languageIn(lang[2]!);
    if (!id) return null;
    const facts = ctx.facts.filter((f) => f.kind === 'language' && languageIn(String((f.value as { language?: string }).language ?? '')) === id);
    if (!facts.length && id === 'portuguese') return null;
    const fluentAsked = /fluen|proficien|domina/i.test(lang[1]!);
    const ok = facts.filter((f) => !fluentAsked || FLUENT.test(normalizeText(String((f.value as { fluency?: string }).fluency ?? ''))));
    return polarAnswer(field, ok.length > 0, ok.map((f) => f.id), ctx.lang);
  }

  const cert = label.match(CERT_YES_NO);
  if (cert) {
    const subject = (cert[3] ?? '').replace(/^\s*(em|in|de|of|como|as)\s+/i, '').trim();
    const certs = ctx.facts.filter((f) => f.kind === 'certification');
    const hits = subject
      ? certs.filter((f) => {
          const src = prepareSource(factSummary(f));
          return valueInSource(src, subject) || skillsIn(subject).some((s) => valueInSource(src, s.label, { skill: true }));
        })
      : certs;
    return polarAnswer(field, hits.length > 0, hits.map((f) => f.id), ctx.lang);
  }

  for (const re of SKILL_YES_NO) {
    const m = label.match(re);
    if (!m) continue;
    const skills = skillsIn(m[1]!);
    if (!skills.length) return null; // not a dictionary technology → LLM / needs_input
    const evidence = skills.map((s) => skillEvidence(ctx.facts, s));
    const all = evidence.every((e) => e.length > 0);
    return polarAnswer(field, all, all ? [...new Set(evidence.flat().map((f) => f.id))] : [], ctx.lang);
  }
  return null;
}

const LEVEL_Q = /\b(nivel|level|grau|proficiencia|proficiency|fluencia|fluency)\b/;
const LEVELS = ['native', 'fluent', 'advanced', 'intermediate', 'basic'] as const;

function fluencyLevel(fluency: string): (typeof LEVELS)[number] | null {
  const n = normalizeText(fluency);
  if (/nativ|native|materna|bilingu/.test(n)) return 'native';
  if (/fluen|fluent|c2|proficien/.test(n)) return 'fluent';
  if (/avanc|advanced|c1|full professional/.test(n)) return 'advanced';
  if (/intermedi|b1|b2|conversa|professional working/.test(n)) return 'intermediate';
  if (/basic|basico|a1|a2|elementar|elementary|iniciante|beginner|limited/.test(n)) return 'basic';
  return null;
}

/** "Nível de inglês" (choice) → the language fact's fluency; no fact → lowest option. */
export function answerLanguageLevel(field: FormField, ctx: AnswerContext): PlannedAnswer | null {
  if (!hasChoices(field) || isYesNo(field.options) || !LEVEL_Q.test(normalizeText(field.label))) return null;
  const id = languageIn(field.label);
  if (!id) return null;
  const fact = ctx.facts.find((f) => f.kind === 'language' && languageIn(String((f.value as { language?: string }).language ?? '')) === id);
  const base = { fieldKey: field.key, source: 'regra' as const, confidence: 0.9, blocking: false, findings: [] };
  if (!fact) {
    if (id === 'portuguese') return null;
    const i = lowestHonestOption(field.options);
    return i === null ? null : { ...base, value: field.options[i]!, evidence: [] };
  }
  const level = fluencyLevel(String((fact.value as { fluency?: string }).fluency ?? ''));
  if (!level) return missing(field, 'low_confidence');
  // Exact level, else the next LOWER level the form offers (never round up).
  for (const l of LEVELS.slice(LEVELS.indexOf(level))) {
    const i = matchOption(field.options, l);
    if (i !== null) return { ...base, value: field.options[i]!, evidence: [fact.id] };
  }
  return missing(field, 'low_confidence');
}

/** Gender / race / veteran / orientation / pronouns: never sent to the LLM (US2-6). */
export function answerDemographic(field: FormField): PlannedAnswer {
  if (hasChoices(field)) {
    const i = preferNotOption(field.options);
    if (i !== null) return { fieldKey: field.key, value: field.options[i]!, source: 'regra', confidence: 1, evidence: [], blocking: false, findings: [] };
  }
  return missing(field);
}
