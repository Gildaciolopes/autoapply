import type { ChatMessageLike } from '@autoapply/jobs';
import type { FormField, LlmFieldAnswers, NeedsReason, NeedsReasonCode, PlannedAnswer } from '@autoapply/shared';
import { classifyField } from './classify.js';
import type { AnswerContext } from './context.js';
import { buildFieldMessages, buildFieldRetryMessage, checkLlmAnswers, llmFieldId } from './llm.js';
import { normalizeQuestion, pickMemory, type MemoryCandidate } from './memory.js';
import { answerComputed, answerDemographic, answerEvidenceYesNo, answerLanguageLevel } from './rules.js';
import { answerStandard, missing } from './standard.js';

/** Value markers the engine replaces with the real attachment / letter text. */
export const ATTACH_RESUME = '__resume__';
export const ATTACH_LETTER = '__cover_letter__';

export const REASON_LABELS: Record<NeedsReasonCode, string> = {
  captcha: 'captcha detectado (não resolvemos captcha)',
  bot_protection: 'proteção anti-robô na página',
  login_required: 'login necessário',
  low_confidence: 'confiança baixa',
  no_evidence: 'sem fato que comprove',
  missing_fact: 'dado não cadastrado',
  validation_failed: 'resposta reprovada pelo validador',
  tailoring_needs_review: 'currículo adaptado precisa de revisão',
  cover_letter_required: 'carta de apresentação necessária',
  attachment_rejected: 'anexo recusado pelo formulário',
  daily_cap: 'limite diário atingido',
  cancelled: 'cancelado',
  job_closed: 'vaga encerrada',
};

export interface PlanOptions {
  threshold: number;
  /** Approved memories for the given field (exact + nearest), see worker `memoryCandidates`. */
  memory?: (field: FormField) => MemoryCandidate[];
  /** One batched call; omitted = deterministic stages only. */
  llm?: (messages: ChatMessageLike[]) => Promise<LlmFieldAnswers>;
  /** Whether a cover letter is available to attach/paste. */
  hasLetter?: boolean;
}

export interface PlanResult {
  answers: PlannedAnswer[];
  reasons: NeedsReason[];
  usedFactIds: string[];
  llmCalls: number;
}

const attach = (field: FormField, marker: string): PlannedAnswer => ({
  fieldKey: field.key,
  value: marker,
  source: 'anexo',
  confidence: 1,
  evidence: [],
  blocking: false,
  findings: [],
});

/** Deterministic stages in order (research R4 1–4, 6). null → needs the LLM. */
function deterministic(field: FormField, ctx: AnswerContext, opts: PlanOptions): PlannedAnswer | null {
  const cls = classifyField(field);
  if (cls.kind === 'standard' && (cls.std === 'resume' || cls.std === 'cover_letter')) {
    if (cls.std === 'resume') return field.type === 'file' ? attach(field, ATTACH_RESUME) : null;
    if (!opts.hasLetter) return missing(field, 'cover_letter_required');
    return field.type === 'file' || field.type === 'textarea' || field.type === 'text' ? attach(field, ATTACH_LETTER) : null;
  }
  if (field.type === 'file') return missing(field); // unknown upload (portfolio PDF, transcript…): never invent
  if (cls.kind === 'demographic') return answerDemographic(field);
  if (cls.kind === 'consent') {
    // Consent is the user's decision: only an approved memory may check it.
    return (opts.memory && pickMemory(field, opts.memory(field))) ?? missing(field, 'low_confidence');
  }
  if (cls.kind === 'standard') {
    const a = answerStandard(cls.std, field, ctx);
    if (a) return a;
  }
  const mem = opts.memory ? pickMemory(field, opts.memory(field)) : null;
  if (mem) return mem;
  return answerComputed(field, ctx) ?? answerLanguageLevel(field, ctx) ?? answerEvidenceYesNo(field, ctx);
}

/**
 * Answer pipeline (research R4): demographic → standard → memory → computed → evidence yes/no →
 * one batched LLM call (+ one retry for fixable failures). Unanswered required fields block the
 * application with a reason; optional ones are left empty.
 */
export async function planAnswers(fields: FormField[], ctx: AnswerContext, opts: PlanOptions): Promise<PlanResult> {
  const byKey = new Map<string, PlannedAnswer>();
  const pending: FormField[] = [];
  const seen = new Map<string, string>(); // normalized label|type → first field key
  const dupes: [FormField, string][] = [];

  for (const field of fields) {
    const sig = `${normalizeQuestion(field.label)}|${field.type}`;
    const first = seen.get(sig);
    if (first && field.label.trim()) {
      dupes.push([field, first]);
      continue;
    }
    seen.set(sig, field.key);
    const a = deterministic(field, ctx, opts);
    if (a) byKey.set(field.key, a);
    else pending.push(field);
  }

  let llmCalls = 0;
  if (pending.length && opts.llm) {
    const messages = buildFieldMessages(pending, ctx);
    let raw = await opts.llm(messages);
    llmCalls++;
    let checked = checkLlmAnswers(raw, pending, ctx, opts.threshold);
    const failed = checked.map((c, i) => ({ c, i })).filter((x) => x.c.retry);
    if (failed.length) {
      raw = await opts.llm([...messages, { role: 'assistant', content: JSON.stringify(raw) }, buildFieldRetryMessage(failed.map((x) => ({ fieldId: llmFieldId(x.i), findings: x.c.answer.findings })))]);
      llmCalls++;
      const second = checkLlmAnswers(raw, pending, ctx, opts.threshold);
      checked = checked.map((c, i) => (c.retry ? second[i]! : c));
    }
    checked.forEach((c, i) => byKey.set(pending[i]!.key, c.answer));
  } else {
    for (const f of pending) byKey.set(f.key, { ...missing(f, 'no_evidence'), source: 'modelo' });
  }

  for (const [field, firstKey] of dupes) {
    const a = byKey.get(firstKey)!;
    byKey.set(field.key, { ...a, fieldKey: field.key });
  }

  const answers: PlannedAnswer[] = [];
  const reasons: NeedsReason[] = [];
  for (const field of fields) {
    let a = byKey.get(field.key)!;
    const empty = a.value === null || (Array.isArray(a.value) && a.value.length === 0);
    if (empty) {
      a = { ...a, value: null, blocking: field.required, reason: a.reason ?? 'low_confidence' };
      if (field.required) reasons.push({ code: a.reason!, fieldKey: field.key, message: `"${field.label}": ${REASON_LABELS[a.reason!]}` });
    } else if (a.confidence < opts.threshold && a.source !== 'anexo') {
      a = { ...a, value: null, blocking: field.required, reason: 'low_confidence' };
      if (field.required) reasons.push({ code: 'low_confidence', fieldKey: field.key, message: `"${field.label}": ${REASON_LABELS.low_confidence}` });
    } else {
      a = { ...a, blocking: false, reason: undefined };
    }
    answers.push(a);
  }
  const usedFactIds = [...new Set(answers.filter((a) => a.value !== null).flatMap((a) => a.evidence))].filter((id) => !id.startsWith('profile:'));
  return { answers, reasons, usedFactIds, llmCalls };
}
