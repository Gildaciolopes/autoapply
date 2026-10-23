import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { loadTailorBasics, loadUsableFacts, queueTailorDocuments, type Prisma, type TailoredDocument } from '@autoapply/db';
import { factsToRenderModel, renderLetterPdf, renderResumePdf } from '@autoapply/resume';
import {
  QUEUES,
  TailorPlan,
  TailorSentence,
  ValidationReport,
  type EvalRunView,
  type TailorPayload,
  type TailoredDocumentView,
} from '@autoapply/shared';
import { diffModels, factsHash, requiresCoverLetter, substitutePlaceholders, validateSentences, wordCount } from '@autoapply/tailor';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiError } from '../kb/api-error.js';

const RENDER_KINDS = new Set(['experience', 'education', 'skill', 'language', 'certification', 'project']);
const LETTER_MAX_WORDS = 250;
const json = (v: unknown) => v as Prisma.InputJsonValue;

export function toView(d: TailoredDocument): TailoredDocumentView {
  return {
    id: d.id,
    jobId: d.jobId,
    kind: d.kind,
    status: d.status,
    lang: d.lang,
    plan: TailorPlan.parse(d.plan ?? {}),
    sentences: TailorSentence.array().parse(d.sentences ?? []),
    validation: ValidationReport.parse({ ok: true, ...(d.validation as object) }),
    userEdited: d.userEdited,
    approvedAt: d.approvedAt?.toISOString() ?? null,
    error: d.error,
    updatedAt: d.updatedAt.toISOString(),
  };
}

@Injectable()
export class TailorService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUES.tailor) private readonly queue: Queue,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** POST /jobs/:id/tailor — queue resume (+ letter when required/asked). */
  async tailor(jobId: string, coverLetter?: boolean): Promise<{ documents: TailoredDocumentView[] }> {
    const job = await this.db.job.findUnique({ where: { id: jobId } });
    if (!job) throw new ApiError(404, 'not_found', 'vaga não encontrada');
    if (!(await loadUsableFacts(this.db)).length) throw new ApiError(409, 'no_facts', 'verifique a base de conhecimento antes de adaptar o currículo');
    const wantsLetter = coverLetter ?? requiresCoverLetter(`${job.title}\n${job.description ?? ''}`);
    const ids = await queueTailorDocuments(this.db, jobId, wantsLetter ? ['resume', 'cover_letter'] : ['resume']);
    await this.enqueue({ jobId, documentIds: ids });
    const docs = await this.db.tailoredDocument.findMany({ where: { id: { in: ids } } });
    return { documents: docs.map(toView) };
  }

  private async enqueue(p: TailorPayload) {
    await this.queue.add('tailor', p, { attempts: 2, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 200, removeOnFail: 200 });
  }

  /** Marks documents whose facts changed (or became unusable) as outdated (FR-011). */
  private async refreshOutdated(d: TailoredDocument): Promise<TailoredDocument> {
    if (!['draft', 'needs_review', 'approved'].includes(d.status)) return d;
    const usable = (await loadUsableFacts(this.db)).filter((f) => d.factIds.includes(f.id));
    if (usable.length === d.factIds.length && factsHash(usable) === d.factsHash) return d;
    return this.db.tailoredDocument.update({ where: { id: d.id }, data: { status: 'outdated', approvedAt: null } });
  }

  async forJob(jobId: string) {
    const docs = await this.db.tailoredDocument.findMany({ where: { jobId } });
    const fresh = await Promise.all(docs.map((d) => this.refreshOutdated(d)));
    const by = (k: string) => fresh.find((d) => d.kind === k);
    return { resume: by('resume') ? toView(by('resume')!) : null, coverLetter: by('cover_letter') ? toView(by('cover_letter')!) : null };
  }

  private async doc(id: string) {
    const d = await this.db.tailoredDocument.findUnique({ where: { id } });
    if (!d) throw new ApiError(404, 'not_found', 'documento não encontrado');
    return this.refreshOutdated(d);
  }

  private renderModels(basics: Awaited<ReturnType<typeof loadTailorBasics>>, d: TailoredDocument) {
    if (!basics.profile) throw new ApiError(409, 'no_profile', 'confirme um currículo antes');
    const facts = basics.facts.filter((f) => RENDER_KINDS.has(f.kind));
    const plan = TailorPlan.parse(d.plan ?? {});
    const summary = TailorSentence.array().parse(d.sentences ?? []).map((s) => s.text).join(' ');
    return {
      base: factsToRenderModel(basics.profile, facts, { lang: d.lang as 'pt' | 'en' }),
      tailored: factsToRenderModel(basics.profile, facts, { lang: d.lang as 'pt' | 'en', plan: { ...plan, summary } }),
    };
  }

  async diff(id: string) {
    const d = await this.doc(id);
    if (d.kind !== 'resume') throw new ApiError(400, 'not_resume', 'diff só para currículo');
    const m = this.renderModels(await loadTailorBasics(this.db, d.jobId), d);
    return { ...m, changes: diffModels(m.base, m.tailored) };
  }

  /** User edits: hide/restore items, or edit sentences (re-validated; nothing saved on failure, FR-009). */
  async patch(id: string, body: { hiddenItemIds?: string[]; sentences?: { text: string; factIds: string[]; role?: 'greeting' | 'body' | 'closing' }[] }) {
    const d = await this.doc(id);
    if (d.status === 'queued' || d.status === 'generating') throw new ApiError(409, 'busy', 'documento sendo gerado');
    const data: Prisma.TailoredDocumentUpdateInput = {};
    if (body.hiddenItemIds) data.plan = json({ ...TailorPlan.parse(d.plan ?? {}), hiddenItemIds: body.hiddenItemIds });
    if (body.sentences) {
      const basics = await loadTailorBasics(this.db, d.jobId);
      const { sentences, findings } = substitutePlaceholders(body.sentences, basics.facts);
      const report = validateSentences(sentences, { usableFacts: basics.facts, knownOrgs: basics.knownOrgs, targetCompany: basics.job.company, candidateName: basics.profile?.fullName });
      const all = [...findings, ...report.findings];
      if (d.kind === 'cover_letter' && wordCount(sentences.map((s) => s.text).join(' ')) > LETTER_MAX_WORDS) {
        all.push({ sentenceIndex: sentences.length - 1, type: 'too_long', token: `> ${LETTER_MAX_WORDS} palavras` });
      }
      if (all.length) throw new ApiError(422, 'validation_failed', 'o texto tem afirmações sem evidência', all);
      const cited = new Set(sentences.flatMap((s) => s.factIds));
      const keep = basics.facts.filter((f) => cited.has(f.id) || (d.kind === 'resume' && d.factIds.includes(f.id)));
      Object.assign(data, {
        sentences: json(sentences),
        validation: json({ ok: true, attempts: 1, findings: [] }),
        userEdited: true,
        factIds: keep.map((f) => f.id),
        factsHash: factsHash(keep),
      });
    }
    // A validated edit makes it a clean draft; hiding items alone keeps needs_review/outdated, but un-approves.
    data.status = body.sentences ? 'draft' : d.status === 'approved' ? 'draft' : d.status;
    data.approvedAt = null;
    return toView(await this.db.tailoredDocument.update({ where: { id }, data }));
  }

  /** FR-011: only clean, current drafts can be approved. */
  async approve(id: string) {
    const d = await this.doc(id);
    if (d.status !== 'draft') throw new ApiError(409, 'not_approvable', `não é possível aprovar no status "${d.status}"`);
    return toView(await this.db.tailoredDocument.update({ where: { id }, data: { status: 'approved', approvedAt: new Date() } }));
  }

  async regenerate(id: string) {
    const d = await this.doc(id);
    const ids = await queueTailorDocuments(this.db, d.jobId, [d.kind]);
    await this.enqueue({ jobId: d.jobId, documentIds: ids });
    return { documentIds: ids };
  }

  /** On-demand PDF (resume with plan, or letter). Outdated documents are refused. */
  async pdf(id: string): Promise<{ pdf: Buffer; name: string }> {
    const d = await this.doc(id);
    if (d.status === 'outdated') throw new ApiError(409, 'outdated', 'documento desatualizado: gere novamente');
    if (!['draft', 'needs_review', 'approved'].includes(d.status)) throw new ApiError(409, 'not_ready', 'documento ainda não gerado');
    const basics = await loadTailorBasics(this.db, d.jobId);
    if (d.kind === 'cover_letter') {
      if (!basics.profile) throw new ApiError(409, 'no_profile', 'confirme um currículo antes');
      const sentences = TailorSentence.array().parse(d.sentences ?? []);
      return { pdf: await renderLetterPdf({ sentences, profile: basics.profile, lang: d.lang as 'pt' | 'en' }), name: 'carta.pdf' };
    }
    const r = await renderResumePdf(this.renderModels(basics, d).tailored);
    if (r.overflow) throw new ApiError(422, 'overflow', `o currículo ocupa ${r.pages} páginas`, { pages: r.pages, items: r.items });
    return { pdf: r.pdf, name: 'curriculo.pdf' };
  }

  async evalRuns(suite = 'tailor'): Promise<EvalRunView[]> {
    const rows = await this.db.evalRun.findMany({ where: { suite }, orderBy: { createdAt: 'desc' }, take: 20 });
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }
}
