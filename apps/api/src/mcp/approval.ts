import type { PrismaClient } from '@autoapply/db';
import type { SendEstimate } from '@autoapply/shared';
import { z } from 'zod';
import { ApiError } from '../kb/api-error.js';
import type { ApplyService } from '../apply/apply.service.js';
import type { ReviewService } from '../review/review.service.js';

/** F7 two-step approval from the assistant (FR-024/FR-025, research R8). */
export const PREVIEW_TTL_MS = 10 * 60_000;
export const MAX_IDS = 10;

/** No filter, no "all": explicit ids only. */
export const ApproveInput = z.object({ ids: z.array(z.string().min(1)).min(1).max(MAX_IDS) }).strict();
export const ConfirmInput = z.object({ previewId: z.string().min(1) }).strict();

const PreviewItems = z.array(z.object({ applicationId: z.string(), fingerprint: z.string() }));

export interface PreviewItemView {
  id: string;
  title: string;
  company: string;
  platform: string | null;
  ok: boolean;
  reason?: string;
}

export interface ApprovalDeps {
  db: PrismaClient;
  apply: Pick<ApplyService, 'fingerprint' | 'approve'>;
  review: Pick<ReviewService, 'estimate'>;
}

async function guard(db: PrismaClient) {
  const prefs = await db.searchPreference.findUnique({ where: { id: 'default' }, select: { mcpApproveEnabled: true, pausedAt: true } });
  if (!prefs?.mcpApproveEnabled) throw new ApiError(403, 'approve_disabled', 'aprovação pelo assistente está desligada: ative em Integrações no AutoApply');
  if (prefs.pausedAt) throw new ApiError(409, 'paused', 'sistema pausado (Parar tudo): retome no AutoApply antes de aprovar');
}

export async function createPreview(d: ApprovalDeps, input: { ids: string[]; sessionId: string }, now = new Date()) {
  const { ids } = ApproveInput.parse({ ids: input.ids });
  if (new Set(ids).size !== ids.length) throw new ApiError(400, 'duplicate_ids', 'ids repetidos');
  await guard(d.db);
  const rows = await d.db.application.findMany({ where: { id: { in: ids } }, include: { job: { select: { title: true, company: { select: { name: true } } } } } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items: PreviewItemView[] = [];
  const stored: z.infer<typeof PreviewItems> = [];
  for (const id of ids) {
    const a = byId.get(id);
    if (!a) {
      items.push({ id, title: '—', company: '—', platform: null, ok: false, reason: 'not_found' });
      continue;
    }
    const ok = a.status === 'ready';
    items.push({ id, title: a.job.title, company: a.job.company?.name ?? '—', platform: a.platform ?? a.ats, ok, ...(ok ? {} : { reason: 'not_ready' }) });
    if (ok) stored.push({ applicationId: id, fingerprint: await d.apply.fingerprint(id) });
  }
  if (!stored.length) return { previewId: null, expiresAt: null, items, estimate: null as SendEstimate | null };
  const expiresAt = new Date(now.getTime() + PREVIEW_TTL_MS);
  const p = await d.db.approvalPreview.create({ data: { mcpSessionId: input.sessionId, items: stored, expiresAt } });
  const estimate = await d.review.estimate(stored.map((s) => s.applicationId));
  return { previewId: p.id, expiresAt: expiresAt.toISOString(), items, estimate };
}

export async function confirmPreview(d: ApprovalDeps, input: { previewId: string; sessionId: string }, now = new Date()) {
  const { previewId } = ConfirmInput.parse({ previewId: input.previewId });
  await guard(d.db);
  const p = await d.db.approvalPreview.findUnique({ where: { id: previewId } });
  if (!p) throw new ApiError(404, 'preview_not_found', 'prévia não encontrada');
  if (p.mcpSessionId !== input.sessionId) throw new ApiError(403, 'other_session', 'esta prévia foi criada em outra sessão do assistente');
  if (p.confirmedAt) throw new ApiError(409, 'preview_used', 'prévia já confirmada');
  if (p.expiresAt.getTime() < now.getTime()) throw new ApiError(409, 'preview_expired', 'prévia expirada (10 min): peça uma nova');
  // Compare-and-set: one confirmation per preview, even with concurrent calls.
  const cas = await d.db.approvalPreview.updateMany({ where: { id: p.id, confirmedAt: null }, data: { confirmedAt: now } });
  if (cas.count !== 1) throw new ApiError(409, 'preview_used', 'prévia já confirmada');

  const approved: string[] = [];
  const refused: { id: string; code: string }[] = [];
  for (const item of PreviewItems.parse(p.items)) {
    const a = await d.db.application.findUnique({ where: { id: item.applicationId }, select: { status: true } });
    if (a?.status !== 'ready') {
      refused.push({ id: item.applicationId, code: 'not_ready' });
      continue;
    }
    if ((await d.apply.fingerprint(item.applicationId)) !== item.fingerprint) {
      refused.push({ id: item.applicationId, code: 'changed' });
      continue;
    }
    try {
      await d.apply.approve(item.applicationId);
      approved.push(item.applicationId);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      refused.push({ id: item.applicationId, code: e.code });
    }
  }
  return { approved, refused };
}
