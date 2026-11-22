// One-time import: copies the data saved on this computer (app/.data) into the Supabase database.
// Run from app/: node scripts/import-local-data.mjs
// Prints only counts, never emails, names or tokens. The local files are left untouched (delete them yourself later).
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
const store = await import('../server/store.mjs');
if (!store.usingDatabase()) {
  console.error('SUPABASE_URL / SUPABASE_SECRET_KEY are missing in app/.env.');
  process.exit(1);
}
const dir = fileURLToPath(new URL('../.data/', import.meta.url));
const read = (name) => {
  try {
    return JSON.parse(readFileSync(dir + name, 'utf8'));
  } catch {
    return {};
  }
};

const accounts = read('accounts.json');
for (const [email, account] of Object.entries(accounts)) await store.saveAccount(email, account);

const sessions = read('sessions.json');
for (const [sid, session] of Object.entries(sessions)) if (session?.user?.email) await store.saveSession(sid, session);

// App state files are named by the same hash used as the database key, so they map 1:1.
let states = 0;
for (const file of readdirSync(dir + 'users', { withFileTypes: true })) {
  if (!file.isFile() || !file.name.endsWith('.json')) continue;
  const state = JSON.parse(readFileSync(dir + 'users/' + file.name, 'utf8'));
  const key = file.name.replace(/\.json$/, '');
  await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/user_state`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({ user_key: key, state, updated_at: new Date().toISOString() }),
  }).then((r) => {
    if (!r.ok) throw new Error(`user_state import failed (${r.status})`);
  });
  states++;
}

console.log(`Imported: ${Object.keys(accounts).length} Google account(s), ${Object.keys(sessions).length} session(s), ${states} app state(s).`);
