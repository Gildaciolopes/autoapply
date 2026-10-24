import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { decryptSecret, resetJobs } from '@autoapply/db';
import { GMAIL_SCOPE } from '@autoapply/jobs';
import { MailService } from '../src/mail/mail.service.js';
import { RepliesService } from '../src/replies/replies.service.js';
import { apiError, db, fakeQueue, prisma, reset } from './helpers.js';

const KEY_HEX = '07'.repeat(32);
const ENV = { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csecret', SESSION_ENCRYPTION_KEY: KEY_HEX, API_PORT: '3001', WEB_ORIGIN: 'http://localhost:3000' };

function fakeGoogle() {
  const calls: { url: string; method: string; body?: string }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body as string | undefined });
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.includes('/token')) return ok({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: GMAIL_SCOPE });
    if (url.includes('/revoke')) return ok({});
    if (url.endsWith('/profile')) return ok({ emailAddress: 'ana@example.com' });
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

let svc: MailService;
let queue: ReturnType<typeof fakeQueue>;
let g: ReturnType<typeof fakeGoogle>;
beforeEach(async () => {
  await reset();
  await resetJobs(db);
  queue = fakeQueue();
  svc = new MailService(prisma, queue as never);
  svc.env = { ...ENV };
  g = fakeGoogle();
  svc.fetchImpl = g.impl;
});
afterAll(async () => {
  await db.$disconnect();
});

const stateOf = (url: string) => new URL(url).searchParams.get('state')!;

describe('mail connection API (F7 US2, FR-006/FR-007)', () => {
  it('not configured / no key', async () => {
    svc.env = {};
    expect(await svc.view()).toMatchObject({ configured: false, status: 'disconnected' });
    expect((await apiError(svc.connectUrl())).code).toBe('not_configured');
    svc.env = { ...ENV, SESSION_ENCRYPTION_KEY: 'short' };
    expect((await apiError(svc.connectUrl())).code).toBe('no_encryption_key');
  });

  it('connect → consent → callback stores only encrypted tokens', async () => {
    const url = await svc.connectUrl();
    const u = new URL(url);
    expect(u.searchParams.get('scope')).toBe(GMAIL_SCOPE);
    expect(u.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:3001/mail/oauth/callback');
    const back = await svc.callback({ code: 'c', state: stateOf(url) });
    expect(back).toBe('http://localhost:3000/integracoes?mail=connected');
    const a = await db.mailAccount.findUniqueOrThrow({ where: { id: 'default' } });
    expect(a).toMatchObject({ status: 'connected', email: 'ana@example.com', pendingState: null });
    expect(a.tokensEnc).not.toContain('RT');
    expect(decryptSecret(a.tokensEnc!, Buffer.from(KEY_HEX, 'hex'))).toMatchObject({ refreshToken: 'RT', accessToken: 'AT' });
    expect(new URLSearchParams(g.calls[0]!.body).get('code_verifier')).toBeTruthy();
    expect(await svc.view()).toMatchObject({ configured: true, status: 'connected', email: 'ana@example.com' });
  });

  it('state mismatch, expired state, denied', async () => {
    const url = await svc.connectUrl();
    expect(await svc.callback({ code: 'c', state: 'forged' })).toContain('mail=error');
    // A failed attempt consumes the pending state.
    expect(await svc.callback({ code: 'c', state: stateOf(url) })).toContain('mail=error');
    const url2 = await svc.connectUrl(Date.now() - 11 * 60_000);
    expect(await svc.callback({ code: 'c', state: stateOf(url2) })).toContain('mail=error');
    const url3 = await svc.connectUrl();
    expect(await svc.callback({ error: 'access_denied', state: stateOf(url3) })).toContain('mail=denied');
    expect(g.calls).toHaveLength(0);
    expect((await db.mailAccount.findUniqueOrThrow({ where: { id: 'default' } })).status).toBe('disconnected');
  });

  it('disconnect revokes and deletes tokens; check needs a connection', async () => {
    expect((await apiError(svc.check())).code).toBe('not_connected');
    const url = await svc.connectUrl();
    await svc.callback({ code: 'c', state: stateOf(url) });
    expect(await svc.check()).toEqual({ queued: true });
    expect(queue.added[0]).toMatchObject({ name: 'mail-check' });
    const v = await svc.disconnect();
    expect(v).toMatchObject({ status: 'disconnected', email: null });
    expect(g.calls.some((c) => c.url.includes('/revoke'))).toBe(true);
    expect((await db.mailAccount.findUniqueOrThrow({ where: { id: 'default' } })).tokensEnc).toBeNull();
  });
});

describe('replies API (F7 US2, FR-013..FR-015)', () => {
  async function app(status: 'submitted' | 'ready' = 'submitted', company = 'Nubank') {
    const src = (await db.source.findFirst()) ?? (await db.source.create({ data: { type: 'gupy', enabled: true } }));
    const co = await db.company.upsert({ where: { name: company }, update: {}, create: { name: company } });
    const job = await db.job.create({ data: { sourceId: src.id, companyId: co.id, url: `https://x.local/${Math.random()}`, title: 'Backend', dedupeHash: String(Math.random()) } });
    return db.application.create({ data: { jobId: job.id, mode: 'review', status, submittedAt: status === 'submitted' ? new Date('2026-10-01T00:00:00Z') : null } });
  }

  it('manual reply, reclassify, relink, delete recompute outcomes', async () => {
    const svc = new RepliesService(prisma);
    const a = await app();
    const b = await app('submitted', 'iFood');
    const r = await svc.manual(a.id, { type: 'interview', receivedAt: '2026-10-05T10:00:00-03:00', note: 'ligaram' });
    expect(r).toMatchObject({ origin: 'manual', type: 'interview', company: 'Nubank', note: 'ligaram', userEdited: true });
    expect((await db.application.findUniqueOrThrow({ where: { id: a.id } })).outcome).toBe('interview');

    const email = await db.reply.create({ data: { applicationId: a.id, origin: 'email', messageId: 'm1', type: 'other', needsReview: true, receivedAt: new Date('2026-10-06T00:00:00Z') } });
    expect((await svc.list({ review: true })).map((x) => x.id)).toEqual([email.id]);
    expect(await svc.patch(email.id, { type: 'rejection' })).toMatchObject({ type: 'rejection', needsReview: false, userEdited: true });
    expect((await db.application.findUniqueOrThrow({ where: { id: a.id } })).outcome).toBe('declined');

    await svc.patch(email.id, { applicationId: b.id });
    expect((await db.application.findUniqueOrThrow({ where: { id: a.id } })).outcome).toBe('interview');
    expect((await db.application.findUniqueOrThrow({ where: { id: b.id } })).outcome).toBe('declined');

    await svc.remove(email.id);
    expect((await db.application.findUniqueOrThrow({ where: { id: b.id } })).outcome).toBe('none');
    expect(await db.processedMail.findUnique({ where: { messageId: 'm1' } })).not.toBeNull(); // never re-added
  });

  it('refuses replies on applications that were not submitted', async () => {
    const svc = new RepliesService(prisma);
    const ready = await app('ready');
    expect((await apiError(svc.manual(ready.id, { type: 'other', receivedAt: '2026-10-05T10:00:00Z' }))).code).toBe('not_submitted');
    const a = await app();
    const r = await db.reply.create({ data: { applicationId: a.id, origin: 'email', type: 'other', receivedAt: new Date() } });
    expect((await apiError(svc.patch(r.id, { applicationId: ready.id }))).code).toBe('not_submitted');
  });
});
