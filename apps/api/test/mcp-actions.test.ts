import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetJobs } from '@autoapply/db';
import { AssistantController } from '../src/assistant/assistant.controller.js';
import { call, db, seedReady, startMcp } from './mcp-helpers.js';
import { prisma, reset } from './helpers.js';

let mcp: Awaited<ReturnType<typeof startMcp>>;
const enable = (on = true) => db.searchPreference.updateMany({ data: { mcpApproveEnabled: on } });

beforeEach(async () => {
  await reset();
  await resetJobs(db);
  await db.searchPreference.create({ data: { id: 'default', mode: 'review', scoreThreshold: 70 } });
  mcp = await startMcp();
});
afterEach(async () => {
  await mcp.close();
});
afterAll(async () => {
  await db.$disconnect();
});

const code = (r: { structuredContent?: Record<string, unknown> }) => (r.structuredContent?.error as { code?: string } | undefined)?.code;

describe('MCP safe actions (F7 US4, FR-023..FR-026)', () => {
  it('assistant settings: approval off by default, toggled from the web', async () => {
    const ctl = new AssistantController(prisma);
    expect(await ctl.get()).toEqual({ approveEnabled: false, url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/) });
    expect((await ctl.put({ approveEnabled: true })).approveEnabled).toBe(true);
  });

  it('approval disabled by default → refused, nothing approved', async () => {
    const a = await seedReady(1);
    const c = await mcp.client();
    const r = await call(c, 'approve_applications', { ids: [a.id] });
    expect(r.isError).toBe(true);
    expect(code(r)).toBe('approve_disabled');
    expect(r.content[0]!.text).toMatch(/^approve_disabled: aprovação pelo assistente está desligada/);
    expect((await db.application.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('ready');
  });

  it('preview approves nothing; confirm approves exactly the named ready applications (F5 path)', async () => {
    await enable();
    const a = await seedReady(1);
    const b = await seedReady(2);
    const other = await seedReady(3);
    const notReady = await seedReady(4, 'needs_input');
    const c = await mcp.client();
    const p = await call(c, 'approve_applications', { ids: [a.id, b.id, notReady.id] });
    expect(p.isError).toBeFalsy();
    const preview = p.structuredContent as { previewId: string; items: { id: string; ok: boolean; reason?: string }[]; estimate: unknown };
    expect(preview.items).toEqual([
      expect.objectContaining({ id: a.id, ok: true }),
      expect.objectContaining({ id: b.id, ok: true }),
      expect.objectContaining({ id: notReady.id, ok: false, reason: 'not_ready' }),
    ]);
    expect(preview.estimate).toBeTruthy();
    expect(await db.application.count({ where: { status: 'approved' } })).toBe(0);
    expect(mcp.applyQueue.added).toHaveLength(0);

    const r = await call(c, 'confirm_approval', { previewId: preview.previewId });
    expect(r.structuredContent).toEqual({ approved: [a.id, b.id], refused: [] });
    const approved = await db.application.findMany({ where: { status: 'approved' }, select: { id: true, approvalHash: true } });
    expect(approved.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect((await db.application.findUniqueOrThrow({ where: { id: other.id } })).status).toBe('ready');
    expect(mcp.applyQueue.added.map((j) => (j.data as { applicationId: string }).applicationId).sort()).toEqual([a.id, b.id].sort());
    for (const j of mcp.applyQueue.added) expect((j.data as { approvalHash: string }).approvalHash).toBe(approved.find((x) => x.id === (j.data as { applicationId: string }).applicationId)!.approvalHash);

    // Used once.
    expect(code(await call(c, 'confirm_approval', { previewId: preview.previewId }))).toBe('preview_used');
    const ev = await db.runEvent.findFirstOrThrow({ where: { queue: 'assistant' } });
    expect(ev.data).toMatchObject({ origin: 'assistant', tool: 'confirm_approval' });
  });

  it('no filters, no "all", at most 10 explicit ids', async () => {
    await enable();
    const c = await mcp.client();
    const ids = Array.from({ length: 11 }, (_, i) => `id${i}`);
    for (const args of [{ ids }, { ids: [] }, { filter: 'ready' }, { all: true }, { ids: ['x'], filter: 'ready' }]) {
      const r = await call(c, 'approve_applications', args);
      expect(r.isError, JSON.stringify(args)).toBe(true);
    }
    expect(await db.approvalPreview.count()).toBe(0);
  });

  it('answer changed after the preview → refused as changed', async () => {
    await enable();
    const a = await seedReady(1);
    const c = await mcp.client();
    const p = (await call(c, 'approve_applications', { ids: [a.id] })).structuredContent as { previewId: string };
    await db.formAnswer.updateMany({ where: { applicationId: a.id }, data: { answer: 'Não' } });
    expect((await call(c, 'confirm_approval', { previewId: p.previewId })).structuredContent).toEqual({ approved: [], refused: [{ id: a.id, code: 'changed' }] });
  });

  it('expired preview, other session, paused', async () => {
    await enable();
    const a = await seedReady(1);
    const c1 = await mcp.client();
    const c2 = await mcp.client();
    const p = (await call(c1, 'approve_applications', { ids: [a.id] })).structuredContent as { previewId: string };
    expect(code(await call(c2, 'confirm_approval', { previewId: p.previewId }))).toBe('other_session');
    await db.approvalPreview.update({ where: { id: p.previewId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(code(await call(c1, 'confirm_approval', { previewId: p.previewId }))).toBe('preview_expired');

    // Stop always works and pauses; approval then refused.
    const stop = await call(c1, 'stop_everything');
    expect(stop.isError).toBeFalsy();
    expect((await db.searchPreference.findFirstOrThrow()).pausedAt).not.toBeNull();
    expect(code(await call(c1, 'approve_applications', { ids: [a.id] }))).toBe('paused');
    expect((await db.runEvent.findFirstOrThrow({ where: { queue: 'assistant' } })).data).toMatchObject({ origin: 'assistant', tool: 'stop_everything' });
    expect((await db.application.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('ready');
  });

  it('stop works even with approval disabled', async () => {
    const c = await mcp.client();
    expect((await call(c, 'stop_everything')).structuredContent).toMatchObject({ cancelled: expect.any(Number) });
  });
});
