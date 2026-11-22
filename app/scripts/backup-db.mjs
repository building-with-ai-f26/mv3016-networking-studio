// Manual database backup (Supabase free plan has no automatic backups).
// Run from app/: node scripts/backup-db.mjs → app/.data/backups/db-<date>.json (git-ignored, stays on this computer).
// Tokens and sessions stay encrypted in the file; prints only row counts.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY missing in app/.env');
const tables = ['user_state', 'app_sessions', 'google_accounts', 'ai_usage'];
const out = { createdAt: new Date().toISOString(), tables: {} };
for (const t of tables) {
  const r = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${t}?select=*`, { headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` } });
  if (!r.ok) throw new Error(`${t}: ${r.status}`);
  out.tables[t] = await r.json();
}
const dir = fileURLToPath(new URL('../.data/backups/', import.meta.url));
mkdirSync(dir, { recursive: true });
const file = `${dir}db-${out.createdAt.slice(0, 19).replace(/:/g, '-')}.json`;
writeFileSync(file, JSON.stringify(out), { mode: 0o600 });
console.log('Backup saved:', file.split('/app/')[1], Object.fromEntries(tables.map((t) => [t, out.tables[t].length])));
