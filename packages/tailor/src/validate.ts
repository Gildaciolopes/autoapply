import { SKILLS, type SkillDef, type TailorSentence, type ValidationFinding, type ValidationReport } from '@autoapply/shared';
import { normalizeCompany, normalizeText, prepareSource, sameOrganization, stripAccents, valueInSource } from '@autoapply/kb';
import { factSummary, type ProfileFact } from '@autoapply/jobs';
import { findNumbers } from './numbers.js';

export interface ValidationContext {
  /** Verified, active, conflict-free facts (usableFactsWhere). */
  usableFacts: ProfileFact[];
  /** Organization names the validator must recognize (user's employers, schools, job companies). */
  knownOrgs: string[];
  /** Company of the job being applied to (allowed in letter greeting/closing). */
  targetCompany?: string;
  /** Candidate's name (a closing line may be just the signature). */
  candidateName?: string;
}

/** Aliases that are also ordinary words or too short: count only when written like the technology. */
const AMBIGUOUS = new Set(['rest', 'next', 'node', 'shell', 'spark', 'express', 'rails', 'flask', 'gin', 'jest', 'vite', 'bull', 'nest', 'elastic', 'mongo', 'vue', 'git', 'linux', 'torch', 'airflow', 'tailwind', 'minio']);

interface AliasMatcher {
  def: SkillDef;
  re: RegExp;
}

const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matchers: AliasMatcher[] = SKILLS.flatMap((def) =>
  [...new Set([def.label, def.id, ...def.synonyms])].map((alias) => {
    const norm = stripAccents(alias).toLowerCase();
    const ambiguous = norm.length <= 3 || AMBIGUOUS.has(norm);
    // Ambiguous aliases must match the casing used in the dictionary label/synonym (e.g. "Go", "REST").
    const pattern = `(?<![\\p{L}\\p{N}@/_.-])${escape(ambiguous ? alias : norm)}(?![\\p{L}\\p{N}_-]|\\.[\\p{L}])`;
    return { def, re: new RegExp(pattern, ambiguous ? 'u' : 'iu') };
  }),
).filter((m) => !/^[a-z]$/.test(m.def.id) || m.def.id === 'c'); // keep "C" (exact-case) only

/** Technologies (dictionary) mentioned in a sentence. */
export function techMentions(text: string): SkillDef[] {
  const plain = stripAccents(text);
  const found = new Map<string, SkillDef>();
  for (const m of matchers) {
    const hay = m.re.flags.includes('i') ? plain.toLowerCase() : plain;
    if (m.re.test(hay)) found.set(m.def.id, m.def);
  }
  return [...found.values()];
}

/** Uppercase acronyms that are ordinary words in résumés (not technologies needing evidence). */
const ACRONYM_ALLOW = new Set(['API', 'APIS', 'REST', 'SQL', 'HTTP', 'HTTPS', 'JSON', 'CI', 'CD', 'UX', 'UI', 'PJ', 'CLT', 'TI', 'RH', 'IA', 'AI', 'ML', 'B2B', 'B2C', 'SP', 'RJ', 'MG', 'BR', 'EUA', 'USA', 'CV', 'PDF', 'PCD', 'OK', 'TV', 'SA', 'LTDA', 'ME']);
const ACRONYM_RE = /(?<![\p{L}\p{N}])([A-Z][A-Z0-9]{1,5})(?![\p{L}\p{N}])/gu;

const LEARNING_RE = /\b(aprender|aprendendo|estudar|estudando|learn|learning|interesse em conhecer|desenvolver conhecimento)\b/;
const CLAIM_RE = /\b(experiencia|experience|trabalhei|trabalho com|desenvolvi|construi|atuei|atuo|domino|dominio|implantei|migrei|usei|utilizei|uso|built|worked|developed|proficient|expert)\b/;
const TITLE_RE = /\b(senior|sr|pleno|junior|jr|lead|lider\w*|head|staff|principal|gerente|coordenador\w*|arquitet[oa]s?|architect|cto|ceo|cio|diretor\w*|especialista)\b/g;
const CERT_RE = /\b(certified|certificad\w*|certificac\w*|cka|ckad|cks|pmp|psm|cspo|csm|aws certified)\b/;
const CERT_ACRONYMS = /\b(cka|ckad|cks|pmp|psm|cspo|csm|professional|associate|practitioner|specialty|expert)\b/g;

/**
 * Deterministic Zero-Fabrication validator (constitution §I, research R3). No LLM. Every sentence must
 * cite usable facts, and every technology, organization, title/seniority word, certification and number
 * it contains must be present in the text of the facts it cites.
 */
export function validateSentences(sentences: TailorSentence[], ctx: ValidationContext): ValidationReport {
  const byId = new Map(ctx.usableFacts.map((f) => [f.id, f]));
  const findings: ValidationFinding[] = [];
  const orgs = [...new Set(ctx.knownOrgs.map((o) => o.trim()).filter((o) => normalizeCompany(o).length >= 3))];

  sentences.forEach((s, i) => {
    const add = (type: ValidationFinding['type'], token: string) => findings.push({ sentenceIndex: i, type, token });
    if (/\{\{/.test(s.text)) add('placeholder_unresolved', s.text.match(/\{\{[^}]*\}\}/)?.[0] ?? '{{');
    if (!s.factIds.length) {
      // Greeting/closing/courtesy lines make no claim about the candidate; they may be uncited only if
      // they contain nothing checkable (no tech, org other than the target, title, cert or number).
      if (!isCourtesy(s, ctx, orgs)) add('uncited', s.text.slice(0, 60));
      return;
    }
    const cited = s.factIds.map((id) => byId.get(id));
    s.factIds.forEach((id, k) => !cited[k] && add('unusable_fact', id));
    const facts = cited.filter((f): f is ProfileFact => Boolean(f));
    const citedText = facts.map(factSummary).join('\n');
    const src = prepareSource(citedText);
    const citedNorm = ` ${normalizeText(citedText)} `;
    const sentNorm = ` ${normalizeText(s.text)} `;

    // "Tenho interesse em aprender Go" names a technology without claiming it (FR-013).
    const learningOnly = LEARNING_RE.test(sentNorm) && !CLAIM_RE.test(sentNorm);
    for (const def of learningOnly ? [] : techMentions(s.text)) {
      if (![def.label, def.id, ...def.synonyms].some((a) => valueInSource(src, a, { skill: true }))) add('tech_without_evidence', def.label);
    }

    // Unknown technologies are often acronyms (EKS, SQS, GRPC): every acronym needs evidence too.
    if (!learningOnly) {
      const known = new Set(techMentions(s.text).flatMap((d) => [d.label, d.id, ...d.synonyms].map((a) => a.toUpperCase())));
      for (const m of s.text.matchAll(ACRONYM_RE)) {
        const a = m[1]!;
        if (ACRONYM_ALLOW.has(a) || known.has(a) || orgs.some((o) => o.toUpperCase() === a)) continue;
        if (!new RegExp(`(?<![\\p{L}\\p{N}])${a}(?![\\p{L}\\p{N}])`, 'iu').test(citedText)) add('tech_without_evidence', a);
      }
    }

    for (const org of orgs) {
      const n = normalizeCompany(org);
      if (!sentNorm.includes(` ${n} `)) continue;
      const isTarget = ctx.targetCompany && sameOrganization(org, ctx.targetCompany);
      if (isTarget && (s.role === 'greeting' || s.role === 'closing')) continue;
      if (!citedNorm.includes(` ${n} `)) add('org_without_evidence', org);
    }

    for (const m of sentNorm.matchAll(TITLE_RE)) {
      const w = m[1]!;
      const stem = /^(lider|coordenador|arquitet|diretor)/.exec(w)?.[1] ?? w;
      if (!new RegExp(`\\b${escape(stem)}`).test(citedNorm)) add('title_without_evidence', w);
    }

    if (CERT_RE.test(sentNorm)) {
      if (!facts.some((f) => f.kind === 'certification')) add('cert_without_evidence', sentNorm.match(CERT_RE)![1]!);
      for (const m of sentNorm.matchAll(CERT_ACRONYMS)) if (!citedNorm.includes(` ${m[1]} `)) add('cert_without_evidence', m[1]!);
    }

    const computed = new Set((s.computed ?? []).map((c) => Number(c.value)));
    const citedNumbers = findNumbers(citedText);
    for (const n of findNumbers(s.text)) {
      if (computed.has(n)) continue;
      if (!citedNumbers.some((c) => Math.abs(c - n) < 1e-9)) add('number_without_evidence', String(n));
    }
  });

  return { ok: findings.length === 0, attempts: 1, findings };
}

const COURTESY_RE = /\b(prezad[oa]s?|caro|cara|ola|dear|hello|hi|atenciosamente|cordialmente|obrigad[oa]|agradeco|agradecida|fico (no aguardo|a disposicao)|a disposicao|aguardo|interess(e|ada|ado)|contribuir|sincerely|regards|thank|looking forward)\b/;

function isCourtesy(s: TailorSentence, ctx: ValidationContext, orgs: string[]): boolean {
  const n = ` ${normalizeText(s.text)} `;
  const onlyName = ctx.candidateName && normalizeText(s.text).replace(/^(atenciosamente|cordialmente|best regards|regards|sincerely)\s*/, '') === normalizeText(ctx.candidateName);
  if (!onlyName && s.role !== 'greeting' && s.role !== 'closing' && !COURTESY_RE.test(n)) return false;
  if (CLAIM_RE.test(n) || /\b(minha|meu|minhas|meus|my) (experiencia|conhecimento|historico|trajetoria|vivencia|experience|background)\b/.test(n)) return false;
  if (techMentions(s.text).length || TITLE_RE.test(n) || CERT_RE.test(n) || findNumbers(s.text).length) {
    TITLE_RE.lastIndex = 0;
    return false;
  }
  TITLE_RE.lastIndex = 0;
  return !orgs.some((o) => n.includes(` ${normalizeCompany(o)} `) && !(ctx.targetCompany && sameOrganization(o, ctx.targetCompany)));
}

/**
 * Cover letters: the LLM often omits roles. First line opening with a salutation → greeting; final lines
 * with a sign-off or just the candidate's name → closing.
 */
export function inferLetterRoles(sentences: TailorSentence[], candidateName?: string): TailorSentence[] {
  const out = sentences.map((s) => ({ ...s }));
  const first = out[0];
  if (first && !first.role && /^(prezad|car[oa]\b|ol[aá]\b|dear\b|hello\b|hi\b|a equipe|à equipe|ao time)/i.test(first.text.trim())) first.role = 'greeting';
  for (let i = out.length - 1; i > 0; i--) {
    const s = out[i]!;
    const t = normalizeText(s.text);
    const isName = candidateName && t.endsWith(normalizeText(candidateName)) && t.length <= normalizeText(candidateName).length + 20;
    if (!s.role && (isName || /^(atenciosamente|cordialmente|obrigad|agradeco|best regards|regards|sincerely|thank)/.test(t))) s.role = 'closing';
    else break;
  }
  for (const s of out) s.role ??= 'body';
  return out;
}

/**
 * Models often echo citations inside the text ("… em 40% [f-exp1]", "(f-ts)"). Citations live in
 * `factIds`; strip the markers of known fact ids from the visible text.
 */
export function stripCitationMarkers(text: string, factIds: string[]): string {
  let t = text;
  for (const id of factIds) {
    const e = escape(id);
    t = t.replace(new RegExp(`\\s*[\\[(]\\s*${e}\\s*[\\])]`, 'g'), '');
  }
  // Mangled echoes like "[smk. f-pg]": compare alphanumerics only against the known ids.
  const compact = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const ids = factIds.map(compact).filter((x) => x.length >= 4);
  t = t.replace(/\s*[[(]([^\])]{1,80})[\])]/g, (m, inner: string) => {
    const parts = inner.split(/[,;]|\]\s*\[/).map(compact).filter(Boolean);
    return parts.length && parts.every((p) => p.length >= 4 && ids.some((id) => id === p || id.endsWith(p))) ? '' : m;
  });
  return t.replace(/\s+([.,;:])/g, '$1').trim();
}

export const FINDING_LABELS: Record<ValidationFinding['type'], string> = {
  uncited: 'frase sem evidência',
  unusable_fact: 'fato citado não verificado/inexistente',
  tech_without_evidence: 'tecnologia sem evidência',
  org_without_evidence: 'empresa sem evidência',
  title_without_evidence: 'cargo/senioridade sem evidência',
  cert_without_evidence: 'certificação sem evidência',
  number_without_evidence: 'número sem evidência',
  placeholder_unresolved: 'duração não calculável',
  too_long: 'texto longo demais',
  memory_conflict: 'memória diverge do fato (o fato vale)',
};
