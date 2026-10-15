import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { applyMerge, loadFactLikes, type Prisma } from '@autoapply/db';
import { diffDraft, draftToCandidates, flagDraft, flaggedItems, mergeCandidates } from '@autoapply/kb';
import { QUEUES, ResumeDraft, type ResumeDetail, type ResumeSummary, type SyncProfilePayload } from '@autoapply/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiError } from './api-error.js';
import { StorageService } from './storage.service.js';
import { toResumeSummary } from './views.js';

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export const JOB_OPTS = { attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 200, removeOnFail: 500 };

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class ResumesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @InjectQueue(QUEUES.syncProfile) private readonly queue: Queue,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  private async enqueue(payload: SyncProfilePayload) {
    await this.queue.add(payload.kind, payload, JOB_OPTS);
  }

  async upload(file: UploadedFile | undefined): Promise<ResumeSummary> {
    if (!file) throw new ApiError(400, 'missing_file', 'campo "file" obrigatório');
    if (file.size > MAX_RESUME_BYTES) throw new ApiError(413, 'too_large', 'arquivo maior que 5 MB');
    const isPdf = file.mimetype === 'application/pdf' && file.buffer.subarray(0, 5).toString('latin1') === '%PDF-';
    if (!isPdf) throw new ApiError(415, 'not_pdf', 'envie um arquivo PDF');

    const id = randomUUID();
    const minioKey = `resumes/${id}/original.pdf`;
    await this.storage.put(minioKey, file.buffer, 'application/pdf');
    const last = await this.db.resumeBase.aggregate({ _max: { version: true } });
    const row = await this.db.resumeBase.create({
      data: { id, minioKey, fileName: file.originalname, version: (last._max.version ?? 0) + 1, status: 'uploaded' },
    });
    await this.enqueue({ kind: 'parse_resume', resumeId: id, mode: 'text' });
    return toResumeSummary(row);
  }

  async list(): Promise<ResumeSummary[]> {
    const rows = await this.db.resumeBase.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(toResumeSummary);
  }

  private async find(id: string) {
    const row = await this.db.resumeBase.findUnique({ where: { id } });
    if (!row) throw new ApiError(404, 'not_found', 'currículo não encontrado');
    return row;
  }

  async get(id: string): Promise<ResumeDetail> {
    const row = await this.find(id);
    const draft = row.parsed ? ResumeDraft.parse(row.parsed) : null;
    let diff: ResumeDetail['diff'] = null;
    if (draft && row.status === 'review') {
      const hasPrevious = await this.db.factSource.count({ where: { origin: 'resume' } });
      if (hasPrevious) diff = diffDraft(draftToCandidates(draft, id), await loadFactLikes(this.db));
    }
    return { ...toResumeSummary(row), draft, diff };
  }

  async file(id: string): Promise<Buffer> {
    return this.storage.get((await this.find(id)).minioKey);
  }

  private requireStatus(row: { status: string }, ...allowed: string[]) {
    if (!allowed.includes(row.status)) {
      throw new ApiError(409, 'invalid_status', `operação não permitida no status "${row.status}"`);
    }
  }

  async saveDraft(id: string, input: unknown): Promise<ResumeDetail> {
    const row = await this.find(id);
    this.requireStatus(row, 'review');
    let draft = ResumeDraft.parse(input);
    if (row.extraction !== 'manual' && row.rawText) draft = flagDraft(draft, row.rawText);
    await this.db.resumeBase.update({ where: { id }, data: { parsed: draft as Prisma.InputJsonValue } });
    return this.get(id);
  }

  async retry(id: string, mode: 'text' | 'vision'): Promise<ResumeSummary> {
    const row = await this.find(id);
    this.requireStatus(row, 'failed', 'image_only');
    const updated = await this.db.resumeBase.update({ where: { id }, data: { status: 'uploaded', error: null } });
    await this.enqueue({ kind: 'parse_resume', resumeId: id, mode });
    return toResumeSummary(updated);
  }

  /** Manual entry: empty draft the user fills (image-only PDF without vision, or by choice). */
  async manual(id: string): Promise<ResumeDetail> {
    const row = await this.find(id);
    this.requireStatus(row, 'failed', 'image_only', 'review');
    const draft = row.parsed ? ResumeDraft.parse(row.parsed) : ResumeDraft.parse({ basics: {} });
    await this.db.resumeBase.update({
      where: { id },
      data: { status: 'review', extraction: 'manual', error: null, parsed: draft as Prisma.InputJsonValue },
    });
    return this.get(id);
  }

  async discard(id: string): Promise<ResumeSummary> {
    const row = await this.find(id);
    this.requireStatus(row, 'review', 'failed', 'image_only', 'uploaded');
    return toResumeSummary(await this.db.resumeBase.update({ where: { id }, data: { status: 'discarded' } }));
  }

  /**
   * Review → confirmed (FR-007). The only path that turns resume items into verified facts.
   * Items still flagged not_in_source must be removed or explicitly kept (acceptFlagged).
   * Items gone from the new resume are not deleted: they get missingFrom=['resume'].
   */
  async confirm(id: string, acceptFlagged: string[]) {
    const row = await this.find(id);
    this.requireStatus(row, 'review');
    let draft = ResumeDraft.parse(row.parsed ?? { basics: {} });
    if (row.extraction !== 'manual' && row.rawText) draft = flagDraft(draft, row.rawText);
    const unresolved = flaggedItems(draft).filter((i) => !acceptFlagged.includes(i));
    if (unresolved.length) {
      throw new ApiError(422, 'unresolved_flags', 'remova ou confirme os itens não encontrados no PDF', unresolved);
    }

    const candidates = draftToCandidates(draft, id);
    const existing = await loadFactLikes(this.db);
    const diff = diffDraft(candidates, existing);
    const result = await applyMerge(this.db, mergeCandidates(existing, candidates, { trusted: true }), {
      actor: 'user',
      verify: true,
      note: `resume v${row.version} confirmed`,
    });

    const seenKeys = new Set(candidates.map((c) => `${c.kind}|${c.key}`));
    const returned = existing.filter((f) => seenKeys.has(`${f.kind}|${f.key}`) && f.missingFrom?.includes('resume'));

    await this.db.$transaction(async (tx) => {
      // Items back in this resume: drop the stale missingFrom flag (applyMerge only clears it for unverified facts).
      for (const r of returned) {
        const f = await tx.fact.findUniqueOrThrow({ where: { id: r.id }, select: { missingFrom: true } });
        await tx.fact.update({ where: { id: r.id }, data: { missingFrom: f.missingFrom.filter((o) => o !== 'resume') } });
      }
      for (const r of diff.removed) {
        const f = await tx.fact.findUniqueOrThrow({ where: { id: r.factId }, select: { missingFrom: true } });
        if (!f.missingFrom.includes('resume')) {
          await tx.fact.update({ where: { id: r.factId }, data: { missingFrom: [...f.missingFrom, 'resume'] } });
        }
      }
      const b = draft.basics;
      const profile = {
        fullName: b.name,
        email: b.email ?? '',
        phone: b.phone ?? null,
        city: b.location ?? null,
        headline: b.headline ?? null,
        summary: b.summary ?? null,
        linkedinUrl: b.profiles.find((p) => /linkedin/i.test(p.network))?.url ?? null,
        portfolio: b.url ?? null,
      };
      await tx.profile.upsert({ where: { id: 'me' }, create: { id: 'me', ...profile }, update: profile });
      await tx.resumeBase.updateMany({ where: { active: true }, data: { active: false } });
      await tx.resumeBase.update({
        where: { id },
        data: { status: 'confirmed', active: true, confirmedAt: new Date(), parsed: draft as Prisma.InputJsonValue },
      });
    });

    return { created: result.created.length, updated: result.updated.length, conflicts: result.conflicts.length, missing: diff.removed.length };
  }
}
