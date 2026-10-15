import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PersonalFacts } from '@autoapply/shared';
import { FactsService } from '../src/kb/facts.service.js';
import { db, prisma, reset } from './helpers.js';

const svc = new FactsService(prisma);
beforeEach(reset);
afterAll(() => db.$disconnect());

describe('personal facts (US2)', () => {
  it('salary only → other fields not_provided, never yes/no; all verified user facts', async () => {
    const out = await svc.putPersonal(PersonalFacts.parse({ salaryExpectation: { amount: 15000, currency: 'BRL', contract: 'clt', period: 'month' } }));
    expect(out.pcd).toBe('not_provided');
    expect(out.relocate).toBe('not_provided');
    expect(out.workAuthorization.brazil).toBe('not_provided');
    const facts = await db.fact.findMany({ where: { kind: 'personal' }, include: { sources: true } });
    expect(facts.length).toBe(Object.keys(PersonalFacts.shape).length);
    expect(facts.every((f) => f.verifiedByUser && f.sources[0]!.origin === 'user' && f.sources[0]!.ref === 'user:form')).toBe(true);
    expect((await svc.getPersonal()).salaryExpectation).toEqual({ amount: 15000, currency: 'BRL', contract: 'clt', period: 'month' });
  });

  it('edit keeps previous value in history', async () => {
    await svc.putPersonal(PersonalFacts.parse({ noticePeriodDays: 30 }));
    await svc.putPersonal(PersonalFacts.parse({ noticePeriodDays: 15 }));
    const f = await db.fact.findFirstOrThrow({ where: { key: 'personal:notice_period_days' }, include: { revisions: true } });
    expect((f.value as { value: number }).value).toBe(15);
    const edit = f.revisions.find((r) => r.action === 'edited')!;
    expect((edit.before as { value: number }).value).toBe(30);
    // unchanged fields did not get edit revisions
    const pcd = await db.fact.findFirstOrThrow({ where: { key: 'personal:pcd' }, include: { revisions: true } });
    expect(pcd.revisions.map((r) => r.action)).toEqual(['created']);
  });
});
