/**
 * Reply tracking eval (F7 SC-002) on the live local LLM: 30 labelled synthetic emails.
 *   pnpm exec tsx --env-file=../../.env scripts/record-replies-eval.ts [--store]
 * --store also writes an EvalRun row (suite "replies"; `fabrications` = unrelated emails stored).
 */
import { createPrismaClient } from '@autoapply/db';
import { ollamaFromEnv } from '@autoapply/llm';
import { runReplyEval } from '../test/replies-eval-lib.js';

const model = process.env.OLLAMA_CHAT_MODEL ?? 'qwen3:8b';
const t0 = Date.now();
const r = await runReplyEval(ollamaFromEnv());
for (const c of r.cases) {
  const ok = c.linkOk && c.typeOk !== false;
  console.log(`${ok ? '✓' : '✗'} ${c.id} → ${c.applicationId ?? '—'} / ${c.type ?? '—'}${c.needsReview ? ' (verificar)' : ''}${ok ? '' : ` · esperado ${c.expected.applicationId ?? '—'} / ${c.expected.type ?? '—'}`}`);
}
const passed = r.linkAccuracy >= 0.9 && r.typeAccuracy >= 0.85 && r.unrelatedStored === 0;
console.log(`link ${(r.linkAccuracy * 100).toFixed(0)}% · type ${(r.typeAccuracy * 100).toFixed(0)}% · unrelated stored ${r.unrelatedStored} · ${passed ? 'PASS' : 'FAIL'} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (process.argv.includes('--store')) {
  const db = createPrismaClient();
  await db.evalRun.create({
    data: { suite: 'replies', model, cases: r.cases.length, fabrications: r.unrelatedStored, passed, report: { linkAccuracy: r.linkAccuracy, typeAccuracy: r.typeAccuracy, cases: r.cases } as never },
  });
  await db.$disconnect();
  console.log('EvalRun stored');
}
