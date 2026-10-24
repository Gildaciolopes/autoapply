import { loadTailorBasics, loadUsableFacts, queueTailorDocuments, type TailorBasics } from '@autoapply/db';
import { factsToRenderModel, letterText, renderLetterPdf, renderResumePdf } from '@autoapply/resume';
import { TailorPlan, TailorSentence } from '@autoapply/shared';
import { factsHash } from '@autoapply/tailor';
import type { KbDeps } from '../kb/deps.js';
import { tailorLetter } from '../tailor/tailor-letter.js';
import { tailorResume } from '../tailor/tailor-resume.js';
import type { AttachmentFile } from './fill.js';

const RENDER_KINDS = new Set(['experience', 'education', 'skill', 'language', 'certification', 'project']);
const READY = new Set(['draft', 'approved']);

type Doc = NonNullable<Awaited<ReturnType<KbDeps['db']['tailoredDocument']['findUnique']>>>;

export type EnsureResult =
  | { ok: true; doc: Doc; generated: boolean }
  | { ok: false; reason: 'tailoring_needs_review' | 'cover_letter_required'; doc: Doc | null };

/** Same rule as the API (F3 FR-011): any change in the document's facts → outdated. */
async function isOutdated(deps: KbDeps, d: Doc): Promise<boolean> {
  const usable = (await loadUsableFacts(deps.db)).filter((f) => d.factIds.includes(f.id));
  return usable.length !== d.factIds.length || factsHash(usable) !== d.factsHash;
}

/**
 * Tailored document for the job, generating it inline when missing/outdated/failed (FR-010, same
 * worker and LLM, concurrency 1). `needs_review` after generation → blocking reason.
 */
export async function ensureTailored(deps: KbDeps, jobId: string, kind: 'resume' | 'cover_letter'): Promise<EnsureResult> {
  let doc = await deps.db.tailoredDocument.findUnique({ where: { jobId_kind: { jobId, kind } } });
  let generated = false;
  const usable = doc && READY.has(doc.status) && !(await isOutdated(deps, doc));
  if (!usable && doc?.status !== 'needs_review') {
    const [id] = await queueTailorDocuments(deps.db, jobId, [kind]);
    await deps.db.tailoredDocument.update({ where: { id }, data: { status: 'generating' } });
    if (kind === 'resume') await tailorResume(deps, id!);
    else await tailorLetter(deps, id!);
    doc = await deps.db.tailoredDocument.findUniqueOrThrow({ where: { id } });
    generated = true;
  }
  if (!doc || !READY.has(doc.status)) {
    return { ok: false, reason: kind === 'resume' ? 'tailoring_needs_review' : 'cover_letter_required', doc };
  }
  return { ok: true, doc, generated };
}

const fileBase = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Tailored resume PDF rendered in memory (never written to disk). */
export async function resumeFile(basics: TailorBasics, doc: Doc): Promise<AttachmentFile | null> {
  if (!basics.profile) return null;
  const facts = basics.facts.filter((f) => RENDER_KINDS.has(f.kind));
  const plan = TailorPlan.parse(doc.plan ?? {});
  const summary = TailorSentence.array().parse(doc.sentences ?? []).map((s) => s.text).join(' ');
  const r = await renderResumePdf(factsToRenderModel(basics.profile, facts, { lang: doc.lang as 'pt' | 'en', plan: { ...plan, summary } }));
  if (r.overflow) return null;
  const suffix = doc.lang === 'en' ? 'resume' : 'curriculo';
  return { name: `${fileBase(basics.profile.fullName)}-${suffix}.pdf`, mimeType: 'application/pdf', buffer: r.pdf };
}

export async function letterFile(basics: TailorBasics, doc: Doc): Promise<{ file: AttachmentFile; text: string } | null> {
  if (!basics.profile) return null;
  const input = { sentences: TailorSentence.array().parse(doc.sentences ?? []), profile: basics.profile, lang: doc.lang as 'pt' | 'en' };
  const buffer = await renderLetterPdf(input);
  const suffix = doc.lang === 'en' ? 'cover-letter' : 'carta';
  return { file: { name: `${fileBase(basics.profile.fullName)}-${suffix}.pdf`, mimeType: 'application/pdf', buffer }, text: letterText(input) };
}

/** `accept` attribute allows a PDF (empty = anything). */
export function acceptsPdf(accept?: string): boolean {
  if (!accept?.trim()) return true;
  return accept.split(',').some((a) => /^(\.pdf|application\/pdf|application\/\*|\*\/\*|\*)$/i.test(a.trim()));
}

export { loadTailorBasics };
