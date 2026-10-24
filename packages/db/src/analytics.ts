import { addCounts, emptyCounts, funnelRates, median, periodStart, ratio, weekKey, weekLabel } from '@autoapply/jobs';
import { findSkillByAlias, FUNNEL_STAGES, type FunnelBucket, type FunnelCounts, type FunnelQuery, type FunnelView, type ReplyType } from '@autoapply/shared';
import { Prisma, type PrismaClient } from './generated/prisma/client.js';

const TZ = 'America/Sao_Paulo';

/** Split key per research R1. Fixed SQL fragments only (never user input). */
const SPLIT_KEY: Record<string, string> = {
  none: `'all'`,
  source: `s."type"::text`,
  platform: `COALESCE(a."platform", 'none')`,
  week: `to_char(date_trunc('week', (j."firstSeenAt" AT TIME ZONE 'UTC') AT TIME ZONE '${TZ}'), 'YYYY-MM-DD')`,
};

/**
 * Stages are cumulative: an item that reached a later stage also counts in every earlier one, so the
 * funnel never converts above 100% (e.g. an application submitted by hand without a prepare run).
 */
const INTERVIEW = `a."interviewAt" IS NOT NULL`;
const REPLIED = `(a."firstReplyAt" IS NOT NULL OR ${INTERVIEW})`;
const SUBMITTED = `(a."submittedAt" IS NOT NULL OR ${REPLIED})`;
const APPROVED = `(a."approvedAt" IS NOT NULL OR ${SUBMITTED})`;
const PREPARED = `(a."preparedAt" IS NOT NULL OR ${APPROVED})`;
const ABOVE = `((sc."passed" AND sc."score" >= $THRESHOLD) OR ${PREPARED})`;

interface Row {
  key: string;
  found: bigint;
  above_threshold: bigint;
  prepared: bigint;
  approved: bigint;
  submitted: bigint;
  replied: bigint;
  interview: bigint;
}

const SOURCE_LABELS: Record<string, string> = {
  linkedin_mcp: 'LinkedIn',
  indeed: 'Indeed',
  glassdoor: 'Glassdoor',
  google_jobs: 'Google Jobs',
  gupy: 'Gupy',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workable: 'Workable',
  remotive: 'Remotive',
  generic: 'Outros',
  jobspy: 'JobSpy',
  none: 'sem candidatura',
};

/** GET /analytics/funnel — cohort = jobs first seen in the period (research R1). */
export async function funnel(db: PrismaClient, q: FunnelQuery, now = new Date()): Promise<FunnelView> {
  const from = periodStart(now, q.weeks);
  const prefs = await db.searchPreference.findUnique({ where: { id: 'default' }, select: { scoreThreshold: true } });
  const threshold = prefs?.scoreThreshold ?? 70;
  const key = SPLIT_KEY[q.split ?? 'none']!;
  const above = ABOVE.replace('$THRESHOLD', String(Math.trunc(threshold)));

  const rows = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT ${Prisma.raw(key)} AS key,
      COUNT(*) AS found,
      COUNT(*) FILTER (WHERE ${Prisma.raw(above)}) AS above_threshold,
      COUNT(*) FILTER (WHERE ${Prisma.raw(PREPARED)}) AS prepared,
      COUNT(*) FILTER (WHERE ${Prisma.raw(APPROVED)}) AS approved,
      COUNT(*) FILTER (WHERE ${Prisma.raw(SUBMITTED)}) AS submitted,
      COUNT(*) FILTER (WHERE ${Prisma.raw(REPLIED)}) AS replied,
      COUNT(*) FILTER (WHERE ${Prisma.raw(INTERVIEW)}) AS interview
    FROM "Job" j
    JOIN "Source" s ON s."id" = j."sourceId"
    LEFT JOIN "JobScore" sc ON sc."jobId" = j."id"
    LEFT JOIN "Application" a ON a."jobId" = j."id"
    WHERE j."firstSeenAt" >= ${from} AND j."firstSeenAt" <= ${now}
    GROUP BY 1`);

  const toCounts = (r: Row): FunnelCounts => {
    const c = emptyCounts();
    for (const s of FUNNEL_STAGES) c[s] = Number(r[s]);
    return c;
  };
  let buckets: FunnelBucket[] = rows.map((r) => {
    const counts = toCounts(r);
    return { key: r.key, label: q.split === 'week' ? weekLabel(r.key) : (SOURCE_LABELS[r.key] ?? r.key), counts, rates: funnelRates(counts) };
  });
  const totals = buckets.reduce((acc, b) => addCounts(acc, b.counts), emptyCounts());

  if (q.split === 'week') {
    // Every week of the period, empty ones included, oldest first.
    const byKey = new Map(buckets.map((b) => [b.key, b]));
    buckets = [];
    for (let i = 0; i < q.weeks; i++) {
      const k = weekKey(new Date(from.getTime() + (i * 7 + 3) * 86_400_000));
      buckets.push(byKey.get(k) ?? { key: k, label: weekLabel(k), counts: emptyCounts(), rates: funnelRates(emptyCounts()) });
    }
  } else if (q.split) {
    buckets.sort((a, b) => b.counts.found - a.counts.found || a.key.localeCompare(b.key));
  } else {
    buckets = [];
  }

  const cohort = Prisma.sql`a."jobId" IN (SELECT j."id" FROM "Job" j WHERE j."firstSeenAt" >= ${from} AND j."firstSeenAt" <= ${now})`;
  const replyRows = await db.$queryRaw<{ days: number }[]>(Prisma.sql`
    SELECT EXTRACT(EPOCH FROM (a."firstReplyAt" - a."submittedAt")) / 86400.0 AS days
    FROM "Application" a
    WHERE ${cohort} AND a."firstReplyAt" IS NOT NULL AND a."submittedAt" IS NOT NULL AND a."firstReplyAt" >= a."submittedAt"`);
  const typeRows = await db.$queryRaw<{ type: ReplyType; n: bigint }[]>(Prisma.sql`
    SELECT r."type" AS type, COUNT(*) AS n
    FROM "Reply" r JOIN "Application" a ON a."id" = r."applicationId"
    WHERE ${cohort}
    GROUP BY 1`);
  const replyTypes: Record<ReplyType, number> = { interview: 0, rejection: 0, info_request: 0, confirmation: 0, other: 0 };
  for (const t of typeRows) replyTypes[t.type] = Number(t.n);

  const skillRows = await db.$queryRaw<{ skill: string; n: bigint }[]>(Prisma.sql`
    SELECT lower(trim(m)) AS skill, COUNT(*) AS n
    FROM "Job" j JOIN "JobScore" sc ON sc."jobId" = j."id", unnest(sc."missing") AS m
    WHERE j."firstSeenAt" >= ${from} AND j."firstSeenAt" <= ${now} AND sc."passed" AND sc."score" >= ${threshold}
    GROUP BY 1 ORDER BY 2 DESC LIMIT 100`);
  const skills = new Map<string, number>();
  for (const r of skillRows) {
    if (!r.skill) continue;
    const label = findSkillByAlias(r.skill)?.label ?? r.skill;
    skills.set(label, (skills.get(label) ?? 0) + Number(r.n));
  }
  const missingSkills = [...skills.entries()]
    .map(([skill, count]) => ({ skill, count }))
    .sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill))
    .slice(0, 10);

  const days = median(replyRows.map((r) => Number(r.days)));
  return {
    from: from.toISOString(),
    to: now.toISOString(),
    weeks: q.weeks,
    threshold,
    split: q.split ?? null,
    totals,
    rates: funnelRates(totals),
    buckets,
    responseRate: ratio(totals.replied, totals.submitted),
    medianDaysToReply: days === null ? null : Math.round(days * 10) / 10,
    replyTypes,
    missingSkills,
  };
}
