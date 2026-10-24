import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { FormField, LlmFieldAnswers } from '@autoapply/shared';
import { planAnswers } from '../src/answer.js';
import { llmFieldId } from '../src/llm.js';
import { anaContext } from './ctx.js';

const trap = JSON.parse(readFileSync(new URL('./fixtures/trap-form.json', import.meta.url), 'utf8'));
const fields: FormField[] = trap.fields.map((f: Record<string, unknown>) => FormField.parse(f));
const expects: Record<string, { value?: string; notValue?: string; blocking?: boolean; noFabrication?: boolean }> = Object.fromEntries(
  trap.fields.map((f: { key: string; expect: unknown }) => [f.key, f.expect]),
);

/** Maps the fixture's symbolic ids (LEAD, WHY…) to the positional ids of the fields sent to the LLM. */
function adversarial(messages: { content: string }[]): LlmFieldAnswers {
  const user = messages[1]!.content;
  const ids = [...user.matchAll(/<form_field id="(f\d+)"[^>]*>\n([^\n]+)/g)].map((m) => ({ id: m[1]!, label: m[2]! }));
  const sym: Record<string, string> = { LEAD: 'liderou', WHY: 'Por que', INJECT: 'mestrado', KAFKA: 'Kafka', CPF: 'CPF' };
  return LlmFieldAnswers.parse({
    answers: trap.adversarialLlm.answers
      .map((a: { fieldId: string }) => ({ ...a, fieldId: ids.find((x) => x.label.includes(sym[a.fieldId]!))?.id }))
      .filter((a: { fieldId?: string }) => a.fieldId),
  });
}

describe('planAnswers on the trap form (SC-003)', () => {
  it('no fabricated answer; every trap is the lowest honest option or blocking', async () => {
    const llm = vi.fn(async (m: { content: string }[]) => adversarial(m));
    const res = await planAnswers(fields, anaContext(), { threshold: 0.7, llm, hasLetter: false });
    const by = new Map(res.answers.map((a) => [a.fieldKey, a]));
    for (const [key, exp] of Object.entries(expects)) {
      const a = by.get(key)!;
      if (exp.value !== undefined) expect(a.value, key).toBe(exp.value);
      if (exp.notValue !== undefined) expect(a.value, key).not.toBe(exp.notValue);
      if (exp.blocking) expect(a.blocking, key).toBe(true);
      if (exp.noFabrication) expect(a.value, key).toBeNull();
    }
    // deterministic stages never call the LLM for them; the LLM got only the 5 tail fields, retried once
    expect(llm).toHaveBeenCalledTimes(2);
    const sent = llm.mock.calls[0]![0][1]!.content;
    expect(sent).not.toContain('Gênero');
    expect(sent).not.toContain('Kubernetes</');
    expect(res.reasons.map((r) => r.fieldKey)).toEqual(expect.arrayContaining(['#lead', '#why', '#inject', '#cpf']));
    expect(res.reasons.find((r) => r.fieldKey === '#kafka')).toBeUndefined(); // optional → left empty
  });

  it('valid cited free text passes the validator', async () => {
    const f = [FormField.parse({ key: '#why', type: 'textarea', label: 'Por que esta vaga?', required: true })];
    const llm = async () =>
      LlmFieldAnswers.parse({ answers: [{ fieldId: llmFieldId(0), answer: 'Migrei a API de pagamentos de Express para NestJS, reduzindo a latência p95 em 40%.', factIds: ['f-exp1'], confidence: 0.8 }] });
    const res = await planAnswers(f, anaContext(), { threshold: 0.7, llm });
    expect(res.answers[0]).toMatchObject({ source: 'modelo', evidence: ['f-exp1'], blocking: false, confidence: 0.8 });
    expect(res.reasons).toEqual([]);
  });

  it('duplicate questions across steps share one answer; files map to attachments', async () => {
    const f = [
      FormField.parse({ key: '#a', type: 'email', label: 'Email', required: true }),
      FormField.parse({ key: '#b', type: 'email', label: 'Email', required: true, step: 1 }),
      FormField.parse({ key: '#cv', type: 'file', label: 'Resume/CV', required: true }),
      FormField.parse({ key: '#cl', type: 'file', label: 'Cover Letter', required: true }),
    ];
    const res = await planAnswers(f, anaContext(), { threshold: 0.7 });
    expect(res.answers.map((a) => a.value)).toEqual(['ana.souza@example.com', 'ana.souza@example.com', '__resume__', null]);
    expect(res.reasons).toEqual([expect.objectContaining({ code: 'cover_letter_required', fieldKey: '#cl' })]);
  });
});
