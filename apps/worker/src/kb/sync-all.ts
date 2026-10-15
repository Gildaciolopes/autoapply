import type { Queue } from 'bullmq';
import { localDate } from '@autoapply/kb';
import type { SyncProfilePayload } from '@autoapply/shared';
import { importGithub } from './github-importer.js';
import { importLinkedin, type McpCaller } from './linkedin-importer.js';
import { recordOutcome } from './import-common.js';
import { runEvent, type KbDeps } from './deps.js';

type SyncAllPayload = Extract<SyncProfilePayload, { kind: 'sync_all' }>;

/**
 * sync_all (US7): runs enabled external sources sequentially; one failing source does not stop
 * the others. A scheduled run happens at most once per local day (FR-024); manual always runs.
 */
export async function syncAll(deps: KbDeps, payload: SyncAllPayload, opts: { linkedin: McpCaller; queue?: Pick<Queue, 'add'> }) {
  const { db } = deps;
  const today = localDate(deps.now?.() ?? new Date());

  if (payload.trigger === 'schedule') {
    const already = await db.syncRun.findFirst({ where: { trigger: 'schedule', localDate: today } });
    if (already) {
      await runEvent(db, 'info', `scheduled sync skipped: already ran on ${today}`);
      return { skipped: true, syncRunId: already.id };
    }
  }
  const run = payload.syncRunId
    ? await db.syncRun.findUniqueOrThrow({ where: { id: payload.syncRunId } })
    : await db.syncRun.create({ data: { trigger: payload.trigger, localDate: today } });

  const sources = await db.profileSource.findMany({ where: { origin: { in: ['github', 'linkedin'] } } });
  for (const s of sources) {
    if (!s.enabled) {
      await recordOutcome(db, run.id, s.origin as 'github' | 'linkedin', { status: 'skipped', error: 'source_disabled' });
      continue;
    }
    try {
      if (s.origin === 'github') await importGithub(deps, run.id, { queue: opts.queue, actor: 'sync' });
      if (s.origin === 'linkedin') await importLinkedin(deps, run.id, opts.linkedin, { actor: 'sync' });
    } catch (err) {
      await recordOutcome(db, run.id, s.origin as 'github' | 'linkedin', { status: 'failed', error: err instanceof Error ? err.message : String(err) });
    }
  }
  await db.syncRun.update({ where: { id: run.id }, data: { finishedAt: new Date() } });
  return { skipped: false, syncRunId: run.id };
}
