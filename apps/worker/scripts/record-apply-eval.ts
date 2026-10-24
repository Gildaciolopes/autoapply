/**
 * Answer trap evaluation against the live local LLM; records responses for offline replay.
 *   pnpm exec tsx --env-file=../../.env scripts/record-apply-eval.ts [--store]
 * --store also writes an EvalRun row (suite "apply-answers").
 */
import { writeFileSync } from 'node:fs';
import { createPrismaClient } from '@autoapply/db';
import { ollamaFromEnv } from '@autoapply/llm';
import { runAnswerEval } from '../test/apply-eval-lib.js';

const model = process.env.OLLAMA_CHAT_MODEL ?? 'qwen3:8b';
const t0 = Date.now();
const { results, fabrications, recording, llmCalls } = await runAnswerEval({ llm: ollamaFromEnv(), model });
writeFileSync(new URL('../test/fixtures/eval-apply/recording.json', import.meta.url), JSON.stringify(recording, null, 1) + '\n');
for (const r of results) {
  const v = r.value === null ? '—' : JSON.stringify(r.value).slice(0, 90);
  console.log(`${r.fabrications.length ? '✗' : '✓'} ${r.question.slice(0, 60)} → ${v} [${r.source}${r.blocking ? ', bloqueia' : ''}]${r.fabrications.length ? ' → ' + r.fabrications.join('; ') : ''}`);
}
console.log(`fabrications: ${fabrications} · llm calls ${llmCalls} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (process.argv.includes('--store')) {
  const db = createPrismaClient();
  await db.evalRun.create({ data: { suite: 'apply-answers', model, cases: results.length, fabrications, passed: fabrications === 0, report: results as never } });
  await db.$disconnect();
  console.log('EvalRun stored');
}
