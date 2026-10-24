import { describe, expect, it } from 'vitest';
import { runReplyEval } from './replies-eval-lib.js';

describe('reply eval set, deterministic part (F7 SC-002)', () => {
  it('links ≥ 90% to the right application, stores 0 unrelated emails; hints alone already classify most', async () => {
    const r = await runReplyEval(null);
    expect(r.cases).toHaveLength(30);
    const wrong = r.cases.filter((c) => !c.linkOk).map((c) => `${c.id}→${c.applicationId}`);
    expect(r.linkAccuracy, wrong.join(', ')).toBeGreaterThanOrEqual(0.9);
    expect(r.unrelatedStored).toBe(0);
    expect(r.typeAccuracy).toBeGreaterThanOrEqual(0.7);
  });
});
