import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runAnswerEval } from './apply-eval-lib.js';

const recording = JSON.parse(readFileSync(new URL('./fixtures/eval-apply/recording.json', import.meta.url), 'utf8'));

describe('answer trap eval (SC-003)', () => {
  it('replay of the recorded live run: 0 fabrications', async () => {
    const r = await runAnswerEval({ recording });
    expect(r.results.filter((x) => x.fabrications.length)).toEqual([]);
    expect(r.fabrications).toBe(0);
  });

  it('fabricating model answers never reach the form (validator), so the checker sees none', async () => {
    const lie = {
      answers: Array.from({ length: 20 }, (_, i) => ({
        fieldId: `f${i + 1}`,
        answer: 'Liderei 12 pessoas usando Kafka e Kubernetes na Nubank.',
        optionIndex: 0,
        factIds: ['f-exp1'],
        confidence: 0.99,
      })),
    };
    const r = await runAnswerEval({ recording: { form: [lie, lie] } });
    expect(r.fabrications).toBe(0);
    expect(r.results.filter((x) => x.source === 'modelo' && x.value !== null)).toEqual([]);
  });
});
