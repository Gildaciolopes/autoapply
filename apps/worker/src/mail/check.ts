import {
  combineClassification,
  excerpt,
  extractText,
  getMessage,
  GmailError,
  gmailLink,
  headerValue,
  isPlatformNoise,
  listMessages,
  mailQuery,
  matchReply,
  refreshAccessToken,
  replyHints,
  replyMessages,
  tokenFresh,
  type GmailConfig,
  type GmailTokens,
} from '@autoapply/jobs';
import { applyReplyEffects, decryptSecret, encryptSecret, replyCandidates, SecretKeyError, type PrismaClient } from '@autoapply/db';
import type { LlmProvider } from '@autoapply/llm';
import { REPLY_TYPE_LABELS, ReplyClassification } from '@autoapply/shared';

export const MAIL_ACCOUNT_ID = 'default';
const MAX_MESSAGES = 200;
const PRUNE_DAYS = 180;

export interface MailCheckDeps {
  db: PrismaClient;
  llm: LlmProvider;
  config: GmailConfig | null;
  fetch?: typeof fetch;
  now?: Date;
  key?: Buffer | null;
}

export interface MailCheckResult {
  status: 'skipped' | 'ok' | 'expired' | 'error';
  seen: number;
  matched: number;
  unmatched: number;
  filtered: number;
  retry: number;
  reason?: string;
}

/**
 * F7 mail check (research R3): list new inbox messages, match them to submitted applications, classify
 * matched ones on the local LLM and store a Reply (≤ 300-char excerpt). Unmatched messages leave only
 * their id. Read-only: the Gmail transport only issues GETs (plus token refresh).
 */
export async function mailCheck(deps: MailCheckDeps): Promise<MailCheckResult> {
  const { db, llm } = deps;
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? new Date();
  const res: MailCheckResult = { status: 'ok', seen: 0, matched: 0, unmatched: 0, filtered: 0, retry: 0 };
  const account = await db.mailAccount.findUnique({ where: { id: MAIL_ACCOUNT_ID } });
  if (!account || account.status !== 'connected' || !account.tokensEnc) return { ...res, status: 'skipped', reason: 'not_connected' };
  if (!deps.config) return { ...res, status: 'skipped', reason: 'not_configured' };

  const expire = async (why: string) => {
    await db.mailAccount.update({ where: { id: MAIL_ACCOUNT_ID }, data: { status: 'expired', lastError: why } });
    return { ...res, status: 'expired' as const, reason: why };
  };

  let tokens: GmailTokens;
  try {
    tokens = decryptSecret<GmailTokens>(account.tokensEnc, deps.key);
  } catch (e) {
    if (e instanceof SecretKeyError) return expire('tokens ilegíveis com a chave atual: reconecte o Gmail');
    throw e;
  }

  try {
    if (!tokenFresh(tokens, now.getTime())) {
      tokens = await refreshAccessToken(deps.config, tokens, fetchImpl, now.getTime());
      await db.mailAccount.update({ where: { id: MAIL_ACCOUNT_ID }, data: { tokensEnc: encryptSecret(tokens, deps.key) } });
    }

    const candidates = await replyCandidates(db, now);
    if (!candidates.length) {
      await db.mailAccount.update({ where: { id: MAIL_ACCOUNT_ID }, data: { lastCheckAt: now, lastError: null } });
      return res;
    }
    const oldest = Math.min(...candidates.map((c) => c.since.getTime()));
    const after = new Date(Math.max(oldest, account.lastCheckAt ? account.lastCheckAt.getTime() - 86_400_000 : 0));

    const ids: string[] = [];
    let page: string | undefined;
    do {
      const r = await listMessages(tokens.accessToken, mailQuery(after), page, fetchImpl);
      ids.push(...r.ids);
      page = r.nextPageToken;
    } while (page && ids.length < MAX_MESSAGES);

    const batch = ids.slice(0, MAX_MESSAGES);
    const done = new Set([
      ...(await db.processedMail.findMany({ where: { messageId: { in: batch } }, select: { messageId: true } })).map((p) => p.messageId),
      ...(await db.reply.findMany({ where: { messageId: { in: batch } }, select: { messageId: true } })).map((r) => r.messageId!),
    ]);

    for (const id of batch) {
      if (done.has(id)) continue;
      res.seen++;
      const msg = await getMessage(tokens.accessToken, id, fetchImpl);
      const from = headerValue(msg, 'From');
      const subject = headerValue(msg, 'Subject');
      const date = msg.internalDate ? new Date(Number(msg.internalDate)) : now;
      if (isPlatformNoise(from, subject)) {
        await db.processedMail.create({ data: { messageId: id, outcome: 'filtered' } });
        res.filtered++;
        continue;
      }
      const text = extractText(msg);
      const match = matchReply({ from, subject, text, date }, candidates);
      if (!match) {
        // Nothing about the message is stored but its id (FR-009).
        await db.processedMail.create({ data: { messageId: id, outcome: 'unmatched' } });
        res.unmatched++;
        continue;
      }
      let llmOut: ReplyClassification;
      try {
        llmOut = await llm.generateObject({ schema: ReplyClassification, messages: replyMessages({ from, subject, text }), temperature: 0, numCtx: 8192 });
      } catch {
        res.retry++; // local AI down: not marked processed, retried next check
        continue;
      }
      const c = combineClassification(replyHints(subject, text), llmOut);
      const reply = await db.reply.create({
        data: {
          applicationId: match.applicationId,
          origin: 'email',
          messageId: id,
          type: c.type,
          confidence: c.confidence,
          needsReview: c.needsReview || match.needsReview,
          receivedAt: date,
          sender: from.slice(0, 200) || null,
          subject: subject.slice(0, 200) || null,
          excerpt: excerpt(text) || null,
          link: gmailLink(id),
        },
      });
      await db.processedMail.create({ data: { messageId: id, outcome: 'matched' } });
      await applyReplyEffects(db, match.applicationId);
      await db.runEvent.create({
        data: { applicationId: match.applicationId, queue: 'mail', level: 'info', message: `resposta: ${REPLY_TYPE_LABELS[c.type]}`, data: { step: 'reply', replyId: reply.id, needsReview: reply.needsReview } },
      });
      res.matched++;
    }

    await db.processedMail.deleteMany({ where: { at: { lt: new Date(now.getTime() - PRUNE_DAYS * 86_400_000) } } });
    await db.mailAccount.update({ where: { id: MAIL_ACCOUNT_ID }, data: { lastCheckAt: now, lastError: null } });
    return res;
  } catch (e) {
    if (e instanceof GmailError && e.kind === 'auth') return expire('acesso ao Gmail expirou ou foi revogado: reconecte');
    const message = e instanceof Error ? e.message : String(e);
    await db.mailAccount.update({ where: { id: MAIL_ACCOUNT_ID }, data: { lastError: message.slice(0, 200) } });
    return { ...res, status: 'error', reason: message };
  }
}
