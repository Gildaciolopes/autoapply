import { Injectable } from '@nestjs/common';
import { platformOf } from '@autoapply/apply';
import { sendEstimate } from '@autoapply/jobs';
import { ensurePlatform, loadPreferences, platformUsage } from '@autoapply/db';
import { NeedsReason, type ApplicationView, type ReviewGroup, type ReviewItem, type ReviewQueue, type SendEstimate } from '@autoapply/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiError } from '../kb/api-error.js';
import { ApplyService } from '../apply/apply.service.js';
import { runListItem } from '../night/views.js';

const GROUPS: ReviewGroup[] = ['ready', 'needs_input', 'failed', 'submit_uncertain', 'waiting_limit', 'approved'];
const GATE_CODES = new Set(['daily_cap', 'platform_paused']);
const NOT_REJECTABLE = new Set(['approved', 'submitting', 'submitted', 'submit_uncertain', 'queued', 'tailoring', 'applying']);

/** F6 morning review queue (FR-009..FR-012, research R9). */
@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apply: ApplyService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  private groupOf(status: string, reasons: NeedsReason[]): ReviewGroup | null {
    if (status === 'approved') return reasons.some((r) => GATE_CODES.has(r.code)) ? 'waiting_limit' : 'approved';
    if (status === 'submitting') return 'approved';
    return (GROUPS as string[]).includes(status) ? (status as ReviewGroup) : null;
  }

  async queue(runId?: string): Promise<ReviewQueue> {
    const run = runId ? await this.db.nightRun.findUnique({ where: { id: runId } }) : null;
    if (runId && !run) throw new ApiError(404, 'not_found', 'execução não encontrada');
    const prefs = await loadPreferences(this.db);
    const rows = await this.db.application.findMany({
      where: { status: { in: ['ready', 'needs_input', 'failed', 'submit_uncertain', 'approved', 'submitting'] }, ...(runId ? { nightRunId: runId } : {}) },
      include: { job: { select: { title: true, company: { select: { name: true } }, score: { select: { score: true } } } }, answers: true },
      take: 500,
    });
    const groups = Object.fromEntries(GROUPS.map((g) => [g, [] as ReviewItem[]])) as Record<ReviewGroup, ReviewItem[]>;
    for (const a of rows) {
      const reasons = NeedsReason.array().catch([]).parse(a.needsReasons);
      const group = this.groupOf(a.status, reasons);
      if (!group) continue;
      groups[group].push({
        applicationId: a.id,
        jobId: a.jobId,
        title: a.job.title,
        company: a.job.company?.name ?? null,
        score: a.job.score?.score ?? null,
        platform: a.platform ?? (a.ats ? platformOf(a.ats) : null),
        status: a.status,
        group,
        runId: a.nightRunId,
        lowConfidence: a.answers.filter((x) => x.answer !== null && x.confidence < prefs.applyConfidence).length,
        needsQuestions: a.answers.filter((x) => x.blocking).map((x) => x.question),
        reason: a.needsReason ?? a.submitError ?? a.error,
        updatedAt: a.updatedAt.toISOString(),
      });
    }
    for (const g of GROUPS) groups[g].sort((x, y) => (y.score ?? -1) - (x.score ?? -1));
    const counts = Object.fromEntries(GROUPS.map((g) => [g, groups[g].length])) as Record<ReviewGroup, number>;
    return { groups, counts, run: run ? runListItem(run) : null };
  }

  /** Confirmation summary for batch approve: per platform, how many go today and the extra days. */
  async estimate(ids: string[]): Promise<SendEstimate> {
    const apps = await this.db.application.findMany({ where: { id: { in: ids } }, select: { platform: true, ats: true } });
    const items = apps.map((a) => ({ kind: platformOf(a.platform ?? a.ats) }));
    const kinds = [...new Set(items.map((i) => i.kind))];
    const platforms = await Promise.all(
      kinds.map(async (kind) => {
        const p = await ensurePlatform(this.db, kind);
        const usage = await platformUsage(this.db, kind);
        return { kind, remainingToday: Math.max(0, p.submitCap - usage.submitted), submitCap: p.submitCap, minIntervalSec: p.minIntervalSec };
      }),
    );
    return { perPlatform: sendEstimate(items, platforms) as SendEstimate['perPlatform'] };
  }

  async reject(id: string, reason: string): Promise<ApplicationView> {
    const a = await this.db.application.findUnique({ where: { id } });
    if (!a) throw new ApiError(404, 'not_found', 'candidatura não encontrada');
    if (NOT_REJECTABLE.has(a.status)) throw new ApiError(409, 'not_rejectable', 'esta candidatura não pode ser rejeitada agora');
    await this.db.application.update({ where: { id }, data: { status: 'rejected', rejectedAt: new Date(), rejectReason: reason, approvedAt: null, approvalHash: null } });
    return this.apply.view(id);
  }

  async unreject(id: string): Promise<ApplicationView> {
    const a = await this.db.application.findUnique({ where: { id } });
    if (!a) throw new ApiError(404, 'not_found', 'candidatura não encontrada');
    if (a.status !== 'rejected') throw new ApiError(409, 'not_rejected', 'candidatura não está rejeitada');
    await this.db.application.update({ where: { id }, data: { status: 'skipped', rejectedAt: null, rejectReason: null } });
    return this.apply.apply(a.jobId);
  }
}
