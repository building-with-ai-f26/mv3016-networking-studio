// Google sign-in + read-only Google Calendar, handled entirely by the local server.
// - The client secret and the tokens never reach the browser. The browser only gets an httpOnly session cookie.
// - Sessions and tokens are saved only on this computer, in app/.data/ (git-ignored). It is outside server/
//   on purpose: `npm run dev` restarts the server when files in server/ change.
// - "Create account" asks once for name, email and read-only calendar. "Log in" only asks Google who you are;
//   the calendar access you already granted is reused, so you land directly in your session.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deleteUserState } from './userState.mjs';

export const REDIRECT_URI = 'http://localhost:8787/auth/google/callback';
export const APP_URL = 'http://localhost:5173';
const IDENTITY = ['openid', 'email', 'profile'];
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
export const SCOPES = {
  login: IDENTITY,
  signin: IDENTITY, // older name for login
  signup: [...IDENTITY, CALENDAR_SCOPE],
  calendar: [...IDENTITY, CALENDAR_SCOPE],
};
const SESSION_COOKIE = 'ns_sid';
const STATE_COOKIE = 'ns_oauth_state';
// Resolved lazily so the pure helpers can be imported by tests.
const dataDir = () => fileURLToPath(new URL('../.data/', import.meta.url));
const sessionsFile = () => dataDir() + 'sessions.json';
const accountsFile = () => dataDir() + 'accounts.json';

// ---------- pure helpers (unit-tested) ----------

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function buildAuthUrl({ clientId, step, state, loginHint }) {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES[step].join(' '),
    state,
    include_granted_scopes: 'true', // log in reuses the calendar access granted when the account was created
    access_type: 'offline', // refresh token, so the calendar keeps loading after 1 hour
  });
  // Create account / connect calendar: show the permission screen. Log in: just pick the account.
  p.set('prompt', step === 'signup' || step === 'calendar' ? 'consent' : 'select_account');
  if (loginHint) p.set('login_hint', loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

/** Description without HTML, emails, links or phone numbers, max 1500 characters. */
export function cleanDescription(text = '') {
  return text
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email removed]')
    .replace(/https?:\/\/\S+|www\.\S+/gi, '[link removed]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[number removed]')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, 1500);
}

/** Location without meeting links or passwords: a Zoom/Meet/Teams URL becomes "Zoom", "Google Meet", "Microsoft Teams" or "Online". */
export function cleanLocation(text = '') {
  const t = text.trim();
  const online = (u) => (/zoom\./i.test(u) ? 'Zoom' : /meet\.google/i.test(u) ? 'Google Meet' : /teams\.(microsoft|live)/i.test(u) ? 'Microsoft Teams' : 'Online');
  const urls = t.match(/https?:\/\/\S+|www\.\S+/gi) ?? [];
  const rest = t.replace(/https?:\/\/\S+|www\.\S+/gi, ' ').replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, ' ').replace(/[\s,;|]+/g, ' ').trim();
  const labels = [...new Set(urls.map(online))];
  return [rest, ...labels].filter(Boolean).join(' · ').slice(0, 120);
}

/** Keeps only what the app needs from a Google Calendar event (cleaned description and location, no meeting links). */
export function mapCalendarEvent(e) {
  const allDay = Boolean(e.start?.date && !e.start?.dateTime);
  const self = (e.attendees ?? []).find((a) => a.self);
  return {
    id: e.id,
    title: e.summary ?? '(No title)',
    start: e.start?.dateTime ?? e.start?.date ?? '',
    end: e.end?.dateTime ?? e.end?.date ?? '',
    allDay,
    location: cleanLocation(e.location ?? ''),
    description: cleanDescription(e.description ?? ''),
    eventType: e.eventType ?? 'default',
    recurringEventId: e.recurringEventId ?? null,
    status: e.status ?? 'confirmed',
    selfResponse: self?.responseStatus ?? null,
    attendees: (e.attendees ?? [])
      .filter((a) => !a.resource)
      .map((a) => ({ email: a.email ?? '', name: a.displayName ?? '', self: Boolean(a.self), organizer: Boolean(a.organizer), responseStatus: a.responseStatus ?? '' })),
  };
}

// ---------- session store (local file) ----------

let sessions = null; // browser session id -> { user, tokens }
let accounts = null; // email -> { name, refreshToken, scope, createdAt }: survives sign out, removed by Disconnect
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}
const loadSessions = () => readJson(sessionsFile());
function persist() {
  if (!existsSync(dataDir())) mkdirSync(dataDir(), { recursive: true });
  writeFileSync(sessionsFile(), JSON.stringify(sessions, null, 2), { mode: 0o600 });
  if (accounts) writeFileSync(accountsFile(), JSON.stringify(accounts, null, 2), { mode: 0o600 });
}

function cookie(name, value, maxAgeSec) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

function getSession(req) {
  sessions ??= loadSessions();
  const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  return sid && sessions[sid] ? { sid, session: sessions[sid] } : null;
}

const config = () => ({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET });

async function tokenRequest(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`token ${r.status} ${data.error ?? ''}`);
  return data;
}

async function validAccessToken(sid) {
  const s = sessions[sid];
  if (s.tokens.expiresAt - 60_000 > Date.now()) return s.tokens.accessToken;
  if (!s.tokens.refreshToken) throw new Error('expired');
  const { clientId, clientSecret } = config();
  const t = await tokenRequest({ client_id: clientId, client_secret: clientSecret, refresh_token: s.tokens.refreshToken, grant_type: 'refresh_token' });
  s.tokens.accessToken = t.access_token;
  s.tokens.expiresAt = Date.now() + t.expires_in * 1000;
  persist();
  return t.access_token;
}

// ---------- route handlers ----------

const redirect = (res, location, headers = {}) => {
  res.writeHead(302, { Location: location, ...headers });
  res.end();
};

export function handleStart(req, res, url) {
  const { clientId, clientSecret } = config();
  if (!clientId || !clientSecret) return redirect(res, `${APP_URL}/login?google=not-configured`);
  const asked = url.searchParams.get('step');
  const step = asked === 'signup' || asked === 'calendar' ? asked : 'login';
  const state = `${step}.${randomBytes(16).toString('hex')}`;
  const current = getSession(req);
  const hint = url.searchParams.get('login_hint') || current?.session.user.email;
  redirect(res, buildAuthUrl({ clientId, step, state, loginHint: hint && /^[^@\s]+@[^@\s]+$/.test(hint) ? hint : undefined }), { 'Set-Cookie': cookie(STATE_COOKIE, state, 600) });
}

export async function handleCallback(req, res, url) {
  const expected = parseCookies(req.headers.cookie)[STATE_COOKIE];
  const state = url.searchParams.get('state') ?? '';
  const clear = cookie(STATE_COOKIE, '', 0);
  if (url.searchParams.get('error')) return redirect(res, `${APP_URL}/login?google=cancelled`, { 'Set-Cookie': clear });
  if (!expected || state !== expected) return redirect(res, `${APP_URL}/login?google=error`, { 'Set-Cookie': clear });
  const { clientId, clientSecret } = config();
  try {
    const t = await tokenRequest({ client_id: clientId, client_secret: clientSecret, code: url.searchParams.get('code') ?? '', redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' });
    const u = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } }).then((r) => r.json());
    const existing = getSession(req); // also loads the session file
    accounts ??= readJson(accountsFile());
    const email = u.email ?? '';
    const account = accounts[email];
    const sid = existing?.sid ?? randomBytes(24).toString('hex');
    const prev = sessions[sid]?.tokens ?? {};
    const refreshToken = t.refresh_token ?? account?.refreshToken ?? prev.refreshToken ?? null;
    // Everything this Google account has granted the app (calendar included, if granted when the account was created).
    const scope = [...new Set(`${t.scope ?? ''} ${refreshToken ? account?.scope ?? '' : ''}`.split(/\s+/).filter(Boolean))].join(' ');
    const tokenHasCalendar = (t.scope ?? '').includes(CALENDAR_SCOPE);
    sessions[sid] = {
      createdAt: sessions[sid]?.createdAt ?? new Date().toISOString(),
      user: { email, name: u.name ?? u.given_name ?? '' },
      tokens: {
        accessToken: t.access_token,
        refreshToken,
        // If this token lacks the calendar but the account granted it before, refresh on first calendar call.
        expiresAt: scope.includes(CALENDAR_SCOPE) && !tokenHasCalendar ? 0 : Date.now() + t.expires_in * 1000,
        scope,
      },
    };
    accounts[email] = { name: sessions[sid].user.name, refreshToken, scope, createdAt: account?.createdAt ?? new Date().toISOString() };
    persist();
    const step = scope.includes(CALENDAR_SCOPE) ? 'calendar-connected' : 'signed-in';
    const to = `${APP_URL}/calendar?google=${step}`;
    redirect(res, to, { 'Set-Cookie': [clear, cookie(SESSION_COOKIE, sid, 60 * 60 * 24 * 30)] });
  } catch (e) {
    console.error('[auth] Google sign-in failed:', e instanceof Error ? e.message : 'unknown');
    redirect(res, `${APP_URL}/login?google=error`, { 'Set-Cookie': clear });
  }
}

/** Email of the signed-in user for this request, or null. */
export function sessionEmail(req) {
  return getSession(req)?.session.user.email || null;
}

export function handleMe(req) {
  const { clientId, clientSecret } = config();
  const s = getSession(req);
  return {
    configured: Boolean(clientId && clientSecret),
    signedIn: Boolean(s),
    email: s?.session.user.email ?? null,
    name: s?.session.user.name ?? null,
    calendarConnected: Boolean(s?.session.tokens.scope.includes(CALENDAR_SCOPE)),
  };
}

export async function handleCalendarEvents(req) {
  const s = getSession(req);
  if (!s) return [401, { error: 'Not signed in.' }];
  if (!s.session.tokens.scope.includes(CALENDAR_SCOPE)) return [403, { error: 'Calendar not connected.' }];
  let token;
  try {
    token = await validAccessToken(s.sid);
  } catch {
    return [401, { error: 'Your Google session expired. Connect the calendar again.' }];
  }
  const now = new Date();
  // Past days to include (default 7, so last week can be reviewed). Set CALENDAR_PAST_DAYS=0 in app/.env to show only upcoming events.
  const pastDays = Math.max(0, Math.min(31, Number(process.env.CALENDAR_PAST_DAYS ?? 7)));
  const p = new URLSearchParams({
    timeMin: new Date(now.getTime() - pastDays * 24 * 3600_000).toISOString(),
    timeMax: new Date(now.getTime() + 14 * 24 * 3600_000).toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  });
  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${p}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error(`[calendar] Google Calendar error ${r.status}`);
    return [502, { error: `Google Calendar returned an error (${r.status}).` }];
  }
  return [200, { events: (data.items ?? []).filter((e) => e.status !== 'cancelled').map(mapCalendarEvent), loadedAt: now.toISOString() }];
}

/** Sign out: forget the session on this computer (Google access stays granted). */
export function handleSignOut(req) {
  const s = getSession(req);
  if (s) {
    delete sessions[s.sid];
    persist();
  }
  return cookie(SESSION_COOKIE, '', 0);
}

/** Disconnect: revoke the app's access at Google and forget the session and the account (you would create it again). */
export async function handleDisconnect(req) {
  const s = getSession(req);
  if (s) {
    const t = s.session.tokens.refreshToken ?? s.session.tokens.accessToken;
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t)}`, { method: 'POST', signal: AbortSignal.timeout(10_000) }).catch(() => {});
    accounts ??= readJson(accountsFile());
    delete accounts[s.session.user.email];
    deleteUserState(s.session.user.email); // Disconnect removes the account's app data too
    for (const [sid, x] of Object.entries(sessions)) if (x.user.email === s.session.user.email) delete sessions[sid];
    persist();
  }
  return cookie(SESSION_COOKIE, '', 0);
}
