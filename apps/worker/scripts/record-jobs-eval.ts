/**
 * Records real bge-m3 vectors + qwen3 judgements for the labelled jobs eval (SC-005).
 *   pnpm --filter @autoapply/worker exec tsx scripts/record-jobs-eval.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { ollamaFromEnv } from '@autoapply/llm';
import { runEval, type EvalJob } from '../test/jobs-eval-lib.js';

const dir = new URL('../test/fixtures/eval/', import.meta.url);
const jobs = JSON.parse(readFileSync(new URL('jobs-30.json', dir), 'utf8')) as EvalJob[];
const t0 = Date.now();
const { recording, ranked } = await runEval(jobs, { llm: ollamaFromEnv() });
writeFileSync(new URL('recording.json', dir), JSON.stringify(recording) + '\n');
const top = ranked.slice(0, 10);
console.log(`recorded in ${((Date.now() - t0) / 1000).toFixed(0)}s; top10 relevant: ${top.filter((j) => j.relevant).length}/10`);
console.log(top.map((j) => `${j.relevant ? '✓' : '✗'} ${j.title}`).join('\n'));
