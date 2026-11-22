import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decrypt, encrypt } from '../../server/crypto.mjs';
import { userKey } from '../../server/store.mjs';

describe('Secrets at rest (server)', () => {
  const before = process.env.TOKEN_ENCRYPTION_KEY;
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  });
  afterEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = before;
  });

  it('encrypts Google tokens: the stored text does not contain them and decrypts back', () => {
    const account = { refreshToken: '1//refresh-token-example', scope: 'openid email' };
    const stored = encrypt(account);
    expect(stored).not.toContain('refresh-token-example');
    expect(decrypt(stored)).toEqual(account);
  });

  it('rejects tampered data and a wrong key', () => {
    const stored = encrypt({ a: 1 });
    const parts = stored.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decrypt(parts.join(':'))).toThrow();
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    expect(() => decrypt(stored)).toThrow();
  });

  it('refuses to run without a valid encryption key', () => {
    process.env.TOKEN_ENCRYPTION_KEY = 'short';
    expect(() => encrypt({ a: 1 })).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it('database keys are a hash of the email, never the email', () => {
    expect(userKey('Student@Example.com')).toBe(userKey('student@example.com'));
    expect(userKey('student@example.com')).toMatch(/^[0-9a-f]{32}$/);
  });
});
