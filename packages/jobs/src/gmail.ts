import { createHash, randomBytes } from 'node:crypto';

/**
 * F7 Gmail transport (fetch injected): OAuth for installed apps with PKCE + read-only Gmail REST.
 * Research R2. Scope is gmail.readonly: nothing here can send, modify, label or delete mail, and every
 * Gmail API call is a GET. Errors never echo tokens.
 */

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
}

export function gmailConfig(env: Record<string, string | undefined> = process.env): GmailConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export type GmailErrorKind = 'auth' | 'http' | 'network';

export class GmailError extends Error {
  constructor(
    readonly kind: GmailErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface GmailTokens {
  refreshToken: string;
  accessToken: string;
  /** epoch ms */
  expiresAt: number;
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

export function oauthState(): string {
  return b64url(randomBytes(24));
}

export function authUrl(o: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const q = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state: o.state,
    code_challenge: o.challenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${q}`;
}

async function request(url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw new GmailError('network', `Google indisponível (${(e as Error).name})`);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string | { message?: string; status?: string } };
  if (!res.ok) {
    const code = typeof data.error === 'string' ? data.error : (data.error?.status ?? '');
    const auth = res.status === 401 || code === 'invalid_grant' || code === 'UNAUTHENTICATED';
    throw new GmailError(auth ? 'auth' : 'http', `Google recusou (${res.status}${code ? `: ${code}` : ''})`);
  }
  return data;
}

function tokenRequest(body: Record<string, string>, fetchImpl: typeof fetch) {
  return request(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() }, fetchImpl) as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  }>;
}

export async function exchangeCode(cfg: GmailConfig, o: { code: string; verifier: string; redirectUri: string }, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<GmailTokens> {
  const t = await tokenRequest(
    { client_id: cfg.clientId, client_secret: cfg.clientSecret, code: o.code, code_verifier: o.verifier, grant_type: 'authorization_code', redirect_uri: o.redirectUri },
    fetchImpl,
  );
  if (!t.refresh_token) throw new GmailError('auth', 'Google não devolveu refresh token');
  if (t.scope && !t.scope.split(' ').includes(GMAIL_SCOPE)) throw new GmailError('auth', 'permissão de leitura do Gmail não concedida');
  return { refreshToken: t.refresh_token, accessToken: t.access_token, expiresAt: now + t.expires_in * 1000 };
}

export async function refreshAccessToken(cfg: GmailConfig, tokens: GmailTokens, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<GmailTokens> {
  const t = await tokenRequest({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: tokens.refreshToken, grant_type: 'refresh_token' }, fetchImpl);
  return { refreshToken: t.refresh_token ?? tokens.refreshToken, accessToken: t.access_token, expiresAt: now + t.expires_in * 1000 };
}

/** Valid for at least one more minute? */
export function tokenFresh(tokens: GmailTokens, now = Date.now()): boolean {
  return tokens.expiresAt - now > 60_000;
}

export async function revokeToken(token: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  await request(REVOKE_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString() }, fetchImpl);
}

const get = (accessToken: string, path: string, fetchImpl: typeof fetch) =>
  request(`${API}${path}`, { method: 'GET', headers: { authorization: `Bearer ${accessToken}` } }, fetchImpl);

export async function getProfile(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<{ emailAddress: string }> {
  return (await get(accessToken, '/profile', fetchImpl)) as { emailAddress: string };
}

export async function listMessages(accessToken: string, q: string, pageToken: string | undefined, fetchImpl: typeof fetch = fetch): Promise<{ ids: string[]; nextPageToken?: string }> {
  const params = new URLSearchParams({ q, maxResults: '50' });
  if (pageToken) params.set('pageToken', pageToken);
  const r = (await get(accessToken, `/messages?${params}`, fetchImpl)) as { messages?: { id: string }[]; nextPageToken?: string };
  return { ids: (r.messages ?? []).map((m) => m.id), nextPageToken: r.nextPageToken };
}

export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart;
}

export async function getMessage(accessToken: string, id: string, fetchImpl: typeof fetch = fetch): Promise<GmailMessage> {
  return (await get(accessToken, `/messages/${encodeURIComponent(id)}?format=full`, fetchImpl)) as GmailMessage;
}

export function headerValue(msg: GmailMessage, name: string): string {
  const h = msg.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? '';
}

const decode = (data: string) => Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function findPart(part: GmailPart | undefined, mime: string): GmailPart | undefined {
  if (!part) return undefined;
  if (part.mimeType === mime && part.body?.data && !part.filename) return part;
  for (const p of part.parts ?? []) {
    const hit = findPart(p, mime);
    if (hit) return hit;
  }
  return undefined;
}

/** Body text for matching/classification: `text/plain`, else HTML stripped; attachments ignored; max chars. */
export function extractText(msg: GmailMessage, max = 4000): string {
  const plain = findPart(msg.payload, 'text/plain');
  if (plain?.body?.data) return decode(plain.body.data).replace(/\r/g, '').trim().slice(0, max);
  const html = findPart(msg.payload, 'text/html');
  if (html?.body?.data) return htmlToText(decode(html.body.data)).slice(0, max);
  return (msg.snippet ?? '').slice(0, max);
}

export function gmailLink(messageId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${messageId}`;
}

/** Gmail search query: inbox, not sent by the user, after a unix epoch (seconds). */
export function mailQuery(after: Date): string {
  return `in:inbox -from:me after:${Math.floor(after.getTime() / 1000)}`;
}
