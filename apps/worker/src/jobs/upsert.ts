import { sourceBudgets, type PrismaClient } from '@autoapply/db';
import { dedupeHash, detectSeniority, detectWorkMode, originKey, parseLocation, parseSalary } from '@autoapply/jobs';
import { RawJob, type DiscoverResult, type JobSourceOutcome, type JobSourceType } from '@autoapply/shared';

export interface UpsertResult {
  outcomes: Partial<Record<JobSourceType, JobSourceOutcome>>;
  /** Jobs touched by this run (new or seen again), for scoring. */
  jobIds: string[];
}

/**
 * Normalize + dedupe + upsert (FR-005/FR-006). One Job per dedupe hash, one JobOrigin per
 * (source, externalId|url). Daily caps count NEW origins; newest postings first.
 */
export async function upsertResults(db: PrismaClient, runId: string, results: DiscoverResult[], now = new Date()): Promise<UpsertResult> {
  const budgets = new Map((await sourceBudgets(db, now)).map((b) => [b.type, b.remaining]));
  const sourceRows = new Map((await db.source.findMany()).map((s) => [s.type, s.id]));
  const outcomes: UpsertResult['outcomes'] = {};
  const touched = new Set<string>();

  for (const r of results) {
    const o = (outcomes[r.source] ??= { status: 'success', found: 0, new: 0, duplicates: 0, filtered: 0 });
    if (r.error) {
      o.status = o.found ? 'success' : 'failed';
      o.error = r.error;
    }
    const jobs = r.jobs
      .map((j) => RawJob.safeParse(j))
      .filter((p) => p.success)
      .map((p) => p.data!)
      .sort((a, b) => (b.postedAt ?? '').localeCompare(a.postedAt ?? ''));
    o.found += jobs.length;

    for (const raw of jobs) {
      const key = originKey(raw);
      const origin = await db.jobOrigin.findUnique({ where: { source_externalId: { source: raw.source, externalId: key } } });
      if (origin) {
        await db.jobOrigin.update({ where: { id: origin.id }, data: { lastSeenAt: now } });
        await db.job.update({ where: { id: origin.jobId }, data: { lastSeenAt: now } });
        touched.add(origin.jobId);
        o.duplicates++;
        continue;
      }
      const left = budgets.get(raw.source) ?? 0;
      if (left <= 0) continue; // cap reached for today (FR-004)
      budgets.set(raw.source, left - 1);

      const loc = parseLocation(raw.location, raw.city, raw.uf);
      const workMode = detectWorkMode(raw.workMode, raw.title, raw.location, raw.description?.slice(0, 3000));
      const remote = loc.remote || workMode === 'remote';
      const salary = parseSalary(raw.salaryMin, raw.salaryMax, raw.salaryText ?? raw.description);
      const hash = dedupeHash(raw.company, raw.title, { ...loc, remote });

      const existing = await db.job.findUnique({ where: { dedupeHash: hash } });
      let jobId: string;
      if (existing) {
        // Same posting from another board (or a repost): merge, re-open, fill gaps.
        await db.job.update({
          where: { id: existing.id },
          data: {
            lastSeenAt: now,
            description: existing.description ?? raw.description ?? null,
            applyUrl: existing.applyUrl ?? raw.applyUrl ?? null,
            salaryMin: existing.salaryMin ?? salary.min,
            salaryMax: existing.salaryMax ?? salary.max,
          },
        });
        jobId = existing.id;
        o.duplicates++;
      } else {
        const company = await db.company.upsert({ where: { name: raw.company }, create: { name: raw.company }, update: {} });
        const job = await db.job.create({
          data: {
            sourceId: sourceRows.get(raw.source)!,
            externalId: raw.externalId ?? null,
            url: raw.url,
            applyUrl: raw.applyUrl ?? null,
            companyId: company.id,
            title: raw.title,
            description: raw.description ?? null,
            location: raw.location ?? null,
            city: loc.city,
            uf: loc.uf,
            remote,
            workMode,
            seniority: detectSeniority(raw.title),
            salaryMin: salary.min,
            salaryMax: salary.max,
            salaryText: salary.text,
            postedAt: raw.postedAt && !Number.isNaN(Date.parse(raw.postedAt)) ? new Date(raw.postedAt) : null,
            dedupeHash: hash,
            firstSeenAt: now,
            lastSeenAt: now,
          },
        });
        jobId = job.id;
        o.new++;
      }
      await db.jobOrigin.create({ data: { jobId, source: raw.source, externalId: key, url: raw.url, firstSeenAt: now, lastSeenAt: now, runId } });
      touched.add(jobId);
    }
  }
  return { outcomes, jobIds: [...touched] };
}
