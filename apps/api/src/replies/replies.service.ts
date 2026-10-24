import { Injectable } from '@nestjs/common';
import { applyReplyEffects, REPLY_INCLUDE, REPLYABLE_STATUSES, replyView } from '@autoapply/db';
import type { ManualReplyBody, ReplyPatchBody, ReplyView } from '@autoapply/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiError } from '../kb/api-error.js';

/** F7 replies timeline (FR-013..FR-015): email replies are corrected here, manual ones added. */
@Injectable()
export class RepliesService {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  async list(opts: { review?: boolean; applicationId?: string } = {}): Promise<ReplyView[]> {
    const rows = await this.db.reply.findMany({
      where: { ...(opts.review ? { needsReview: true } : {}), ...(opts.applicationId ? { applicationId: opts.applicationId } : {}) },
      include: REPLY_INCLUDE,
      orderBy: [{ needsReview: 'desc' }, { receivedAt: 'desc' }],
      take: 500,
    });
    return rows.map(replyView);
  }

  private async replyable(applicationId: string) {
    const a = await this.db.application.findUnique({ where: { id: applicationId } });
    if (!a) throw new ApiError(404, 'not_found', 'candidatura não encontrada');
    if (!(REPLYABLE_STATUSES as readonly string[]).includes(a.status)) throw new ApiError(409, 'not_submitted', 'só candidaturas enviadas recebem respostas');
    return a;
  }

  private async one(id: string): Promise<ReplyView> {
    return replyView(await this.db.reply.findUniqueOrThrow({ where: { id }, include: REPLY_INCLUDE }));
  }

  async manual(applicationId: string, body: ManualReplyBody): Promise<ReplyView> {
    await this.replyable(applicationId);
    const r = await this.db.reply.create({
      data: { applicationId, origin: 'manual', type: body.type, receivedAt: new Date(body.receivedAt), note: body.note ?? null, userEdited: true },
    });
    await applyReplyEffects(this.db, applicationId);
    await this.db.runEvent.create({ data: { applicationId, queue: 'mail', level: 'info', message: `resposta registrada: ${body.type}`, data: { step: 'reply', replyId: r.id, origin: 'manual' } } });
    return this.one(r.id);
  }

  async patch(id: string, body: ReplyPatchBody): Promise<ReplyView> {
    const r = await this.db.reply.findUnique({ where: { id } });
    if (!r) throw new ApiError(404, 'not_found', 'resposta não encontrada');
    if (body.applicationId && body.applicationId !== r.applicationId) await this.replyable(body.applicationId);
    await this.db.reply.update({
      where: { id },
      data: {
        ...(body.type ? { type: body.type } : {}),
        ...(body.applicationId ? { applicationId: body.applicationId } : {}),
        needsReview: body.needsReview ?? false,
        userEdited: true,
      },
    });
    await applyReplyEffects(this.db, r.applicationId);
    if (body.applicationId && body.applicationId !== r.applicationId) await applyReplyEffects(this.db, body.applicationId);
    return this.one(id);
  }

  /** The Gmail message id stays in ProcessedMail, so a later check never re-adds it. */
  async remove(id: string): Promise<void> {
    const r = await this.db.reply.findUnique({ where: { id } });
    if (!r) throw new ApiError(404, 'not_found', 'resposta não encontrada');
    if (r.messageId) await this.db.processedMail.upsert({ where: { messageId: r.messageId }, create: { messageId: r.messageId, outcome: 'matched' }, update: {} });
    await this.db.reply.delete({ where: { id } });
    await applyReplyEffects(this.db, r.applicationId);
  }
}
