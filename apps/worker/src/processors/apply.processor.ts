import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { chromium, type Browser } from 'playwright';
import { ApplyPayload, QUEUES, SessionJobPayload, SubmitPayload } from '@autoapply/shared';
import type { KbDeps } from '../kb/deps.js';
import { applicationPlatform, gateReason, platformGate } from '../apply/gate.js';
import { runApply } from '../apply/run.js';
import { connectSession, testSession } from '../apply/sessions.js';
import { runSubmit } from '../apply/submit.js';
import { KB_DEPS } from './sync-profile.processor.js';

export const APPLY_JOB_OPTS = { attempts: 2, backoff: { type: 'exponential' as const, delay: 30_000 }, removeOnComplete: 200, removeOnFail: 200 };

/** F4 dry-run simulations, one at a time (constitution §III), one shared headless Chromium. */
@Processor(QUEUES.apply, { concurrency: 1 })
export class ApplyProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(ApplyProcessor.name);
  private browser?: Promise<Browser>;

  constructor(
    @Inject(KB_DEPS) private readonly deps: KbDeps,
    @InjectQueue(QUEUES.apply) private readonly queue: Queue,
  ) {
    super();
  }

  private getBrowser(): Promise<Browser> {
    this.browser ??= chromium.launch({ headless: true }).then((b) => {
      b.on('disconnected', () => (this.browser = undefined));
      return b;
    });
    return this.browser;
  }

  async onModuleDestroy() {
    const b = this.browser;
    this.browser = undefined;
    if (b) await (await b).close();
  }

  /** FR-012: re-add the job for later; the application shows why it waits. Manual pause = no re-add. */
  private async gated(name: string, payload: object, applicationId: string, kind: Parameters<typeof gateReason>[0], gate: Exclude<Awaited<ReturnType<typeof platformGate>>, { ok: true }>) {
    const p = await this.deps.db.platform.findUniqueOrThrow({ where: { kind } });
    const reason = gateReason(kind, gate, p.submitCap);
    await this.deps.db.application.update({ where: { id: applicationId }, data: { needsReasons: [reason] as never, needsReason: reason.message } });
    if (gate.delayMs !== null) {
      await this.queue.add(name, payload, { ...APPLY_JOB_OPTS, ...(name === 'submit' ? { attempts: 1 } : {}), delay: Math.max(1000, gate.delayMs), jobId: `${name}-${applicationId}-${Date.now()}` });
    }
    this.logger.log(`${name} ${applicationId}: ${gate.reason}, delay ${gate.delayMs === null ? 'manual' : Math.round(gate.delayMs / 1000) + 's'}`);
    return { gated: gate.reason, delayMs: gate.delayMs };
  }

  async process(job: Job): Promise<unknown> {
    const browser = () => this.getBrowser();
    switch (job.name) {
      case 'connect-session': {
        const { kind } = SessionJobPayload.parse(job.data);
        // The user logs in by hand in this visible window; nothing is typed by the system.
        return { status: await connectSession(this.deps, kind, { launch: () => chromium.launch({ headless: false }) }) };
      }
      case 'test-session': {
        const { kind } = SessionJobPayload.parse(job.data);
        return { valid: await testSession({ ...this.deps, browser }, kind) };
      }
      case 'submit':
      case 'submit-assisted': {
        const payload = SubmitPayload.parse(job.data);
        const app = await this.deps.db.application.findUnique({ where: { id: payload.applicationId }, select: { status: true } });
        if (!app || app.status !== 'approved') return { noop: true };
        const kind = await applicationPlatform(this.deps.db, payload.applicationId);
        const gate = await platformGate(this.deps.db, kind, 'submit', new Date(), payload.applicationId);
        if (!gate.ok) return this.gated(job.name, payload, payload.applicationId, kind, gate);
        const assisted = job.name === 'submit-assisted';
        const res = await runSubmit({ ...this.deps, browser, headedBrowser: () => chromium.launch({ headless: false }) }, payload, { assisted });
        if (res.status === 'assisted_required') {
          await this.queue.add('submit-assisted', payload, { attempts: 1, removeOnComplete: 200, removeOnFail: 200, jobId: `submit-assisted-${payload.applicationId}-${Date.now()}` });
        }
        this.logger.log(`${job.name} ${payload.applicationId}: ${res.status}`);
        return res;
      }
      default: {
        const payload = ApplyPayload.parse(job.data);
        const app = await this.deps.db.application.findUnique({ where: { id: payload.applicationId }, select: { status: true } });
        if (!app || app.status === 'skipped') return { skipped: true };
        const kind = await applicationPlatform(this.deps.db, payload.applicationId);
        const gate = await platformGate(this.deps.db, kind, 'simulate', new Date(), payload.applicationId);
        if (!gate.ok) return this.gated('apply', payload, payload.applicationId, kind, gate);
        const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        const res = await runApply({ ...this.deps, browser }, payload, { final });
        this.logger.log(`apply ${payload.applicationId}: ${res.status} ${res.reasons.map((r) => r.code).join(',')}`);
        return res;
      }
    }
  }
}
