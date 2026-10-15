import { Injectable } from '@nestjs/common';
import { loadPreferences, usableFactsWhere, type Prisma } from '@autoapply/db';
import { factSummary } from '@autoapply/jobs';
import type { JobCard, JobsQuery, MatchedEvidence } from '@autoapply/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiError } from '../kb/api-error.js';
import { PreferencesService } from './preferences.service.js';

const CLOSED_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
const include = { company: true, score: true, origins: { select: { source: true, url: true } } } satisfies Prisma.JobInclude;
type JobRow = Prisma.JobGetPayload<{ include: typeof include }>;

export function toCard(j: JobRow, now = Date.now()): JobCard {
  const s = j.score;
  return {
    id: j.id,
    title: j.title,
    company: j.company?.name ?? null,
    location: j.location,
    city: j.city,
    uf: j.uf,
    remote: j.remote,
    workMode: j.workMode,
    seniority: j.seniority,
    salaryMin: j.salaryMin,
    salaryMax: j.salaryMax,
    salaryText: j.salaryText,
    url: j.url,
    applyUrl: j.applyUrl,
    postedAt: j.postedAt?.toISOString() ?? null,
    firstSeenAt: j.firstSeenAt.toISOString(),
    lastSeenAt: j.lastSeenAt.toISOString(),
    possiblyClosed: now - j.lastSeenAt.getTime() > CLOSED_AFTER_MS,
    hidden: j.hidden,
    interesting: j.interesting,
    origins: j.origins,
    score: s
      ? {
          score: s.score,
          passed: s.passed,
          filterReason: s.filterReason as never,
          similarity: s.similarity,
          judged: s.judged,
          matched: s.matchedEvidence as MatchedEvidence[],
          missing: s.missing,
          reasons: s.reasons,
        }
      : null,
  };
}

@Injectable()
export class FeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prefs: PreferencesService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** FR-017: ranked feed. Ordered by score desc, postedAt desc; offset cursor. */
  async list(q: JobsQuery): Promise<{ items: JobCard[]; nextCursor: number | null }> {
    const scoreWhere: Prisma.JobScoreWhereInput = {
      ...(q.showFiltered === 'true' ? {} : { passed: true }),
      ...(q.minScore !== undefined || q.maxScore !== undefined ? { score: { gte: q.minScore ?? 0, lte: q.maxScore ?? 100 } } : {}),
      ...(q.judged ? { judged: q.judged === 'true' } : {}),
    };
    const where: Prisma.JobWhereInput = {
      score: { is: scoreWhere },
      ...(q.showHidden === 'true' ? {} : { hidden: false }),
      ...(q.interesting ? { interesting: q.interesting === 'true' } : {}),
      ...(q.source ? { origins: { some: { source: q.source } } } : {}),
      ...(q.workMode ? (q.workMode === 'remote' ? { OR: [{ remote: true }, { workMode: 'remote' }] } : { workMode: q.workMode }) : {}),
      ...(q.newSince ? { firstSeenAt: { gte: new Date(q.newSince) } } : {}),
    };
    const skip = q.cursor ?? 0;
    const rows = await this.db.job.findMany({
      where,
      include,
      orderBy: [{ score: { score: 'desc' } }, { postedAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
      skip,
      take: q.limit + 1,
    });
    const more = rows.length > q.limit;
    return { items: rows.slice(0, q.limit).map((r) => toCard(r)), nextCursor: more ? skip + q.limit : null };
  }

  async get(id: string) {
    const j = await this.db.job.findUnique({ where: { id }, include });
    if (!j) throw new ApiError(404, 'not_found', 'vaga não encontrada');
    const card = toCard(j);
    const ids = (card.score?.matched ?? []).flatMap((m) => m.factIds);
    const facts = ids.length ? await this.db.fact.findMany({ where: { id: { in: ids }, ...usableFactsWhere }, select: { id: true, kind: true, value: true } }) : [];
    const byId = new Map(facts.map((f) => [f.id, f]));
    return {
      ...card,
      description: j.description,
      matchedEvidence: (card.score?.matched ?? []).map((m) => ({
        skill: m.skill,
        facts: m.factIds.flatMap((fid) => {
          const f = byId.get(fid);
          return f ? [{ id: f.id, kind: f.kind, summary: factSummary(f) }] : [];
        }),
      })),
    };
  }

  async patch(id: string, body: { hidden?: boolean; interesting?: boolean }): Promise<JobCard> {
    if (!(await this.db.job.findUnique({ where: { id } }))) throw new ApiError(404, 'not_found', 'vaga não encontrada');
    return toCard(await this.db.job.update({ where: { id }, data: body, include }));
  }

  /** Adds the job's company to blockedCompanies and re-filters (FR-017/018). */
  async blockCompany(id: string) {
    const j = await this.db.job.findUnique({ where: { id }, include: { company: true } });
    if (!j?.company) throw new ApiError(404, 'not_found', 'vaga/empresa não encontrada');
    const prefs = await loadPreferences(this.db);
    if (!prefs.blockedCompanies.includes(j.company.name)) prefs.blockedCompanies.push(j.company.name);
    const { newlyFiltered } = await this.prefs.put(prefs);
    await this.db.company.update({ where: { id: j.company.id }, data: { blocked: true } });
    return { company: j.company.name, hiddenJobs: newlyFiltered };
  }
}
