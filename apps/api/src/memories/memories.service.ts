import { Injectable } from '@nestjs/common';
import { normalizeQuestion } from '@autoapply/apply';
import type { AnswerMemory } from '@autoapply/db';
import type { MemoryPatchBody, MemoryView } from '@autoapply/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiError } from '../kb/api-error.js';

/** F6 answer memory management (FR-023). Only user-confirmed answers exist here (FR-020). */
@Injectable()
export class MemoriesService {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  /** Latest fact-vs-memory conflicts seen in prepared answers, keyed by normalized question + type. */
  private async conflicts(): Promise<Map<string, string>> {
    const rows = await this.db.formAnswer.findMany({
      where: { findings: { array_contains: [{ type: 'memory_conflict' }] } },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: { question: true, fieldType: true, answer: true },
    });
    const map = new Map<string, string>();
    for (const r of rows) {
      const key = `${normalizeQuestion(r.question)}|${r.fieldType}`;
      if (!map.has(key)) map.set(key, `diverge do fato: o formulário usou "${r.answer ?? ''}" (fato verificado)`);
    }
    return map;
  }

  private view(m: AnswerMemory, conflicts: Map<string, string>): MemoryView {
    return {
      id: m.id,
      question: m.question,
      answer: m.answer,
      fieldType: m.fieldType,
      origin: m.origin,
      enabled: m.enabled,
      usedCount: m.usedCount,
      lastUsedAt: m.lastUsedAt?.toISOString() ?? null,
      updatedAt: m.updatedAt.toISOString(),
      conflict: conflicts.get(`${m.normalized}|${m.fieldType}`) ?? null,
    };
  }

  async list(q?: string, enabled?: boolean): Promise<MemoryView[]> {
    const term = q?.trim();
    const rows = await this.db.answerMemory.findMany({
      where: {
        approved: true,
        ...(enabled !== undefined ? { enabled } : {}),
        ...(term ? { OR: [{ question: { contains: term, mode: 'insensitive' } }, { answer: { contains: term, mode: 'insensitive' } }] } : {}),
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 500,
    });
    const conflicts = await this.conflicts();
    return rows.map((m) => this.view(m, conflicts));
  }

  async patch(id: string, body: MemoryPatchBody): Promise<MemoryView> {
    const m = await this.db.answerMemory.findUnique({ where: { id } });
    if (!m || !m.approved) throw new ApiError(404, 'not_found', 'memória não encontrada');
    const updated = await this.db.answerMemory.update({
      where: { id },
      data: { ...(body.answer !== undefined ? { answer: body.answer } : {}), ...(body.enabled !== undefined ? { enabled: body.enabled } : {}) },
    });
    // A changed answer is re-embedded by the worker (the question did not change, but keep it simple and safe).
    if (body.answer !== undefined) await this.db.$executeRaw`UPDATE "AnswerMemory" SET embedding = NULL WHERE id = ${id}`;
    return this.view(updated, await this.conflicts());
  }

  async remove(id: string): Promise<void> {
    const r = await this.db.answerMemory.deleteMany({ where: { id } });
    if (!r.count) throw new ApiError(404, 'not_found', 'memória não encontrada');
  }
}
