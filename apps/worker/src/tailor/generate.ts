import type { ChatMessageLike } from '@autoapply/jobs';
import { LlmSentences, type TailorSentence, type ValidationFinding, type ValidationReport } from '@autoapply/shared';
import { buildRetryMessage, inferLetterRoles, stripCitationMarkers, substitutePlaceholders, validateSentences, wordCount, type ValidationContext } from '@autoapply/tailor';
import type { KbDeps } from '../kb/deps.js';

export interface GenerateOptions {
  maxSentences: number;
  maxWords?: number;
  /** Cover letter: infer greeting/body/closing roles the model omitted. */
  letter?: boolean;
  now?: Date;
}

export interface GenerateResult {
  sentences: TailorSentence[];
  report: ValidationReport;
  status: 'draft' | 'needs_review';
}

function check(raw: LlmSentences, ctx: ValidationContext, opts: GenerateOptions) {
  let base: TailorSentence[] = raw.sentences.slice(0, opts.maxSentences).map((s) => ({ text: stripCitationMarkers(s.text, [...s.factIds, ...ctx.usableFacts.map((f) => f.id)]), factIds: s.factIds, role: s.role }));
  if (opts.letter) base = inferLetterRoles(base, ctx.candidateName);
  const { sentences, findings } = substitutePlaceholders(base, ctx.usableFacts, opts.now);
  const report = validateSentences(sentences, ctx);
  const extra: ValidationFinding[] = [...findings];
  if (opts.maxWords) {
    const words = wordCount(sentences.map((s) => s.text).join(' '));
    if (words > opts.maxWords) extra.push({ sentenceIndex: sentences.length - 1, type: 'too_long', token: `${words} palavras` });
  }
  const all = [...extra, ...report.findings];
  return { sentences, findings: all };
}

/**
 * LLM writes cited sentences → placeholders filled by code → deterministic validation → one retry with the
 * findings → `draft` or `needs_review` (FR-006..FR-008).
 */
export async function generateSentences(deps: KbDeps, messages: ChatMessageLike[], ctx: ValidationContext, opts: GenerateOptions): Promise<GenerateResult> {
  const ask = (m: ChatMessageLike[]) => deps.llm.generateObject({ schema: LlmSentences, model: deps.models.chat, temperature: 0.2, numCtx: 16384, messages: m });
  const first = await ask(messages);
  const a = check(first, ctx, opts);
  if (!a.findings.length) return { sentences: a.sentences, report: { ok: true, attempts: 1, findings: [] }, status: 'draft' };

  const second = await ask([...messages, { role: 'assistant', content: JSON.stringify(first) }, buildRetryMessage(a.findings)]);
  const b = check(second, ctx, opts);
  return {
    sentences: b.sentences,
    report: { ok: b.findings.length === 0, attempts: 2, findings: b.findings },
    status: b.findings.length === 0 ? 'draft' : 'needs_review',
  };
}
