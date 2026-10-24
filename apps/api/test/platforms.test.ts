import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetJobs } from '@autoapply/db';
import { PlatformsService } from '../src/platforms/platforms.service.js';
import { apiError, db, fakeQueue, prisma, reset } from './helpers.js';

let queue: ReturnType<typeof fakeQueue> & { getJobs: () => Promise<never[]> };
let svc: PlatformsService;

beforeEach(async () => {
  await reset();
  await resetJobs(db);
  queue = Object.assign(fakeQueue(), { getJobs: async () => [] as never[] });
  svc = new PlatformsService(prisma, queue as never);
  process.env.SESSION_ENCRYPTION_KEY = 'a'.repeat(64);
});
afterAll(async () => {
  await db.$disconnect();
});

describe('platforms API (US1/US5)', () => {
  it('lists every platform with defaults, usage and session flags', async () => {
    const list = await svc.list();
    expect(list.map((p) => p.kind).sort()).toEqual(['ashby', 'generic', 'greenhouse', 'gupy', 'lever', 'linkedin']);
    expect(list.find((p) => p.kind === 'linkedin')).toMatchObject({ needsSession: true, needsOptIn: true, submitCap: 5, submitMax: 15, minIntervalSec: 180, usage: { submitted: 0, simulated: 0 }, paused: null });
    expect(list.find((p) => p.kind === 'lever')).toMatchObject({ needsSession: false });
  });

  it('connect: LinkedIn needs opt-in; non-session kinds 400; missing key 409; enqueues the headed login', async () => {
    expect((await apiError(svc.connect('linkedin'))).code).toBe('opt_in_required');
    expect((await apiError(svc.connect('lever'))).status).toBe(400);
    await svc.optIn();
    process.env.SESSION_ENCRYPTION_KEY = 'change-me';
    expect((await apiError(svc.connect('linkedin'))).code).toBe('no_session_key');
    process.env.SESSION_ENCRYPTION_KEY = 'a'.repeat(64);
    const v = await svc.connect('linkedin');
    expect(v.sessionStatus).toBe('connecting');
    expect(queue.added[0]).toMatchObject({ name: 'connect-session', data: { kind: 'linkedin' } });
    expect((await apiError(svc.connect('linkedin'))).code).toBe('already_connecting');
    await svc.connectDone('linkedin', true);
    expect((await db.platform.findUniqueOrThrow({ where: { kind: 'linkedin' } })).connectRequest).toBe('cancel');
  });

  it('limits above the safe maximum → 422; disconnect sends pending work back to the user', async () => {
    expect((await apiError(svc.limits('gupy', { submitCap: 41 }))).code).toBe('above_max');
    expect((await svc.limits('gupy', { submitCap: 10, minIntervalSec: 120 }))).toMatchObject({ submitCap: 10, minIntervalSec: 120 });

    await db.platform.update({ where: { kind: 'gupy' }, data: { sessionEnc: 'v1:x:y:z', sessionStatus: 'connected' } });
    const src = await db.source.create({ data: { type: 'gupy', enabled: true } });
    const job = await db.job.create({ data: { sourceId: src.id, url: 'https://acme.gupy.io/jobs/1', title: 'Dev', dedupeHash: 'h1' } });
    const app = await db.application.create({ data: { jobId: job.id, mode: 'dry_run', status: 'approved', platform: 'gupy', approvalHash: 'h', approvedAt: new Date() } });
    const v = await svc.disconnect('gupy');
    expect(v.sessionStatus).toBe('disconnected');
    expect((await db.platform.findUniqueOrThrow({ where: { kind: 'gupy' } })).sessionEnc).toBeNull();
    expect(await db.application.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ status: 'needs_input', approvalHash: null });
  });

  it('resume clears the pause and re-queues waiting work', async () => {
    await svc.list();
    await db.platform.update({ where: { kind: 'linkedin' }, data: { pauseReason: 'unusual_activity', pausedUntil: null, backoffLevel: 3 } });
    expect((await svc.get('linkedin')).paused).toMatchObject({ reason: 'unusual_activity', until: null });
    const src = await db.source.create({ data: { type: 'linkedin_mcp', enabled: true } });
    const job = await db.job.create({ data: { sourceId: src.id, url: 'https://www.linkedin.com/jobs/view/1/', title: 'Dev', dedupeHash: 'h2' } });
    await db.application.create({ data: { jobId: job.id, mode: 'dry_run', status: 'approved', platform: 'linkedin', approvalHash: 'hh' } });
    const v = await svc.resume('linkedin');
    expect(v.paused).toBeNull();
    expect(queue.added.map((a) => a.name)).toEqual(['submit']);
  });
});
