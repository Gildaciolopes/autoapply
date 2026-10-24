import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Missing/invalid key or a session that does not decrypt: the session is unusable (never plaintext). */
export class SessionKeyError extends Error {}

/** `SESSION_ENCRYPTION_KEY` as 32 bytes, or null when missing / not 64 hex chars. */
export function sessionKey(raw = process.env.SESSION_ENCRYPTION_KEY): Buffer | null {
  return raw && /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : null;
}

const b64 = (b: Buffer) => b.toString('base64');

/** AES-256-GCM, random 12-byte IV: `v1:<iv>:<tag>:<data>` (base64 parts). */
export function encryptSession(state: unknown, key: Buffer | null = sessionKey()): string {
  if (!key) throw new SessionKeyError('SESSION_ENCRYPTION_KEY missing or invalid');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()]);
  return ['v1', b64(iv), b64(cipher.getAuthTag()), b64(data)].join(':');
}

export function decryptSession<T = unknown>(enc: string, key: Buffer | null = sessionKey()): T {
  if (!key) throw new SessionKeyError('SESSION_ENCRYPTION_KEY missing or invalid');
  const [v, iv, tag, data] = enc.split(':');
  if (v !== 'v1' || !iv || !tag || !data) throw new SessionKeyError('unknown session format');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    const out = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]);
    return JSON.parse(out.toString('utf8')) as T;
  } catch {
    throw new SessionKeyError('session does not decrypt with this key');
  }
}
