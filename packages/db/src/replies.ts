import { recomputeOutcome, TRACKING_DAYS, type ReplyCandidate } from '@autoapply/jobs';
import type { ReplyView } from '@autoapply/shared';
import type { Application, Company, Job, PrismaClient, Reply } from './generated/prisma/client.js';

/** Statuses a reply can be attached to (research R4). */
export const REPLYABLE_STATUSES = ['submitted', 'submit_uncertain', 'already_applied'] as const;

/**
 * Recompute outcome and reply timestamps from the application's replies (research R6). A reply to an
 * uncertain submission confirms it (`submittedVia = confirmed_by_reply`).
 */
export async function applyReplyEffects(db: PrismaClient, applicationId: string): Promise<void> {
  const app = await db.application.findUnique({ where: { id: applicationId }, include: { replies: { select: { type: true, receivedAt: true } } } });
  if (!app) return;
  const s = recomputeOutcome(app.replies);
  const earliest = app.replies.map((r) => r.receivedAt).sort((a, b) => a.getTime() - b.getTime())[0];
  const confirm = app.status === 'submit_uncertain' && app.replies.length > 0;
  await db.application.update({
    where: { id: applicationId },
    data: {
      outcome: s.outcome,
      firstReplyAt: s.firstReplyAt,
      interviewAt: s.interviewAt,
      lastReplyAt: s.lastReplyAt,
      ...(confirm ? { status: 'submitted', submittedVia: 'confirmed_by_reply', submittedAt: app.submittedAt ?? earliest ?? new Date() } : {}),
    },
  });
}

/** Applications an email may answer: submitted/uncertain within the tracking period, plus already applied. */
export async function replyCandidates(db: PrismaClient, now = new Date()): Promise<(ReplyCandidate & { since: Date })[]> {
  const since = new Date(now.getTime() - TRACKING_DAYS * 86_400_000);
  const apps = await db.application.findMany({
    where: {
      status: { in: [...REPLYABLE_STATUSES] },
      OR: [{ submittedAt: { gte: since } }, { submittedAt: null, updatedAt: { gte: since } }],
    },
    include: { job: { include: { company: true } } },
  });
  return apps.map((a) => ({
    applicationId: a.id,
    company: a.job.company?.name ?? '',
    atsSlug: a.job.company?.atsSlug ?? null,
    title: a.job.title,
    submittedAt: a.submittedAt,
    since: a.submittedAt ?? a.updatedAt,
  }));
}

export type ReplyRow = Reply & { application: Application & { job: Job & { company: Company | null } } };

export const REPLY_INCLUDE = { application: { include: { job: { include: { company: true } } } } } as const;

export function replyView(r: ReplyRow): ReplyView {
  return {
    id: r.id,
    applicationId: r.applicationId,
    jobId: r.application.jobId,
    title: r.application.job.title,
    company: r.application.job.company?.name ?? '',
    origin: r.origin,
    type: r.type,
    confidence: r.confidence,
    needsReview: r.needsReview,
    userEdited: r.userEdited,
    receivedAt: r.receivedAt.toISOString(),
    sender: r.sender,
    subject: r.subject,
    excerpt: r.excerpt,
    note: r.note,
    link: r.link,
  };
}
