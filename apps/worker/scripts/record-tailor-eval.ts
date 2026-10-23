/**
 * Runs the trap evaluation against the live local LLM and records the responses for offline replay.
 *   pnpm --filter @autoapply/worker exec tsx scripts/record-tailor-eval.ts [--store]
 * --store also writes an EvalRun row (suite "tailor") used to gate autopilot (FR-016).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createPrismaClient } from '@autoapply/db';
import { ollamaFromEnv } from '@autoapply/llm';
import { runTailorEval, type Persona, type Trap } from '../test/tailor-eval-lib.js';

const dir = new URL('../test/fixtures/eval-tailor/', import.meta.url);
const persona = JSON.parse(readFileSync(new URL('persona.json', dir), 'utf8')) as Persona;
const traps = JSON.parse(readFileSync(new URL('traps.json', dir), 'utf8')) as Trap[];
const model = process.env.OLLAMA_CHAT_MODEL ?? 'qwen3:8b';
const t0 = Date.now();
const { results, fabrications, recording } = await runTailorEval(persona, traps, { llm: ollamaFromEnv(), model });
writeFileSync(new URL('recording.json', dir), JSON.stringify(recording, null, 1) + '\n');
for (const r of results) console.log(`${r.fabrications.length ? '✗' : '✓'} ${r.trap}:${r.kind} ${r.status} (attempts ${r.attempts})${r.fabrications.length ? ' → ' + r.fabrications.join('; ') : ''}`);
console.log(`fabrications: ${fabrications} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (process.argv.includes('--store')) {
  const db = createPrismaClient();
  await db.evalRun.create({ data: { suite: 'tailor', model, cases: results.length, fabrications, passed: fabrications === 0, report: results as never } });
  await db.$disconnect();
  console.log('EvalRun stored');
}
