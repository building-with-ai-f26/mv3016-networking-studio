// Access control, end to end: starts the real server (with a temporary data folder and no .env, so it never touches
// the real database or keys) and checks that Account B can't read Account A's data in any way.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { userKey } from '../../server/store.mjs';

const A = 'account-a@example.com';
const B = 'account-b@example.com';
const sidA = 'a'.repeat(48);
const sidB = 'b'.repeat(48);
const port = 18000 + Math.floor(Math.random() * 2000);
const base = `http://127.0.0.1:${port}`;
let dir = '';
let server: ChildProcess;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ns-access-'));
  mkdirSync(join(dir, 'users'));
  const createdAt = new Date().toISOString();
  writeFileSync(join(dir, 'sessions.json'), JSON.stringify({ [sidA]: { user: { email: A, name: 'Account A' }, tokens: {}, createdAt }, [sidB]: { user: { email: B, name: 'Account B' }, tokens: {}, createdAt } }));
  writeFileSync(join(dir, `users/${userKey(A)}.json`), JSON.stringify({ secret: 'A-private-notes', contacts: [{ name: 'Only A knows' }] }));
  writeFileSync(join(dir, `users/${userKey(B)}.json`), JSON.stringify({ secret: 'B-notes', contacts: [] }));
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, NS_TEST_NO_DOTENV: '1', NS_DATA_DIR: dir, API_PORT: String(port), HOST: '127.0.0.1' };
  server = spawn(process.execPath, ['server/index.mjs'], { env, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((ok) => setTimeout(ok, 100));
  }
  throw new Error('server did not start');
}, 15_000);

afterAll(() => {
  server?.kill();
  rmSync(dir, { recursive: true, force: true });
});

const as = (sid: string, init: RequestInit = {}) => ({ ...init, headers: { ...(init.headers ?? {}), Cookie: `ns_sid=${sid}` } });

describe('Access control (real server)', () => {
  it('each account reads only its own data', async () => {
    expect((await (await fetch(`${base}/api/state`, as(sidA))).json()).state.secret).toBe('A-private-notes');
    expect((await (await fetch(`${base}/api/state`, as(sidB))).json()).state.secret).toBe('B-notes');
  });

  it("Account B can't get Account A's data by naming A in the URL or headers", async () => {
    const r = await fetch(`${base}/api/state?user=${encodeURIComponent(A)}&email=${encodeURIComponent(A)}&user_key=${userKey(A)}`, as(sidB, { headers: { 'X-User-Email': A } }));
    const text = await r.text();
    expect(r.status).toBe(200);
    expect(text).not.toContain('A-private-notes');
    expect(text).toContain('B-notes');
  });

  it("Account B's save never overwrites Account A", async () => {
    const put = await fetch(`${base}/api/state?user=${encodeURIComponent(A)}`, as(sidB, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1, secret: 'B-overwrote', contacts: [] }) }));
    expect(put.status).toBe(200);
    expect((await (await fetch(`${base}/api/state`, as(sidA))).json()).state.secret).toBe('A-private-notes');
    expect((await (await fetch(`${base}/api/state`, as(sidB))).json()).state.secret).toBe('B-overwrote'); // it saved to B
  });

  it('without a session (or with a made-up one) everything private answers 401', async () => {
    expect((await fetch(`${base}/api/state`)).status).toBe(401);
    expect((await fetch(`${base}/api/state`, as('c'.repeat(48)))).status).toBe(401);
    for (const path of ['/api/gmail/related', '/api/gmail/send', '/api/usage'])
      expect((await fetch(`${base}${path}`, { method: path === '/api/usage' ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: path === '/api/usage' ? undefined : '{}' })).status).toBe(401);
  });

  it("another website can't make a signed-in browser change data (CSRF)", async () => {
    const r = await fetch(`${base}/api/state`, as(sidA, { method: 'PUT', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{"secret":"evil"}' }));
    expect(r.status).toBe(403);
  });
});
