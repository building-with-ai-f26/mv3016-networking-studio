// Where the server keeps its data.
// - With SUPABASE_URL + SUPABASE_SECRET_KEY set (local .env or Render): the Supabase Postgres database.
// - Without them (tests, quick local runs): JSON files in app/.data/ (git-ignored).
// Only this server talks to the database, with the secret key. The browser never does.
// Rows are keyed by a hash of the email; Google tokens and sessions are encrypted (see crypto.mjs).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decrypt, encrypt } from './crypto.mjs';

/** Hash used as the database key for an account (the email itself is never stored as a key). */
export const userKey = (email) => createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex').slice(0, 32);
const sidHash = (sid) => createHash('sha256').update(String(sid)).digest('hex');

export const usingDatabase = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);

// ---------- Supabase (PostgREST over HTTPS, secret key) ----------

async function rest(method, path, body) {
  const key = process.env.SUPABASE_SECRET_KEY;
  const r = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) {
    // Log only the table and status, never the data.
    console.error(`[db] ${method} ${path.split('?')[0]} → ${r.status}`);
    throw new Error('Database error.');
  }
  return method === 'GET' ? r.json() : null;
}
const eq = (v) => `eq.${encodeURIComponent(v)}`;
const getRow = async (table, col, val) => (await rest('GET', `${table}?${col}=${eq(val)}&select=*&limit=1`))[0] ?? null;
const upsert = (table, row) => rest('POST', table, row);
const remove = (table, col, val) => rest('DELETE', `${table}?${col}=${eq(val)}`);

// ---------- local files ----------

const dataDir = () => fileURLToPath(new URL('../.data/', import.meta.url));
function readFile(name, fallback) {
  try {
    return JSON.parse(readFileSync(dataDir() + name, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeFile(name, value) {
  const path = dataDir() + name;
  mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
}

// ---------- per-account app state ----------

export async function readUserState(email) {
  if (usingDatabase()) return (await getRow('user_state', 'user_key', userKey(email)))?.state ?? null;
  return readFile(`users/${userKey(email)}.json`, null);
}

export async function writeUserState(email, state) {
  if (usingDatabase()) return upsert('user_state', { user_key: userKey(email), state, updated_at: new Date().toISOString() });
  writeFile(`users/${userKey(email)}.json`, state);
}

export async function deleteUserState(email) {
  if (usingDatabase()) return remove('user_state', 'user_key', userKey(email));
  rmSync(dataDir() + `users/${userKey(email)}.json`, { force: true });
}

// ---------- sessions (cookie id → user + Google tokens), encrypted ----------

export async function loadSession(sid) {
  if (usingDatabase()) {
    const row = await getRow('app_sessions', 'sid_hash', sidHash(sid));
    return row ? decrypt(row.data_enc) : null;
  }
  return readFile('sessions.json', {})[sid] ?? null;
}

export async function saveSession(sid, session) {
  if (usingDatabase()) {
    return upsert('app_sessions', { sid_hash: sidHash(sid), user_key: userKey(session.user.email), data_enc: encrypt(session), updated_at: new Date().toISOString() });
  }
  const all = readFile('sessions.json', {});
  all[sid] = session;
  writeFile('sessions.json', all);
}

export async function deleteSession(sid) {
  if (usingDatabase()) return remove('app_sessions', 'sid_hash', sidHash(sid));
  const all = readFile('sessions.json', {});
  delete all[sid];
  writeFile('sessions.json', all);
}

/** Removes every session of an account (used by Disconnect). */
export async function deleteSessionsOf(email) {
  if (usingDatabase()) return remove('app_sessions', 'user_key', userKey(email));
  const all = readFile('sessions.json', {});
  for (const [sid, s] of Object.entries(all)) if (s.user?.email === email) delete all[sid];
  writeFile('sessions.json', all);
}

// ---------- Google account (refresh token + scopes), encrypted ----------

export async function loadAccount(email) {
  if (usingDatabase()) {
    const row = await getRow('google_accounts', 'user_key', userKey(email));
    return row ? decrypt(row.data_enc) : null;
  }
  return readFile('accounts.json', {})[email] ?? null;
}

export async function saveAccount(email, account) {
  if (usingDatabase()) return upsert('google_accounts', { user_key: userKey(email), data_enc: encrypt(account), updated_at: new Date().toISOString() });
  const all = readFile('accounts.json', {});
  all[email] = account;
  writeFile('accounts.json', all);
}

export async function deleteAccount(email) {
  if (usingDatabase()) return remove('google_accounts', 'user_key', userKey(email));
  const all = readFile('accounts.json', {});
  delete all[email];
  writeFile('accounts.json', all);
}

// ---------- monthly AI spend ----------

export async function loadUsage(month) {
  if (usingDatabase()) {
    const row = await getRow('ai_usage', 'month', month);
    return row ? { month, costUsd: Number(row.cost_usd), calls: row.calls, searches: Number(row.searches ?? 0) } : null;
  }
  const u = readFile('ai-usage.json', null);
  return u?.month === month ? u : null;
}

export async function saveUsage(u) {
  if (usingDatabase()) {
    const row = { month: u.month, cost_usd: u.costUsd, calls: u.calls, updated_at: new Date().toISOString() };
    // `searches` needs migration 002; until it is run, save without it.
    try {
      return await upsert('ai_usage', { ...row, searches: u.searches ?? 0 });
    } catch {
      return upsert('ai_usage', row);
    }
  }
  writeFile('ai-usage.json', u);
}

/** Files left from before the database (for the one-time import). */
export const legacyFilesExist = () => existsSync(dataDir() + 'sessions.json') || existsSync(dataDir() + 'accounts.json');
