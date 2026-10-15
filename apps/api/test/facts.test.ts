import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FactsService } from '../src/kb/facts.service.js';
import { apiError, db, prisma, reset } from './helpers.js';

const svc = new FactsService(prisma);
beforeEach(reset);
afterAll(() => db.$disconnect());

describe('facts', () => {
  it('create user fact, filter, patch value re-keys, history kept', async () => {
    const f = await svc.create('skill', { name: 'Postgres' });
    expect(f).toMatchObject({ key: 'skill:postgresql', verifiedByUser: true });
    expect(await apiError(svc.create('skill', { name: 'PostgreSQL' }))).toMatchObject({ status: 409, code: 'key_exists' });
    const renamed = await svc.patch(f.id, { value: { name: 'Python' } });
    expect(renamed.key).toBe('skill:python');
    const detail = await svc.get(f.id);
    expect(detail.revisions.map((r) => r.action)).toEqual(['edited', 'created']);
    expect(await svc.list({ status: 'active', origin: 'user' })).toHaveLength(1);
    expect(await svc.list({ status: 'active', q: 'python' })).toHaveLength(1);
    expect(await apiError(svc.patch(f.id, { value: { nope: 1 } }))).toMatchObject({ status: 400, code: 'invalid_value' });
  });

  it('archive never deletes; restore brings it back (FR-004)', async () => {
    const f = await svc.create('skill', { name: 'Go' });
    expect(await svc.bulk([f.id], 'archive')).toEqual({ updated: 1 });
    expect(await db.fact.findUnique({ where: { id: f.id } })).toMatchObject({ status: 'archived' });
    expect(await svc.list({ status: 'active' })).toHaveLength(0);
    expect(await svc.list({ status: 'archived' })).toHaveLength(1);
    await svc.bulk([f.id], 'restore');
    const d = await svc.get(f.id);
    expect(d.status).toBe('active');
    expect(d.revisions.map((r) => r.action)).toEqual(['restored', 'archived', 'created']);
  });

  it('bulk verify/unverify', async () => {
    const a = await svc.create('skill', { name: 'React' });
    await svc.bulk([a.id], 'unverify');
    expect((await svc.get(a.id)).verifiedByUser).toBe(false);
    await svc.bulk([a.id], 'verify');
    expect((await svc.get(a.id)).verifiedByUser).toBe(true);
  });
});
