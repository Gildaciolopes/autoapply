import { z } from 'zod';
import type { ChatMessage, LlmProvider } from '@autoapply/llm';
import { flagDraft, normalizeDraftDate } from '@autoapply/kb';
import { ResumeDraft, type ItemFlag, type LooseDate } from '@autoapply/shared';

/**
 * What the LLM returns: raw strings only. Dates are copied as written and parsed by code
 * (constitution §I); every item carries a verbatim quote. Normalized into ResumeDraft below.
 */
const s = z.string();
const opt = z.string().nullish();
const quote = z.string().describe('shortest verbatim line from the text that contains this item');
export const LlmResumeExtraction = z.object({
  lang: z.enum(['pt', 'en', 'other']),
  basics: z.object({
    name: s,
    headline: opt,
    email: opt,
    phone: opt,
    location: opt,
    url: opt,
    summary: opt,
    profiles: z.array(z.object({ network: s, url: s })).nullish(),
  }),
  work: z.array(
    z.object({ company: s, position: s, location: opt, start: opt, end: opt, highlights: z.array(s).nullish(), quote }),
  ),
  education: z.array(z.object({ institution: s, degree: opt, area: opt, start: opt, end: opt, quote })),
  skills: z.array(z.object({ name: s, category: opt, quote })),
  languages: z.array(z.object({ language: s, fluency: opt, quote })),
  certificates: z.array(z.object({ name: s, issuer: opt, date: opt, quote })),
  projects: z.array(
    z.object({ name: s, description: opt, url: opt, highlights: z.array(s).nullish(), keywords: z.array(s).nullish(), quote }),
  ),
});
export type LlmResumeExtraction = z.infer<typeof LlmResumeExtraction>;

export const EXTRACTION_SYSTEM_PROMPT = `You extract a resume/profile into JSON. Strict rules:
- Copy ONLY what is written in the text. Never add, infer, guess, summarize or translate anything.
- Keep every value in the original language and spelling of the text.
- basics: name, headline (job title line under the name), email, phone, location copied from the header/contact line.
  basics.profiles: only social/portfolio URLs (LinkedIn, GitHub, site) with network = "LinkedIn" | "GitHub" | "Site".
- Dates: copy them exactly as written (e.g. "mar 2021", "06/2018", "2014", "atual", "present"). If absent, null.
- work[].highlights: the bullet lines of that job, verbatim.
- skills: one entry per technology/tool explicitly named in the text (skills section or bullets). Do not split or rename.
- languages: spoken languages (Português, Inglês…), not programming languages.
- quote: the shortest verbatim line of the text that contains the item's name.
- If a section does not exist, return an empty array.`;

const VISION_TRANSCRIBE_PROMPT =
  'Transcribe ALL text of this resume page exactly as written, line by line, in reading order. Output only the text. Do not translate, fix or add anything.';

export const TranscriptionSchema = z.object({ text: z.string() });

export interface DraftLlmOptions {
  model?: string;
  numCtx?: number;
}

/** OCR fallback for image-only PDFs: the transcription becomes the provenance source text. */
export async function transcribePages(llm: LlmProvider, pagesPng: string[], model: string): Promise<string> {
  const parts: string[] = [];
  for (const img of pagesPng) {
    const out = await llm.generateObject({
      schema: TranscriptionSchema,
      model,
      numCtx: 8192,
      messages: [{ role: 'user', content: VISION_TRANSCRIBE_PROMPT, images: [img] }],
    });
    parts.push(out.text);
  }
  return parts.join('\n\f\n');
}

/** LLM raw extraction → ResumeDraft (ids, parsed dates, provenance flags). */
export function normalizeExtraction(raw: LlmResumeExtraction, sourceText: string): ResumeDraft {
  const date = (v: string | null | undefined) => normalizeDraftDate(v);
  const withDates = (start: string | null | undefined, end: string | null | undefined) => {
    const a = date(start);
    const b = date(end);
    const flags: ItemFlag[] = a.ambiguous || b.ambiguous ? ['date_ambiguous'] : [];
    return { startDate: a.date as LooseDate | null, endDate: b.date as LooseDate | null, flags };
  };
  const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : undefined);

  const draft = ResumeDraft.parse({
    lang: raw.lang,
    basics: {
      name: raw.basics.name,
      headline: clean(raw.basics.headline),
      email: clean(raw.basics.email),
      phone: clean(raw.basics.phone),
      location: clean(raw.basics.location),
      url: clean(raw.basics.url),
      summary: clean(raw.basics.summary),
      profiles: raw.basics.profiles ?? [],
    },
    work: raw.work.map((w, i) => {
      const d = withDates(w.start, w.end);
      return { id: `work-${i}`, name: w.company, position: w.position, location: clean(w.location), ...d, highlights: w.highlights ?? [], quote: w.quote };
    }),
    education: raw.education.map((e, i) => {
      const d = withDates(e.start, e.end);
      return { id: `education-${i}`, institution: e.institution, studyType: clean(e.degree), area: clean(e.area), ...d, quote: e.quote };
    }),
    skills: raw.skills.map((k, i) => ({ id: `skills-${i}`, name: k.name, category: clean(k.category), quote: k.quote })),
    languages: raw.languages.map((l, i) => ({ id: `languages-${i}`, language: l.language, fluency: clean(l.fluency), quote: l.quote })),
    certificates: raw.certificates.map((c, i) => {
      const d = date(c.date);
      return { id: `certificates-${i}`, name: c.name, issuer: clean(c.issuer), date: d.date, quote: c.quote, flags: d.ambiguous ? ['date_ambiguous'] : [] };
    }),
    projects: raw.projects.map((p, i) => ({
      id: `projects-${i}`,
      name: p.name,
      description: clean(p.description),
      url: clean(p.url),
      highlights: p.highlights ?? [],
      keywords: p.keywords ?? [],
      quote: p.quote,
    })),
  });
  return flagDraft(draft, sourceText);
}

/** Text → ResumeDraft via the local LLM (constitution §IV), output Zod-validated. */
export async function extractDraft(llm: LlmProvider, sourceText: string, opts: DraftLlmOptions = {}): Promise<ResumeDraft> {
  const messages: ChatMessage[] = [
    { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
    { role: 'user', content: `TEXT:\n"""\n${sourceText}\n"""` },
  ];
  const raw = await llm.generateObject({ schema: LlmResumeExtraction, messages, model: opts.model, temperature: 0, numCtx: opts.numCtx ?? 16384 });
  return normalizeExtraction(raw, sourceText);
}
