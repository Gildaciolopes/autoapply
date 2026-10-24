import type { FormField } from '@autoapply/shared';
import { normalizeText } from './options.js';

export type StandardKind =
  | 'first_name'
  | 'last_name'
  | 'full_name'
  | 'email'
  | 'phone'
  | 'city'
  | 'state'
  | 'location'
  | 'country'
  | 'linkedin'
  | 'github'
  | 'portfolio'
  | 'current_company'
  | 'current_title'
  | 'salary'
  | 'notice_period'
  | 'available_from'
  | 'work_auth_brazil'
  | 'sponsorship'
  | 'relocate'
  | 'work_mode'
  | 'pcd'
  | 'resume'
  | 'cover_letter'
  | 'follow_company';

export type DemographicKind = 'gender' | 'race' | 'veteran' | 'orientation' | 'pronouns';

export type FieldClass =
  | { kind: 'standard'; std: StandardKind }
  | { kind: 'demographic'; demo: DemographicKind }
  | { kind: 'consent' }
  | { kind: 'other' };

/** Label words beyond which a mention ("linkedin", "github") is a question, not the profile field. */
const SHORT = 7;

interface Rule {
  std: StandardKind;
  label?: RegExp;
  name?: RegExp;
  autocomplete?: RegExp;
  types?: FormField['type'][];
  short?: boolean;
}

// Order matters: first match wins. Patterns run on normalizeText() (lowercase, no accents).
const RULES: Rule[] = [
  { std: 'cover_letter', label: /\b(cover letter|carta de apresentacao|carta de motivacao|motivation letter)\b/, name: /cover ?letter/ },
  { std: 'resume', label: /\b(resume|curriculo|cv)\b/, name: /\b(resume|cv|curriculo)\b|systemfield resume/, types: ['file'] },
  { std: 'linkedin', label: /\blinkedin\b/, name: /linkedin/, short: true },
  { std: 'github', label: /\bgithub\b/, name: /github/, short: true },
  { std: 'portfolio', label: /\b(portfolio|website|site pessoal|personal site|web site|blog)\b/, name: /\b(portfolio|website)\b|urls other/, short: true },
  { std: 'email', label: /\b(e ?mail|email address|endereco de e ?mail)\b/, name: /\bemail\b|systemfield email/, autocomplete: /email/, short: true },
  { std: 'phone', label: /\b(phone|telefone|celular|whatsapp|mobile|contato telefonico)\b/, name: /\bphone\b|telefone|celular/, autocomplete: /^tel/, short: true },
  { std: 'first_name', label: /\b(first name|primeiro nome|given name|preferred first name|nome proprio)\b/, name: /first ?name/, autocomplete: /given-name/, short: true },
  { std: 'last_name', label: /\b(last name|sobrenome|surname|family name|ultimo nome)\b/, name: /last ?name/, autocomplete: /family-name/, short: true },
  { std: 'full_name', label: /^(nome|name|nome completo|full name|your name|seu nome|nome e sobrenome|legal name)$/, name: /^name$|systemfield name|full ?name/, autocomplete: /^name$/, short: true },
  { std: 'sponsorship', label: /\b(sponsorship|patrocinio de visto|require (a )?visa|precisa de visto)\b/ },
  { std: 'work_auth_brazil', label: /\b(autorizacao (legal )?para trabalhar|authorized to work|work authorization|legally (authorized|eligible)|eligible to work|direito de trabalhar|permissao de trabalho)\b/ },
  { std: 'relocate', label: /\b(relocat\w*|mudar de cidade|mudanca de cidade|realocacao|se mudar|disponibilidade para mudanca)\b/ },
  { std: 'salary', label: /\b(pretensao salarial|expectativa salarial|salary expectations?|expected salary|desired salary|remuneracao pretendida|compensation expectations?|faixa salarial desejada)\b/, name: /salary/ },
  { std: 'notice_period', label: /\b(aviso previo|notice period|periodo de aviso)\b/ },
  { std: 'available_from', label: /\b(start date|data de inicio|disponibilidade para (inicio|comecar)|when can you start|earliest start|quando pode comecar|data disponivel)\b/ },
  { std: 'work_mode', label: /\b(modelo de trabalho|modalidade de trabalho|work model|work arrangement|regime de trabalho preferido|preferencia de trabalho remoto)\b/ },
  { std: 'pcd', label: /\b(pcd|pessoa com deficiencia|deficiencia|disabilit\w*|disabled|necessidades especiais)\b/ },
  { std: 'current_company', label: /\b(current company|empresa atual|current employer|empregador atual|company name)\b/, name: /^org$|current ?company/, short: true },
  { std: 'current_title', label: /\b(current title|cargo atual|current role|current position|job title)\b/, short: true },
  { std: 'city', label: /^(cidade|city|cidade atual|current city|municipio)$/, name: /\bcity\b/, autocomplete: /address-level2/, short: true },
  { std: 'state', label: /^(estado|state|uf|estado atual)$/, name: /\bstate\b/, autocomplete: /address-level1/, short: true },
  { std: 'country', label: /^(pais|country|pais de residencia|country of residence|pais onde mora)$/, name: /\bcountry\b/, autocomplete: /country/, short: true },
  { std: 'location', label: /\b(location|localizacao|localidade|onde voce mora|where are you located|cidade e estado|endereco|current location)\b/, name: /\blocation\b/, short: true },
];

const DEMOGRAPHIC: [DemographicKind, RegExp][] = [
  ['gender', /\b(gender|genero|sexo|identidade de genero)\b/],
  ['race', /\b(race|racial|raca|etnia|ethnic\w*|cor ou raca|hispanic|latino)\b/],
  ['veteran', /\b(veteran|veterano|protected veteran)\b/],
  ['orientation', /\b(sexual orientation|orientacao sexual|lgbt\w*)\b/],
  ['pronouns', /\b(pronouns?|pronomes?)\b/],
];

const CONSENT = /\b(i agree|concordo|aceito|accept|consent\w*|consinto|privacy policy|politica de privacidade|data privacy|privacidade de dados|confidentiality|confidencialidade|terms|termos|lgpd|gdpr|autorizo o (uso|tratamento))\b/;

/** Classifies a field by label, name and autocomplete (research R4 stage 1, pt/en). */
export function classifyField(field: Pick<FormField, 'label' | 'name' | 'autocomplete' | 'type' | 'placeholder'> & { key?: string; options?: string[] }): FieldClass {
  const label = normalizeText(field.label ?? '').replace(/\s*\*+$/, '').replace(/\b(obrigatorio|required|opcional|optional)\b/g, '').trim();
  const id = field.key?.match(/^\[id="([^"]+)"\]$/)?.[1];
  const name = normalizeText(field.name ?? id ?? '');
  const auto = (field.autocomplete ?? '').toLowerCase();
  const words = label.split(' ').filter(Boolean).length;

  for (const [demo, re] of DEMOGRAPHIC) if (re.test(label)) return { kind: 'demographic', demo };

  // "Autofill from resume" uploaders parse the file on the ATS side: never feed them.
  if (field.type === 'file' && /\b(autofill|auto fill|preencher automaticamente|importar do curriculo|parse)\b/.test(label)) return { kind: 'other' };

  // LinkedIn "Seguir <empresa>" / "Follow <company>" checkbox: never opted in on the user's behalf.
  if (field.type === 'checkbox' && !field.options?.length && /^(seguir|follow)\b/.test(label)) return { kind: 'standard', std: 'follow_company' };

  if ((field.type === 'checkbox' || field.type === 'select' || field.type === 'radio') && CONSENT.test(label) && !/\?$/.test(field.label.trim().replace(/\*$/, ''))) return { kind: 'consent' };

  for (const r of RULES) {
    if (r.types && !r.types.includes(field.type)) continue;
    const byLabel = r.label?.test(label) && (!r.short || words <= SHORT || field.type === 'url');
    const byName = r.name?.test(name);
    const byAuto = r.autocomplete?.test(auto);
    if (byLabel || byName || byAuto) {
      if (r.std === 'resume' && field.type !== 'file') continue;
      return { kind: 'standard', std: r.std };
    }
  }
  if (field.type === 'email') return { kind: 'standard', std: 'email' };
  if (field.type === 'tel') return { kind: 'standard', std: 'phone' };
  return { kind: 'other' };
}

const PT_WORDS = /\b(voce|seu|sua|nome|sobrenome|qual|quais|possui|tem|anos|experiencia|cidade|telefone|curriculo|pretensao|vaga|empresa|nao|sim|para|com|de|da|do)\b/g;
const EN_WORDS = /\b(you|your|name|what|which|have|years|experience|city|phone|resume|salary|job|company|yes|no|the|of|and|with|are|do)\b/g;

/** Language the form is written in (answers follow it, spec edge case). */
export function formLanguage(labels: string[], fallback: 'pt' | 'en'): 'pt' | 'en' {
  const text = normalizeText(labels.join(' '));
  const pt = text.match(PT_WORDS)?.length ?? 0;
  const en = text.match(EN_WORDS)?.length ?? 0;
  if (pt === en) return fallback;
  return pt > en ? 'pt' : 'en';
}
