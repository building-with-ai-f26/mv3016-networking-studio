// Per-account app data (profile, AI briefs, classifications, added events, corrections), saved on the server.
// One JSON file per Google account in app/.data/users/ (git-ignored). The file name is a hash of the email,
// so the email itself is not visible in file names. This makes each AI brief a one-time cost per event and
// account, in any browser. In a cloud deployment this becomes a database table.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MAX_STATE_BYTES = 2_000_000;
const usersDir = () => fileURLToPath(new URL('../.data/users/', import.meta.url));

export function userFileName(email) {
  return createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex').slice(0, 32) + '.json';
}

export function readUserState(email) {
  try {
    return JSON.parse(readFileSync(usersDir() + userFileName(email), 'utf8'));
  } catch {
    return null; // no data yet: a new account
  }
}

export function writeUserState(email, state) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || state.version !== 1) throw new Error('Invalid state.');
  const text = JSON.stringify(state);
  if (text.length > MAX_STATE_BYTES) throw new Error('State is too large.');
  if (!existsSync(usersDir())) mkdirSync(usersDir(), { recursive: true });
  writeFileSync(usersDir() + userFileName(email), text, { mode: 0o600 });
}

export function deleteUserState(email) {
  rmSync(usersDir() + userFileName(email), { force: true });
}
