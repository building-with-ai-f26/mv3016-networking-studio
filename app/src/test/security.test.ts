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

describe('Attack checks (server)', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('blocks state-changing requests from other websites (CSRF)', async () => {
    const { isAllowedOrigin } = await import('../../server/guard.mjs');
    const ours = new Set(['https://networking-studio.onrender.com', 'http://localhost:5173']);
    expect(isAllowedOrigin({ origin: 'https://networking-studio.onrender.com' }, ours)).toBe(true);
    expect(isAllowedOrigin({ origin: 'https://evil.example' }, ours)).toBe(false);
    expect(isAllowedOrigin({ 'sec-fetch-site': 'cross-site' }, ours)).toBe(false);
    expect(isAllowedOrigin({}, ours)).toBe(true); // curl / server-to-server, still rate limited
  });

  it('a visitor cannot dodge the rate limit by sending a fake X-Forwarded-For', async () => {
    const { clientIp } = await import('../../server/guard.mjs');
    process.env.TRUST_PROXY = '1';
    expect(clientIp({ headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.7' }, socket: { remoteAddress: '10.0.0.1' } })).toBe('203.0.113.7');
    expect(clientIp({ headers: { 'cf-connecting-ip': '198.51.100.9', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' } })).toBe('198.51.100.9');
    process.env.TRUST_PROXY = '0';
    expect(clientIp({ headers: { 'x-forwarded-for': '1.1.1.1' }, socket: { remoteAddress: '127.0.0.1' } })).toBe('127.0.0.1');
  });

  it('demo visitors get a stricter AI limit than signed-in users', async () => {
    const { LIMITS } = await import('../../server/guard.mjs');
    expect(LIMITS.aiAnon.max).toBeLessThan(LIMITS.ai.max);
    expect(LIMITS.aiGlobal.max).toBeGreaterThan(LIMITS.ai.max);
  });

  it('Google sign-in uses PKCE and sessions expire on the server after 30 days', async () => {
    const { buildAuthUrl, sessionExpired } = await import('../../server/google.mjs');
    const url = new URL(buildAuthUrl({ clientId: 'x', step: 'login', state: 'login.abc', codeChallenge: 'chal' }));
    expect(url.searchParams.get('code_challenge')).toBe('chal');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const now = Date.parse('2026-12-31T00:00:00Z');
    expect(sessionExpired({ createdAt: '2026-12-20T00:00:00Z' }, now)).toBe(false);
    expect(sessionExpired({ createdAt: '2026-11-01T00:00:00Z' }, now)).toBe(true);
    expect(sessionExpired({}, now)).toBe(true);
  });
});
