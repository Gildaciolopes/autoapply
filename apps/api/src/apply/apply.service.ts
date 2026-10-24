import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { applicationFactsHash, approvalHash, normalizeQuestion, platformOf } from '@autoapply/apply';
import { loadPreferences, loadUsableFacts, prepareApplication, PrepareError, stopEverything, type Application, type Artifact, type FormAnswer, type Prisma } from '@autoapply/db';
import {
  ApplyReport,
  AtsKind,
  NeedsReason,
  QUEUES,
  ValidationFinding,
  type ApplicationListItem,
  type ApplicationSummary,
  type ApplicationView,
  type ApplyBatchBody,
  type ApplyPayload,
  type UserAnswersBody,
} from '@autoapply/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiError } from '../kb/api-error.js';
import { StorageService } from '../kb/storage.service.js';

const json = (v: unknown) => v as Prisma.InputJsonValue;
const SESSION_KINDS = new Set(['gupy', 'linkedin']);
export const APPLY_JOB_OPTS = { attempts: 2, backoff: { type: 'exponential' as const, delay: 30_000 }, removeOnComplete: 200, removeOnFail: 200 };

const PREPARE_STATUS: Record<string, number> = { not_found: 404 };

/** `prepareApplication` with its typed errors mapped to API errors (409 unless not found). */
export async function prepareOrThrow(db: Parameters<typeof prepareApplication>[0], jobId: string, opts: Parameters<typeof prepareApplication>[2] = {}) {
  try {
    return await prepareApplication(db, jobId, opts);
  } catch (e) {
    if (e instanceof PrepareError) throw new ApiError(PREPARE_STATUS[e.code] ?? 409, e.code, e.message);
    throw e;
  }
}

type AppRow = Application & { job: { title: string; company: { name: string } | null }; answers?: FormAnswer[]; artifacts?: Artifact[] };

@Injectable()
export class ApplyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @InjectQueue(QUEUES.apply) private readonly queue: Queue,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** FR-019: cited facts changed / became unusable, or an attached tailored document changed. */
  private async outdated(a: Application & { answers?: FormAnswer[] }, usable?: Awaited<ReturnType<typeof loadUsableFacts>>): Promise<boolean> {
    if (!a.factsHash || !['ready', 'needs_input'].includes(a.status)) return false;
    const answers = a.answers ?? (await this.db.formAnswer.findMany({ where: { applicationId: a.id } }));
    const cited = new Set(answers.filter((x) => x.answer !== null).flatMap((x) => x.evidence).filter((id) => !id.startsWith('profile:')));
    const facts = (usable ?? (await loadUsableFacts(this.db))).filter((f) => cited.has(f.id));
    if (facts.length !== cited.size) return true;
    const docs = await this.db.tailoredDocument.findMany({ where: { id: { in: a.tailoredDocIds } }, select: { id: true, updatedAt: true } });
    if (docs.length !== a.tailoredDocIds.length) return true;
    return applicationFactsHash(facts, docs) !== a.factsHash;
  }

  private async listItem(a: AppRow, usable?: Awaited<ReturnType<typeof loadUsableFacts>>): Promise<ApplicationListItem> {
    const reasons = NeedsReason.array().catch([]).parse(a.needsReasons ?? []);
    return {
      id: a.id,
      jobId: a.jobId,
      jobTitle: a.job.title,
      company: a.job.company?.name ?? '',
      ats: a.ats ? AtsKind.catch('generic').parse(a.ats) : null,
      status: a.status,
      mode: a.mode,
      needsReason: a.needsReason,
      reasonCodes: [...new Set(reasons.map((r) => r.code))],
      outdated: await this.outdated(a, usable),
      attempts: a.attempts,
      updatedAt: a.updatedAt.toISOString(),
      outcome: a.outcome,
    };
  }

  private async load(id: string): Promise<AppRow> {
    const a = await this.db.application.findUnique({
      where: { id },
      include: { job: { select: { title: true, company: { select: { name: true } } } }, answers: { orderBy: [{ step: 'asc' }, { createdAt: 'asc' }] }, artifacts: { orderBy: { createdAt: 'asc' } } },
    });
    if (!a) throw new ApiError(404, 'not_found', 'candidatura não encontrada');
    return a;
  }

  async view(id: string): Promise<ApplicationView> {
    const a = await this.load(id);
    return {
      ...(await this.listItem(a)),
      formUrl: a.formUrl,
      needsReasons: NeedsReason.array().catch([]).parse(a.needsReasons ?? []),
      report: ApplyReport.parse(a.report ?? {}),
      error: a.error,
      lastRunAt: a.lastRunAt?.toISOString() ?? null,
      platform: a.platform,
      approvedAt: a.approvedAt?.toISOString() ?? null,
      submittedAt: a.submittedAt?.toISOString() ?? null,
      submittedVia: a.submittedVia,
      sentValues: (a.sentValues as { fieldKey: string; question: string; value: string }[] | null) ?? null,
      submitError: a.submitError,
      preparedAt: a.preparedAt?.toISOString() ?? null,
      firstReplyAt: a.firstReplyAt?.toISOString() ?? null,
      interviewAt: a.interviewAt?.toISOString() ?? null,
      answers: (a.answers ?? []).map((x) => ({
        id: x.id,
        fieldKey: x.fieldKey,
        fieldType: x.fieldType as never,
        question: x.question,
        required: x.required,
        options: x.options,
        step: x.step,
        answer: x.answer,
        source: x.source as never,
        confidence: x.confidence,
        evidence: x.evidence,
        blocking: x.blocking,
        reason: x.reason,
        findings: ValidationFinding.array().catch([]).parse(x.findings ?? []),
        filled: x.filled,
      })),
      artifacts: (a.artifacts ?? []).map((x) => ({ id: x.id, type: x.type, label: x.label, attempt: x.attempt, createdAt: x.createdAt.toISOString() })),
    };
  }

  private async enqueue(app: Application): Promise<void> {
    const p: ApplyPayload = { applicationId: app.id, attempt: app.attempts };
    await this.queue.add('apply', p, { ...APPLY_JOB_OPTS, jobId: `apply-${app.id}-${app.attempts}` });
  }

  /** POST /jobs/:id/apply — (re)starts the dry-run simulation of a job. */
  async apply(jobId: string): Promise<ApplicationView> {
    const app = await prepareOrThrow(this.db, jobId);
    await this.enqueue(app);
    return this.view(app.id);
  }

  async rerun(id: string): Promise<ApplicationView> {
    const a = await this.load(id);
    return this.apply(a.jobId);
  }

  /** POST /apply/batch — selected jobs, or the best-scored jobs with a ready tailored resume (FR-015). */
  async batch(body: ApplyBatchBody): Promise<{ queued: ApplicationView[] }> {
    let jobIds = body.jobIds ?? [];
    if (body.topN) {
      const jobs = await this.db.job.findMany({
        where: {
          hidden: false,
          score: { is: { passed: true } },
          tailored: { some: { kind: 'resume', status: { in: ['draft', 'approved'] } } },
          OR: [{ application: { is: null } }, { application: { is: { status: { in: ['failed', 'needs_input', 'skipped'] } } } }],
        },
        orderBy: { score: { score: 'desc' } },
        take: body.topN,
        select: { id: true },
      });
      jobIds = jobs.map((j) => j.id);
    }
    const queued: ApplicationView[] = [];
    for (const id of jobIds) {
      try {
        queued.push(await this.apply(id));
      } catch (e) {
        if (!(e instanceof ApiError) || e.code !== 'already_running') throw e;
      }
    }
    return { queued };
  }

  /** Kill switch on the apply queue only (the API route goes through ControlService.stop, F6). */
  async stop(): Promise<{ cancelled: number }> {
    const res = await stopEverything(this.db, {
      removeJobs: async () => {
        const jobs = await this.queue.getJobs(['waiting', 'delayed', 'prioritized']);
        await Promise.all(jobs.map((j) => j?.remove().catch(() => undefined)));
        return jobs.length;
      },
    });
    return { cancelled: res.cancelled };
  }

  async list(status?: string): Promise<ApplicationListItem[]> {
    const rows = await this.db.application.findMany({
      where: status ? { status: status as never } : {},
      include: { job: { select: { title: true, company: { select: { name: true } } } }, answers: true },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    const usable = await loadUsableFacts(this.db);
    return Promise.all(rows.map((r) => this.listItem(r, usable)));
  }

  async summary(): Promise<ApplicationSummary> {
    const rows = await this.db.application.findMany({ select: { status: true, needsReasons: true } });
    const count = (s: string) => rows.filter((r) => r.status === s).length;
    const byReason: Record<string, number> = {};
    for (const r of rows.filter((x) => x.status === 'needs_input')) {
      for (const code of new Set(NeedsReason.array().catch([]).parse(r.needsReasons ?? []).map((x) => x.code))) byReason[code] = (byReason[code] ?? 0) + 1;
    }
    return {
      ready: count('ready'),
      needs_input: { total: count('needs_input'), byReason },
      failed: count('failed'),
      queued: count('queued'),
      applying: count('applying') + count('tailoring'),
      skipped: count('skipped'),
      approved: count('approved') + count('submitting'),
      submitted: count('submitted'),
      submit_uncertain: count('submit_uncertain'),
    };
  }

  async artifact(id: string, artifactId: string): Promise<Buffer> {
    const art = await this.db.artifact.findFirst({ where: { id: artifactId, applicationId: id } });
    if (!art) throw new ApiError(404, 'not_found', 'imagem não encontrada');
    return this.storage.get(art.minioKey);
  }

  /**
   * POST /applications/:id/answers (US3): the user's answers to blocking questions become approved
   * memories reused by later simulations (FR-009). Cited facts must be usable.
   */
  async answers(id: string, body: UserAnswersBody): Promise<ApplicationView> {
    const a = await this.load(id);
    const byKey = new Map((a.answers ?? []).map((x) => [x.fieldKey, x]));
    const usable = new Set((await loadUsableFacts(this.db)).map((f) => f.id));
    for (const ans of body.answers) {
      const field = byKey.get(ans.fieldKey);
      if (!field) throw new ApiError(422, 'unknown_field', `campo desconhecido: ${ans.fieldKey}`);
      if (field.options.length && !field.options.includes(ans.answer) && field.fieldType !== 'checkbox') {
        throw new ApiError(422, 'invalid_option', `"${ans.answer}" não é uma opção de "${field.question}"`);
      }
      const bad = (ans.factIds ?? []).filter((f) => !usable.has(f));
      if (bad.length) throw new ApiError(422, 'unusable_fact', 'fatos citados não verificados', bad);
    }
    // F6 learning loop (FR-020): only what the user typed becomes a memory, tagged with where it came from.
    const edited = a.status === 'ready' || a.status === 'approved';
    for (const ans of body.answers) {
      const field = byKey.get(ans.fieldKey)!;
      if (field.fieldType === 'file') throw new ApiError(422, 'unknown_field', `anexos não são editáveis: ${ans.fieldKey}`);
      const normalized = normalizeQuestion(field.question);
      const existing = await this.db.answerMemory.findFirst({ where: { normalized, fieldType: field.fieldType } });
      const origin = body.from === 'review' ? 'inline' : edited && !field.blocking ? 'edit' : 'needs_input';
      const data = { question: field.question, normalized, answer: ans.answer, fieldType: field.fieldType, evidence: ans.factIds ?? [], approved: true, enabled: true, source: 'user', origin };
      if (existing) {
        await this.db.answerMemory.update({ where: { id: existing.id }, data });
        await this.db.$executeRaw`UPDATE "AnswerMemory" SET embedding = NULL WHERE id = ${existing.id}`; // re-embedded by the worker
      } else await this.db.answerMemory.create({ data });
    }
    // An edited prepared application must be prepared again before it can be approved (FR-012).
    if (body.rerun || edited) return this.rerun(id);
    return this.view(id);
  }

  /** Fingerprint of what the user sees now (answers + tailored docs + form URL, research R4). */
  private async approvalFingerprint(a: Application): Promise<string> {
    const answers = await this.db.formAnswer.findMany({ where: { applicationId: a.id }, select: { fieldKey: true, answer: true } });
    const docs = await this.db.tailoredDocument.findMany({ where: { id: { in: a.tailoredDocIds } }, select: { id: true, updatedAt: true } });
    return approvalHash({ formUrl: a.formUrl, answers, docs });
  }

  /** F7: fingerprint an assistant approval preview is bound to (same hash the F5 approval stores). */
  async fingerprint(id: string): Promise<string> {
    return this.approvalFingerprint(await this.load(id));
  }

  /** POST /applications/:id/approve — review mode only (constitution §II, FR-007). */
  async approve(id: string): Promise<ApplicationView> {
    const prefs = await loadPreferences(this.db);
    if (prefs.mode !== 'review') throw new ApiError(409, 'dry_run_mode', prefs.mode === 'dry_run' ? 'modo simulação: nada é enviado' : 'autopilot não disponível; use o modo revisão');
    const a = await this.load(id);
    if (a.status !== 'ready') throw new ApiError(409, 'not_ready', 'só candidaturas "pronto para enviar" podem ser aprovadas');
    if (await this.outdated(a)) throw new ApiError(409, 'outdated', 'seus dados mudaram: simule de novo antes de aprovar');
    const platform = platformOf(a.platform ?? a.ats);
    if (SESSION_KINDS.has(platform)) {
      const p = await this.db.platform.findUnique({ where: { kind: platform } });
      if (!p?.sessionEnc || p.sessionStatus !== 'connected') throw new ApiError(409, 'platform_not_connected', `conecte ${platform} em Plataformas antes de enviar`);
    }
    const hash = await this.approvalFingerprint(a);
    const r = await this.db.application.updateMany({ where: { id, status: 'ready' }, data: { status: 'approved', approvedAt: new Date(), approvalHash: hash, platform, needsReasons: json([]), needsReason: null } });
    if (r.count !== 1) throw new ApiError(409, 'not_ready', 'a candidatura mudou de estado');
    await this.queue.add('submit', { applicationId: id, approvalHash: hash }, { attempts: 1, removeOnComplete: 200, removeOnFail: 200, jobId: `submit-${id}-${Date.now()}` });
    return this.view(id);
  }

  async approveBatch(ids: string[]): Promise<{ approved: ApplicationView[]; refused: { id: string; code: string }[] }> {
    const approved: ApplicationView[] = [];
    const refused: { id: string; code: string }[] = [];
    for (const id of ids) {
      try {
        approved.push(await this.approve(id));
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        refused.push({ id, code: e.code });
      }
    }
    return { approved, refused };
  }

  /** POST /applications/:id/mark — the user resolves an uncertain submission (never retried by the system). */
  async mark(id: string, sent: boolean): Promise<ApplicationView> {
    const a = await this.load(id);
    if (a.status !== 'submit_uncertain') throw new ApiError(409, 'not_uncertain', 'só envios incertos podem ser marcados');
    await this.db.application.update({
      where: { id },
      data: sent
        ? { status: 'submitted', submittedAt: new Date(), submittedVia: 'manual' }
        : { status: 'ready', approvedAt: null, approvalHash: null, submittedVia: null, submitError: null },
    });
    return this.view(id);
  }
}
