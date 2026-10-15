/**
 * SC-005 / SC-004 labelled eval. Default replays recorded real model outputs; `JOBS_EVAL_LIVE=1`
 * (make jobs-eval) runs bge-m3 + qwen3 live.
 */
import { describe, expect, it } from 'vitest';
import { ollamaFromEnv } from '@autoapply/llm';
import { runEval, evalFacts, type EvalJob, type EvalRecording } from './jobs-eval-lib.js';
import { json } from './helpers.js';

const LIVE = process.env.JOBS_EVAL_LIVE === '1';

describe(`jobs ranking eval (${LIVE ? 'live' : 'recorded'})`, () => {
  it('≥ 8 of the top 10 are relevant; every matched skill is backed by a fact', async () => {
    const jobs = json<EvalJob[]>('eval/jobs-30.json');
    const res = LIVE ? await runEval(jobs, { llm: ollamaFromEnv() }) : await runEval(jobs, { recording: json<EvalRecording>('eval/recording.json') });
    const top = res.ranked.slice(0, 10);
    const relevant = top.filter((j) => j.relevant).length;
    console.log(`top10 relevant ${relevant}/10; filtered ${res.filteredOut}`, top.map((j) => `${j.relevant ? '✓' : '✗'} ${j.title}`));
    expect(relevant).toBeGreaterThanOrEqual(8);
    const ids = new Set(evalFacts.map((f) => f.id));
    for (const g of Object.values(res.grounded)) for (const m of g.matched) expect(m.factIds.every((id) => ids.has(id))).toBe(true);
  }, 1_800_000);
});
