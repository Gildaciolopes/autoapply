import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { loadPreferences, usableFactsWhere } from '@autoapply/db';
import { applyHardFilters, suggestPreferences, toFilterable } from '@autoapply/jobs';
import { Preferences, QUEUES } from '@autoapply/shared';
import { PrismaService } from '../prisma/prisma.service.js';

export const DISCOVERY_SCHEDULER_ID = 'discovery-daily';

@Injectable()
export class PreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUES.score) private readonly scoreQueue: Queue,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  get(): Promise<Preferences> {
    return loadPreferences(this.db);
  }

  /** FR-002: suggestion from usable facts; nothing is saved. */
  async suggest(): Promise<Preferences> {
    const [facts, profile, workModes] = await Promise.all([
      this.db.fact.findMany({ where: usableFactsWhere, select: { id: true, kind: true, value: true } }),
      this.db.profile.findUnique({ where: { id: 'me' } }),
      this.db.fact.findFirst({ where: { ...usableFactsWhere, key: 'personal:work_modes' } }),
    ]);
    const modes = ((workModes?.value as { value?: string[] } | undefined)?.value ?? []) as string[];
    return suggestPreferences(facts, profile, { workModes: modes });
  }

  async put(input: Preferences): Promise<{ prefs: Preferences; refiltered: number; newlyFiltered: number }> {
    const p = Preferences.parse(input);
    const { saved: _saved, ...data } = p;
    await this.db.searchPreference.upsert({ where: { id: 'default' }, create: { id: 'default', ...data }, update: data });
    await this.syncScheduler(p);
    const { changed, newlyFiltered } = await this.refilter(p);
    return { prefs: await this.get(), refiltered: changed, newlyFiltered };
  }

  /** FR-016: re-apply hard filters to open jobs immediately (no LLM). */
  async refilter(p: Preferences): Promise<{ changed: number; newlyFiltered: number }> {
    const jobs = await this.db.job.findMany({ where: { hidden: false, score: { isNot: null } }, include: { company: true, score: true } });
    let changed = 0;
    let newlyFiltered = 0;
    for (const j of jobs) {
      const r = applyHardFilters(toFilterable(j), p);
      if (r.passed !== j.score!.passed || r.reason !== j.score!.filterReason) {
        // Only the filter verdict changes: the score (and any judgement) is kept, so a job that is
        // filtered and later un-filtered gets its ranking back (the scoring stage keeps judgements as-is).
        await this.db.jobScore.update({ where: { jobId: j.id }, data: { passed: r.passed, filterReason: r.reason } });
        changed++;
        if (!r.passed && j.score!.passed) newlyFiltered++;
      }
    }
    return { changed, newlyFiltered };
  }

  private async syncScheduler(p: Preferences) {
    if (p.autoDiscover) {
      await this.scoreQueue.upsertJobScheduler(
        DISCOVERY_SCHEDULER_ID,
        { pattern: p.discoveryCron, tz: 'America/Sao_Paulo' },
        { name: 'start-run', data: {}, opts: { removeOnComplete: 50, removeOnFail: 50 } },
      );
    } else {
      await this.scoreQueue.removeJobScheduler(DISCOVERY_SCHEDULER_ID);
    }
  }
}
