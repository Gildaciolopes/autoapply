import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { applyMerge, loadFactLikes, usableFactsWhere } from '@autoapply/db';
import { mergeCandidates, type Candidate } from '@autoapply/kb';
import { ConflictsService } from '../src/kb/conflicts.service.js';
import { apiError, db, prisma, reset } from './helpers.js';

const svc = new ConflictsService(prisma);
const start = { year: 2021, month: 3, precision: 'month' as const };
const exp = (title: string, company = 'Xeno') => ({ company, title, start, end: 'present', highlights: [] });
const cand = (value: unknown, origin: 'resume' | 'linkedin', key = 'experience:xeno:2021', ref = `${origin}:x`): Candidate => ({
  kind: 'experience',
  key,
  value,
  source: { origin, ref, rawValue: value },
});

async function seedConflict() {
  await applyMerge(db, mergeCandidates([], [cand(exp('Senior Engineer'), 'resume')]), { actor: 'user', verify: true });
  const r = await applyMerge(db, mergeCandidates(await loadFactLikes(db), [cand(exp('Tech Lead'), 'linkedin')]), { actor: 'import', verify: false });
  return r.conflicts[0]!;
}

beforeEach(reset);
afterAll(() => db.$disconnect());

describe('conflicts (US6)', () => {
  it('open conflict makes the fact unusable outside dry-run (FR-020)', async () => {
    await seedConflict();
    expect(await db.fact.count({ where: usableFactsWhere })).toBe(0);
    const [c] = await svc.list();
    expect(c!.candidates.map((x) => x.origin)).toEqual(['resume', 'linkedin']);
  });

  it('choose → value set, verified, conflict resolved, rejected value in history', async () => {
    const id = await seedConflict();
    await svc.resolve(id, { strategy: 'choose', chosenIndex: 1 });
    const f = await db.fact.findFirstOrThrow({ include: { revisions: true, sources: true } });
    expect((f.value as { title: string }).title).toBe('Tech Lead');
    expect(f).toMatchObject({ verifiedByUser: true, hasOpenConflict: false });
    expect(f.sources.map((s) => s.origin).sort()).toEqual(['linkedin', 'resume']);
    const rev = f.revisions.find((r) => r.action === 'conflict_resolved')!;
    expect((rev.before as { title: string }).title).toBe('Senior Engineer');
    expect(await db.fact.count({ where: usableFactsWhere })).toBe(1);
    expect(await apiError(svc.resolve(id, { strategy: 'choose', chosenIndex: 0 }))).toMatchObject({ status: 409 });
  });

  it('edit → custom value', async () => {
    const id = await seedConflict();
    await svc.resolve(id, { strategy: 'edit', value: exp('Staff Engineer') });
    expect(((await db.fact.findFirstOrThrow()).value as { title: string }).title).toBe('Staff Engineer');
  });

  it('split → two distinct verified facts', async () => {
    const id = await seedConflict();
    const { factIds } = await svc.resolve(id, { strategy: 'split' });
    expect(factIds).toHaveLength(2);
    const keys = (await db.fact.findMany({ orderBy: { key: 'asc' } })).map((f) => [f.key, f.verifiedByUser]);
    expect(keys).toEqual([
      ['experience:xeno:2021', true],
      ['experience:xeno:2021:2', true],
    ]);
  });

  it('possible duplicate → merge moves sources and archives the new fact', async () => {
    await applyMerge(db, mergeCandidates([], [cand(exp('Dev', 'Itaú'), 'resume', 'experience:itau:2021')]), { actor: 'user', verify: true });
    await applyMerge(db, mergeCandidates(await loadFactLikes(db), [cand(exp('Dev', 'Itau Unibanco S.A.'), 'linkedin', 'experience:itau-unibanco:2021')]), {
      actor: 'import',
      verify: false,
    });
    const [c] = await svc.list();
    expect(c!.type).toBe('possible_duplicate');
    expect(await apiError(svc.resolve(c!.id, { strategy: 'choose', chosenIndex: 0 }))).toMatchObject({ status: 400 });
    await svc.resolve(c!.id, { strategy: 'merge' });
    const facts = await db.fact.findMany({ include: { sources: true } });
    const kept = facts.find((f) => f.key === 'experience:itau:2021')!;
    expect(kept.sources.map((s) => s.origin).sort()).toEqual(['linkedin', 'resume']);
    expect(facts.find((f) => f.key === 'experience:itau-unibanco:2021')!.status).toBe('archived');
  });

  it('repeated import of the same differing value does not stack conflicts', async () => {
    await seedConflict();
    await applyMerge(db, mergeCandidates(await loadFactLikes(db), [cand(exp('Tech Lead'), 'linkedin')]), { actor: 'sync', verify: false });
    expect(await db.factConflict.count()).toBe(1);
  });
});
