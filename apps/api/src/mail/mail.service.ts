import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { decryptSecret, encryptSecret, Prisma, secretKey } from '@autoapply/db';
import { authUrl, exchangeCode, getProfile, gmailConfig, oauthState, pkcePair, revokeToken, type GmailTokens } from '@autoapply/jobs';
import { QUEUES, type MailAccountView, type MailCheckPayload } from '@autoapply/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiError } from '../kb/api-error.js';

const ID = 'default';
const STATE_TTL_MS = 10 * 60_000;

interface PendingState {
  state: string;
  verifier: string;
  expiresAt: number;
}

export function redirectUri(env = process.env): string {
  return `http://127.0.0.1:${env.API_PORT ?? 3001}/mail/oauth/callback`;
}

export function webOrigin(env = process.env): string {
  return env.WEB_ORIGIN ?? 'http://localhost:3000';
}

/** F7 Gmail connection (research R2): read-only OAuth with PKCE, the user consents in their browser. */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  /** Injected in tests (fake Google). */
  fetchImpl: typeof fetch = fetch;
  env: Record<string, string | undefined> = process.env;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUES.mail) private readonly queue: Queue,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  async view(): Promise<MailAccountView> {
    const a = await this.db.mailAccount.findUnique({ where: { id: ID } });
    return {
      configured: gmailConfig(this.env) !== null,
      status: a?.status ?? 'disconnected',
      email: a?.email ?? null,
      connectedAt: a?.connectedAt?.toISOString() ?? null,
      lastCheckAt: a?.lastCheckAt?.toISOString() ?? null,
      lastError: a?.lastError ?? null,
    };
  }

  /** URL of Google's consent page; state + PKCE verifier kept 10 min. */
  async connectUrl(now = Date.now()): Promise<string> {
    const cfg = gmailConfig(this.env);
    if (!cfg) throw new ApiError(409, 'not_configured', 'defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env');
    if (!secretKey(this.env.SESSION_ENCRYPTION_KEY)) throw new ApiError(409, 'no_encryption_key', 'SESSION_ENCRYPTION_KEY ausente ou inválida');
    const { verifier, challenge } = pkcePair();
    const state = oauthState();
    const pending: PendingState = { state, verifier, expiresAt: now + STATE_TTL_MS };
    await this.db.mailAccount.upsert({ where: { id: ID }, create: { id: ID, pendingState: pending as never }, update: { pendingState: pending as never } });
    return authUrl({ clientId: cfg.clientId, redirectUri: redirectUri(this.env), state, challenge });
  }

  /** Google redirect back; returns where to send the browser (web Integrações page). */
  async callback(q: { code?: string; state?: string; error?: string }, now = Date.now()): Promise<string> {
    const back = (r: 'connected' | 'denied' | 'error') => `${webOrigin(this.env)}/integracoes?mail=${r}`;
    const a = await this.db.mailAccount.findUnique({ where: { id: ID } });
    const pending = a?.pendingState as PendingState | null | undefined;
    await this.db.mailAccount.updateMany({ where: { id: ID }, data: { pendingState: Prisma.DbNull } });
    if (!pending || !q.state || q.state !== pending.state || pending.expiresAt < now) return back('error');
    if (q.error || !q.code) return back('denied');
    const cfg = gmailConfig(this.env);
    const key = secretKey(this.env.SESSION_ENCRYPTION_KEY);
    if (!cfg || !key) return back('error');
    try {
      const tokens = await exchangeCode(cfg, { code: q.code, verifier: pending.verifier, redirectUri: redirectUri(this.env) }, this.fetchImpl, now);
      const profile = await getProfile(tokens.accessToken, this.fetchImpl);
      await this.db.mailAccount.update({
        where: { id: ID },
        data: { status: 'connected', email: profile.emailAddress, tokensEnc: encryptSecret(tokens, key), connectedAt: new Date(now), lastError: null },
      });
      return back('connected');
    } catch (e) {
      this.logger.warn(`gmail connect failed: ${(e as Error).message}`);
      await this.db.mailAccount.update({ where: { id: ID }, data: { lastError: (e as Error).message.slice(0, 200) } });
      return back('error');
    }
  }

  /** Revoke at Google (best effort) and delete the tokens; recorded replies stay (FR-007). */
  async disconnect(): Promise<MailAccountView> {
    const a = await this.db.mailAccount.findUnique({ where: { id: ID } });
    if (a?.tokensEnc) {
      try {
        const t = decryptSecret<GmailTokens>(a.tokensEnc, secretKey(this.env.SESSION_ENCRYPTION_KEY));
        await revokeToken(t.refreshToken, this.fetchImpl);
      } catch (e) {
        this.logger.warn(`gmail revoke failed (tokens deleted anyway): ${(e as Error).message}`);
      }
    }
    await this.db.mailAccount.upsert({
      where: { id: ID },
      create: { id: ID },
      update: { status: 'disconnected', tokensEnc: null, email: null, connectedAt: null, pendingState: Prisma.DbNull, lastError: null },
    });
    return this.view();
  }

  async check(): Promise<{ queued: true }> {
    const a = await this.db.mailAccount.findUnique({ where: { id: ID } });
    if (a?.status !== 'connected') throw new ApiError(409, 'not_connected', 'conecte o Gmail primeiro');
    const p: MailCheckPayload = {};
    await this.queue.add('mail-check', p, { attempts: 1, removeOnComplete: 20, removeOnFail: 50 });
    return { queued: true };
  }
}
