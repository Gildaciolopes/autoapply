import { describe, expect, it } from 'vitest';
import { factsToPersonal, personalToCandidates } from '../src/personal.js';

describe('personal facts', () => {
  it('stores blank sensitive fields as not_provided, never yes/no', () => {
    const c = personalToCandidates({ salaryExpectation: { amount: 15000, currency: 'BRL', contract: 'clt', period: 'month' } } as never);
    const pcd = c.find((x) => x.key === 'personal:pcd')!;
    expect(pcd.value).toEqual({ field: 'pcd', value: 'not_provided' });
    const auth = c.find((x) => x.key === 'personal:work_authorization')!;
    expect(auth.value).toEqual({ field: 'workAuthorization', value: { brazil: 'not_provided', others: [] } });
  });
  it('round-trips', () => {
    const c = personalToCandidates({ pcd: 'no', noticePeriodDays: 30 } as never);
    const p = factsToPersonal(c.map((x) => ({ key: x.key, value: x.value })));
    expect(p.pcd).toBe('no');
    expect(p.noticePeriodDays).toBe(30);
    expect(p.relocate).toBe('not_provided');
  });
});
