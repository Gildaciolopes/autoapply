import { compareLooseDate, formatLooseDate } from '@autoapply/kb';
import type { FactKind, FactValueOf, RenderItem } from '@autoapply/shared';

export interface RenderFact {
  id: string;
  kind: FactKind;
  value: unknown;
}

export interface RenderProfile {
  fullName: string;
  headline?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  linkedinUrl?: string | null;
  githubUser?: string | null;
  portfolio?: string | null;
  summary?: string | null;
}

/** Tailoring plan (F3): order/selection only, plus a validated summary. */
export interface RenderPlan {
  summary?: string;
  bulletOrder?: Record<string, number[]>;
  entryOrder?: Record<string, string[]>;
  skillOrder?: string[];
  hiddenItemIds?: string[];
}

const rank = (order: string[], id: string) => {
  const i = order.indexOf(id);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
};

export interface RenderBullet {
  id: string;
  text: string;
}
export interface RenderEntry {
  id: string;
  heading: string;
  sub?: string;
  dates?: string;
  text?: string;
  bullets: RenderBullet[];
}
export interface RenderSection {
  id: 'summary' | 'experience' | 'education' | 'skills' | 'languages' | 'certifications' | 'projects';
  title: string;
  entries: RenderEntry[];
}
export interface RenderModel {
  lang: 'pt' | 'en';
  name: string;
  headline?: string;
  contact: string[];
  sections: RenderSection[];
  watermark?: string;
}

const TITLES = {
  pt: { summary: 'Resumo', experience: 'Experiência', education: 'Formação', skills: 'Habilidades', languages: 'Idiomas', certifications: 'Certificações', projects: 'Projetos' },
  en: { summary: 'Summary', experience: 'Experience', education: 'Education', skills: 'Skills', languages: 'Languages', certifications: 'Certifications', projects: 'Projects' },
} as const;

const range = (start: unknown, end: unknown, lang: 'pt' | 'en') => {
  const s = formatLooseDate(start as never, lang);
  const e = formatLooseDate(end as never, lang);
  return s && e ? `${s} – ${e}` : s || e;
};

/**
 * Facts → ordered, id-stable render model (FR-021/FR-023). Item ids are fact ids, bullets
 * `<factId>#h<n>`; hiddenItemIds removes entries/bullets for this rendering only (FR-022).
 */
export function factsToRenderModel(
  profile: RenderProfile,
  facts: RenderFact[],
  opts: { hiddenItemIds?: string[]; lang?: 'pt' | 'en'; watermark?: string; plan?: RenderPlan } = {},
): RenderModel {
  const lang = opts.lang ?? 'pt';
  const plan = opts.plan;
  const hidden = new Set([...(opts.hiddenItemIds ?? []), ...(plan?.hiddenItemIds ?? [])]);
  const summary = plan?.summary ?? profile.summary;
  /** Order by a list of ids; ids not in the list keep their relative order at the end. */
  const byOrder = <T extends { id: string }>(list: T[], order?: string[]) =>
    order?.length ? [...list].sort((a, b) => rank(order, a.id) - rank(order, b.id)) : list;
  const t = TITLES[lang];
  const of = <K extends FactKind>(kind: K) =>
    facts.filter((f) => f.kind === kind && !hidden.has(f.id)).map((f) => ({ id: f.id, v: f.value as FactValueOf<K> }));
  // Tailoring reorders bullets (FR-002) but never changes their text; ids stay `<factId>#h<original index>`.
  const bullets = (id: string, list: string[] = []) => {
    const all = list.map((text, n) => ({ id: `${id}#h${n}`, text, n }));
    const order = plan?.bulletOrder?.[id];
    const ordered = order?.length ? [...all].sort((a, b) => rank(order.map(String), String(a.n)) - rank(order.map(String), String(b.n))) : all;
    return ordered.filter((b) => !hidden.has(b.id) && b.text.trim()).map(({ id: bid, text }) => ({ id: bid, text }));
  };

  const sections: RenderSection[] = [];
  if (summary && !hidden.has('summary')) {
    sections.push({ id: 'summary', title: t.summary, entries: [{ id: 'summary', heading: '', text: summary, bullets: [] }] });
  }

  const exp = of('experience').sort((a, b) => compareLooseDate(b.v.end, a.v.end) || compareLooseDate(b.v.start, a.v.start));
  if (exp.length) {
    sections.push({
      id: 'experience',
      title: t.experience,
      entries: exp.map(({ id, v }) => ({
        id,
        heading: v.title,
        sub: [v.company, v.location].filter(Boolean).join(' · '),
        dates: range(v.start, v.end, lang),
        bullets: bullets(id, v.highlights),
      })),
    });
  }

  const projects = byOrder(of('project'), plan?.entryOrder?.project);
  if (projects.length) {
    sections.push({
      id: 'projects',
      title: t.projects,
      entries: projects.map(({ id, v }) => ({
        id,
        heading: v.name,
        sub: v.url,
        text: v.description,
        bullets: bullets(id, v.highlights),
      })),
    });
  }

  const edu = of('education').sort((a, b) => compareLooseDate(b.v.end, a.v.end));
  if (edu.length) {
    sections.push({
      id: 'education',
      title: t.education,
      entries: edu.map(({ id, v }) => ({
        id,
        heading: [v.degree, v.area].filter(Boolean).join(lang === 'pt' ? ' em ' : ' in ') || v.institution,
        sub: v.degree || v.area ? v.institution : undefined,
        dates: range(v.start, v.end, lang),
        bullets: [],
      })),
    });
  }

  const skills = byOrder(of('skill'), plan?.skillOrder);
  if (skills.length) {
    const groups = new Map<string, { id: string; name: string }[]>();
    for (const { id, v } of skills) {
      const g = v.category ?? '';
      groups.set(g, [...(groups.get(g) ?? []), { id, name: v.name }]);
    }
    sections.push({
      id: 'skills',
      title: t.skills,
      entries: [...groups.entries()].map(([cat, list]) => ({
        id: `skills:${cat || 'all'}`,
        heading: cat,
        text: list.map((s) => s.name).join(', '),
        bullets: [],
      })),
    });
  }

  const langs = of('language');
  if (langs.length) {
    sections.push({
      id: 'languages',
      title: t.languages,
      entries: [{ id: 'languages', heading: '', text: langs.map(({ v }) => (v.fluency ? `${v.language} (${v.fluency})` : v.language)).join(' · '), bullets: [] }],
    });
  }

  const certs = byOrder(of('certification'), plan?.entryOrder?.certification);
  if (certs.length) {
    sections.push({
      id: 'certifications',
      title: t.certifications,
      entries: [{ id: 'certifications', heading: '', bullets: certs.map(({ id, v }) => ({ id, text: [v.name, v.issuer].filter(Boolean).join(' — ') })) }],
    });
  }

  const contact = [
    profile.email,
    profile.phone,
    profile.city,
    profile.linkedinUrl?.replace(/^https?:\/\/(www\.)?/, ''),
    profile.githubUser ? `github.com/${profile.githubUser}` : null,
    profile.portfolio?.replace(/^https?:\/\//, ''),
  ].filter((x): x is string => Boolean(x));

  return { lang, name: profile.fullName, headline: profile.headline ?? undefined, contact, sections, watermark: opts.watermark };
}

/** Items the user can hide when the resume overflows one page. */
export function renderItems(model: RenderModel): RenderItem[] {
  return model.sections.flatMap((s) =>
    s.entries.flatMap((e) => [
      ...(e.heading || e.text ? [{ id: e.id, section: s.id, label: [e.heading, e.sub].filter(Boolean).join(' — ') || (e.text ?? '').slice(0, 80) }] : []),
      ...e.bullets.map((b) => ({ id: b.id, section: s.id, label: b.text.slice(0, 100) })),
    ]),
  );
}

/** Text lines expected in reading order (used by ATS lint to check extraction order). */
export function expectedLines(model: RenderModel): string[] {
  const lines = [model.name];
  for (const s of model.sections) {
    lines.push(s.title);
    for (const e of s.entries) {
      if (e.heading) lines.push(e.heading);
      if (e.text) lines.push(e.text);
      for (const b of e.bullets) lines.push(b.text);
    }
  }
  return lines;
}
