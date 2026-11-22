// Encryption for secrets the server must keep (Google refresh tokens, sessions) before they go to the database.
// AES-256-GCM with TOKEN_ENCRYPTION_KEY (32 random bytes, base64) from app/.env or the host's settings.
// A database leak alone does not reveal the tokens: the key never goes to the database.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function key() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  const k = raw ? Buffer.from(raw, 'base64') : null;
  if (!k || k.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY is missing or invalid (needs 32 bytes, base64).');
  return k;
}

export function encrypt(value) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function decrypt(text) {
  const [v, iv, tag, data] = String(text).split(':');
  if (v !== 'v1') throw new Error('Unknown encrypted format.');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8'));
}
