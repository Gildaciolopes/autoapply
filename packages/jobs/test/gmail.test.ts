import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  authUrl,
  exchangeCode,
  extractText,
  getMessage,
  GMAIL_SCOPE,
  gmailConfig,
  GmailError,
  listMessages,
  mailQuery,
  pkcePair,
  refreshAccessToken,
  tokenFresh,
} from '../src/gmail.js';

const cfg = { clientId: 'cid', clientSecret: 'secret' };
const b64url = (s: string) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function fakeFetch(responses: { status?: number; body: unknown }[]) {
  const calls: { url: string; method: string; body?: string; auth?: string }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body as string | undefined, auth: (init.headers as Record<string, string>)?.authorization });
    const r = responses.shift() ?? { body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('gmail transport (F7 US2, research R2)', () => {
  it('config needs id and secret', () => {
    expect(gmailConfig({})).toBeNull();
    expect(gmailConfig({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: ' b ' })).toEqual({ clientId: 'a', clientSecret: 'b' });
  });

  it('auth url asks only for read-only scope with PKCE S256', () => {
    const { verifier, challenge } = pkcePair();
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
    const u = new URL(authUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:3001/mail/oauth/callback', state: 'st', challenge }));
    expect(u.origin).toBe('https://accounts.google.com');
    expect(u.searchParams.get('scope')).toBe(GMAIL_SCOPE);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('state')).toBe('st');
  });

  it('exchanges the code and refreshes', async () => {
    const f = fakeFetch([
      { body: { access_token: 'at1', refresh_token: 'rt', expires_in: 3600, scope: GMAIL_SCOPE } },
      { body: { access_token: 'at2', expires_in: 3600 } },
    ]);
    const t = await exchangeCode(cfg, { code: 'c', verifier: 'v', redirectUri: 'http://127.0.0.1:3001/cb' }, f.impl, 1000);
    expect(t).toEqual({ refreshToken: 'rt', accessToken: 'at1', expiresAt: 1000 + 3_600_000 });
    expect(f.calls[0]).toMatchObject({ url: 'https://oauth2.googleapis.com/token', method: 'POST' });
    expect(new URLSearchParams(f.calls[0]!.body).get('code_verifier')).toBe('v');
    const r = await refreshAccessToken(cfg, t, f.impl, 2000);
    expect(r).toMatchObject({ refreshToken: 'rt', accessToken: 'at2' });
    expect(tokenFresh(r, 2000)).toBe(true);
    expect(tokenFresh(r, 2000 + 3_600_000)).toBe(false);
  });

  it('refuses a grant without the read-only scope; invalid_grant / 401 are auth errors without tokens', async () => {
    await expect(exchangeCode(cfg, { code: 'c', verifier: 'v', redirectUri: 'x' }, fakeFetch([{ body: { access_token: 'a', refresh_token: 'r', expires_in: 1, scope: 'openid' } }]).impl)).rejects.toThrow(GmailError);
    const e = await refreshAccessToken(cfg, { refreshToken: 'SECRET-RT', accessToken: 'x', expiresAt: 0 }, fakeFetch([{ status: 400, body: { error: 'invalid_grant' } }]).impl).catch((x) => x);
    expect(e).toBeInstanceOf(GmailError);
    expect(e.kind).toBe('auth');
    expect(String(e.message)).not.toContain('SECRET');
    const e2 = await listMessages('SECRET-AT', 'q', undefined, fakeFetch([{ status: 401, body: { error: { status: 'UNAUTHENTICATED' } } }]).impl).catch((x) => x);
    expect(e2.kind).toBe('auth');
    expect(String(e2.message)).not.toContain('SECRET');
    const e3 = await listMessages('a', 'q', undefined, fakeFetch([{ status: 500, body: {} }]).impl).catch((x) => x);
    expect(e3.kind).toBe('http');
  });

  it('list and get are GET calls with bearer token', async () => {
    const f = fakeFetch([{ body: { messages: [{ id: 'm1' }, { id: 'm2' }], nextPageToken: 'p2' } }, { body: { id: 'm1' } }]);
    const page = await listMessages('at', mailQuery(new Date('2026-10-01T00:00:00Z')), undefined, f.impl);
    expect(page).toEqual({ ids: ['m1', 'm2'], nextPageToken: 'p2' });
    await getMessage('at', 'm1', f.impl);
    expect(f.calls.every((c) => c.method === 'GET' && c.auth === 'Bearer at')).toBe(true);
    expect(new URL(f.calls[0]!.url).searchParams.get('q')).toBe('in:inbox -from:me after:1790812800');
    expect(f.calls[1]!.url).toContain('/messages/m1?format=full');
  });

  it('extracts text/plain from multipart, else HTML stripped, ignores attachments', () => {
    const multipart = {
      id: 'x',
      payload: {
        mimeType: 'multipart/mixed',
        parts: [
          { mimeType: 'application/pdf', filename: 'cv.pdf', body: { attachmentId: 'a1' } },
          { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { data: b64url('<p>Olá</p>') } }, { mimeType: 'text/plain', body: { data: b64url('Olá Ana,\r\nvamos agendar?') } }] },
        ],
      },
    };
    expect(extractText(multipart)).toBe('Olá Ana,\nvamos agendar?');
    const html = { id: 'y', payload: { mimeType: 'text/html', body: { data: b64url('<style>x{}</style><p>Infelizmente&nbsp;não</p><br>Equipe') } } };
    expect(extractText(html)).toBe('Infelizmente não\nEquipe');
    expect(extractText({ id: 'z', snippet: 'só snippet' })).toBe('só snippet');
    expect(extractText({ id: 'w', payload: { mimeType: 'text/plain', body: { data: b64url('a'.repeat(5000)) } } })).toHaveLength(4000);
  });
});
