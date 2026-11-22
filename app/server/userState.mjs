// Per-account app data (profile, AI briefs, classifications, added events, corrections), saved on the server.
// Stored by store.mjs: one row per account in the Supabase table user_state (keyed by a hash of the email),
// or one file per account in app/.data/users/ when no database is configured.
import * as store from './store.mjs';

export const MAX_STATE_BYTES = 2_000_000;

export const readUserState = (email) => store.readUserState(email);

export async function writeUserState(email, state) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || state.version !== 1) throw new Error('Invalid state.');
  if (JSON.stringify(state).length > MAX_STATE_BYTES) throw new Error('State is too large.');
  await store.writeUserState(email, state);
}

export const deleteUserState = (email) => store.deleteUserState(email);
