import { readFileSync } from 'node:fs';
import { combineClassification, isPlatformNoise, matchReply, replyHints, replyMessages, type ReplyCandidate } from '@autoapply/jobs';
import type { LlmProvider } from '@autoapply/llm';
import { ReplyClassification, type ReplyType } from '@autoapply/shared';

interface EvalEmail {
  id: string;
  from: string;
  subject: string;
  text: string;
  date: string;
  expect: { applicationId: string | null; type: ReplyType | null };
}

export function loadReplyEval() {
  const raw = JSON.parse(readFileSync(new URL('./fixtures/replies-eval/emails.json', import.meta.url), 'utf8')) as {
    candidates: (Omit<ReplyCandidate, 'submittedAt'> & { submittedAt: string })[];
    emails: EvalEmail[];
  };
  return { candidates: raw.candidates.map((c) => ({ ...c, submittedAt: new Date(c.submittedAt) })), emails: raw.emails };
}

export interface ReplyEvalCase {
  id: string;
  expected: EvalEmail['expect'];
  applicationId: string | null;
  type: ReplyType | null;
  needsReview: boolean;
  linkOk: boolean;
  typeOk: boolean | null;
}

/**
 * SC-002: link accuracy (≥ 90%), type accuracy (≥ 85%), unrelated stored (0). Without an LLM the type
 * comes from the deterministic hints only (offline test); with one, the full hints + LLM pipeline.
 */
export async function runReplyEval(llm: LlmProvider | null) {
  const { candidates, emails } = loadReplyEval();
  const cases: ReplyEvalCase[] = [];
  for (const m of emails) {
    const mail = { from: m.from, subject: m.subject, text: m.text, date: new Date(m.date) };
    const match = isPlatformNoise(m.from, m.subject) ? null : matchReply(mail, candidates);
    let type: ReplyType | null = null;
    let needsReview = match?.needsReview ?? false;
    if (match) {
      const hint = replyHints(m.subject, m.text);
      if (llm) {
        const out = await llm.generateObject({ schema: ReplyClassification, messages: replyMessages(m), temperature: 0, numCtx: 8192 });
        const c = combineClassification(hint, out);
        type = c.type;
        needsReview ||= c.needsReview;
      } else {
        type = hint ?? 'other';
      }
    }
    const linkOk = (match?.applicationId ?? null) === m.expect.applicationId;
    cases.push({ id: m.id, expected: m.expect, applicationId: match?.applicationId ?? null, type, needsReview, linkOk, typeOk: m.expect.type ? type === m.expect.type : null });
  }
  const related = cases.filter((c) => c.expected.applicationId);
  const linkAccuracy = cases.filter((c) => c.linkOk).length / cases.length;
  const typeAccuracy = related.filter((c) => c.typeOk).length / related.length;
  const unrelatedStored = cases.filter((c) => !c.expected.applicationId && c.applicationId).length;
  return { cases, linkAccuracy, typeAccuracy, unrelatedStored };
}
