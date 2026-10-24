import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSession, encryptSession, SessionKeyError, sessionKey } from '../src/apply/session-crypto.js';

const key = randomBytes(32);
const state = { cookies: [{ name: 'li_at', value: 'SECRET-COOKIE-VALUE', domain: '.linkedin.com' }], origins: [] };

describe('session crypto (FR-003)', () => {
  it('round trip; ciphertext hides the cookie; random IV', () => {
    const a = encryptSession(state, key);
    const b = encryptSession(state, key);
    expect(a).toMatch(/^v1:/);
    expect(a).not.toContain('SECRET-COOKIE-VALUE');
    expect(a).not.toBe(b);
    expect(decryptSession(a, key)).toEqual(state);
  });
  it('wrong key, tampering, missing key → SessionKeyError (no plaintext fallback)', () => {
    const enc = encryptSession(state, key);
    expect(() => decryptSession(enc, randomBytes(32))).toThrow(SessionKeyError);
    const parts = enc.split(':');
    parts[3] = Buffer.from('x' + Buffer.from(parts[3]!, 'base64').toString('latin1')).toString('base64');
    expect(() => decryptSession(parts.join(':'), key)).toThrow(SessionKeyError);
    expect(() => encryptSession(state, null)).toThrow(SessionKeyError);
    expect(sessionKey('change-me')).toBeNull();
    expect(sessionKey('a'.repeat(64))?.length).toBe(32);
  });
});
