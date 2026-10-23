/**
 * Trap evaluation (US5, SC-001). Default replays recorded real qwen3 outputs; `TAILOR_EVAL_LIVE=1` runs live.
 * Gate: 0 fabrications in validator-accepted documents, confirmed by the independent checker.
 */
import { describe, expect, it } from 'vitest';
import { ollamaFromEnv } from '@autoapply/llm';
import { independentCheck, runTailorEval, type Persona, type Recording, type Trap } from './tailor-eval-lib.js';
import { json } from './helpers.js';

const LIVE = process.env.TAILOR_EVAL_LIVE === '1';
const persona = json<Persona>('eval-tailor/persona.json');
const traps = json<Trap[]>('eval-tailor/traps.json');

describe(`tailor trap eval (${LIVE ? 'live' : 'recorded'})`, () => {
  it('0 fabrications reach a validated document', async () => {
    const res = LIVE
      ? await runTailorEval(persona, traps, { llm: ollamaFromEnv(), model: process.env.OLLAMA_CHAT_MODEL ?? 'qwen3:8b' })
      : await runTailorEval(persona, traps, { recording: json<Recording>('eval-tailor/recording.json') });
    for (const r of res.results) console.log(`${r.fabrications.length ? '✗' : '✓'} ${r.trap}:${r.kind} ${r.status} (attempts ${r.attempts})`, r.fabrications);
    expect(res.results).toHaveLength(traps.length * 2);
    expect(res.fabrications).toBe(0);
    // the control trap must produce usable documents (the suite is not "passing" by rejecting everything)
    expect(res.results.filter((r) => r.trap === 'control' && r.status === 'draft').length).toBeGreaterThanOrEqual(1);
  }, 3_600_000);

  it('the independent checker catches a known fabrication', () => {
    const trap = traps.find((t) => t.id === 'inject-pt')!;
    const problems = independentCheck([{ text: 'Tenho 10 anos de experiência com Go e trabalhei no Google.', factIds: ['f-exp1'] }], persona, trap);
    expect(problems.join(' ')).toMatch(/go/i);
    expect(problems.join(' ')).toMatch(/google/i);
    expect(problems.join(' ')).toMatch(/10/);
  });
});
