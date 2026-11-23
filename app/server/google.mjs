// Google sign-in + read-only Google Calendar, handled entirely by the local server.
// - The client secret and the tokens never reach the browser. The browser only gets an httpOnly session cookie.
// - Sessions and tokens are saved by store.mjs: in the Supabase database (encrypted) when it is configured,
//   otherwise in app/.data/ (git-ignored).
// - "Create account" asks once for name, email and read-only calendar. "Log in" only asks Google who you are;
//   the calendar access you already granted is reused, so you land directly in your session.
import { createHash, randomBytes } from 'node:crypto';
import { deleteAccount, deleteSession, deleteSessionsOf, deleteUserState, loadAccount, loadSession, saveAccount, saveSession } from './store.mjs';

// Locally the app is on :5173 and the server on :8787. Deployed, both live on PUBLIC_URL (e.g. https://….onrender.com).
const PUBLIC_URL = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
export const REDIRECT_URI = PUBLIC_URL ? `${PUBLIC_URL}/auth/google/callback` : 'http://localhost:8787/auth/google/callback';
export const APP_URL = PUBLIC_URL || 'http://localhost:5173';
const IDENTITY = ['openid', 'email', 'profile'];
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
// Gmail, asked only when the user clicks "Connect Gmail": read emails + create drafts and send them (never delete).
export const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const GMAIL_COMPOSE_SCOPE = 'https://www.googleapis.com/auth/gmail.compose';
export const SCOPES = {
  login: IDENTITY,
  signin: IDENTITY, // older name for login
  signup: [...IDENTITY, CALENDAR_SCOPE],
  calendar: [...IDENTITY, CALENDAR_SCOPE],
  gmail: [...IDENTITY, GMAIL_READ_SCOPE, GMAIL_COMPOSE_SCOPE],
};
const SESSION_COOKIE = 'ns_sid';
const STATE_COOKIE = 'ns_oauth_state';

// ---------- pure helpers (unit-tested) ----------

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function buildAuthUrl({ clientId, step, state, loginHint, codeChallenge }) {
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
  p.set('prompt', step === 'signup' || step === 'calendar' || step === 'gmail' ? 'consent' : 'select_account');
  if (loginHint) p.set('login_hint', loginHint);
  // PKCE: Google only hands out tokens to whoever holds the matching secret verifier (kept in an httpOnly cookie).
  if (codeChallenge) {
    p.set('code_challenge', codeChallenge);
    p.set('code_challenge_method', 'S256');
  }
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
    // Keep only the email's domain, so "Daniel Ortiz <dortiz@stripe.com>" becomes "Daniel Ortiz <email at stripe.com>".
    .replace(/[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g, 'email at $1')
    .replace(/https?:\/\/\S+|www\.\S+/gi, '[link removed]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[number removed]')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, 1500);
}

const domainOf = (email) => (String(email ?? '').split('@')[1] ?? '').toLowerCase();

/**
 * A name read from the email itself, when the part before "@" looks like a name: "hassan.khan" → "Hassan Khan",
 * "maria_lopez-ruiz" → "Maria Lopez Ruiz". Initials or ids ("hk123", "mv3016") give "". Only the name leaves the server.
 */
const GENERIC_MAILBOX = /^(info|events?|careers?|recruiting|recruiter|jobs|hr|admin|office|team|hello|contact|support|noreply|no|reply|calendar|club|board|students?|alumni|news|marketing|sales|help|mail)$/i;

export function nameFromEmail(email) {
  const local = String(email ?? '').split('@')[0].replace(/\+.*$/, '');
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 1 && /^[a-z\u00C0-\u017F]{3,}$/i.test(parts[0]) && !GENERIC_MAILBOX.test(parts[0])) parts.splice(0, 1, parts[0]); // first name only, e.g. "jordan"
  else if (parts.length < 2 || parts.length > 4 || parts.some((p) => !/^[a-z\u00C0-\u017F]{2,}$/i.test(p))) return '';
  if (parts.some((p) => GENERIC_MAILBOX.test(p))) return '';
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');
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
      // Never the full email: only the name Google shows next to it and the email's domain (for the company).
      .map((a) => ({ name: a.displayName || nameFromEmail(a.email), domain: domainOf(a.email), self: Boolean(a.self), organizer: Boolean(a.organizer), responseStatus: a.responseStatus ?? '' })),
    organizerName: e.organizer?.self ? '' : e.organizer?.displayName || nameFromEmail(e.organizer?.email),
    organizerDomain: e.organizer?.self ? '' : domainOf(e.organizer?.email),
    online: Boolean(e.hangoutLink || e.conferenceData) || /\b(zoom|google meet|microsoft teams|online)\b/i.test(cleanLocation(e.location ?? '')),
  };
}

// ---------- sessions ----------
// Session = { user, tokens } per browser cookie, saved by store.mjs. Kept in memory too, to avoid a database
// read on every request. Accounts (refresh token + scopes) survive sign out and are removed by Disconnect.
const cache = new Map(); // session id -> session
// Sessions end on the server after 30 days, even if the browser keeps the cookie.
export const SESSION_MAX_AGE_MS = 30 * 24 * 3600_000;
export const sessionExpired = (session, now = Date.now()) => !(Date.parse(session?.createdAt) + SESSION_MAX_AGE_MS > now);

function cookie(name, value, maxAgeSec) {
  // Secure (HTTPS only) when the app runs on a public https:// address.
  const secure = APP_URL.startsWith('https://') ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

async function getSession(req) {
  const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!sid || !/^[0-9a-f]{48}$/.test(sid)) return null;
  let session = cache.get(sid);
  if (!session) {
    session = await loadSession(sid);
    if (session) cache.set(sid, session);
  }
  if (session && sessionExpired(session)) {
    cache.delete(sid);
    await deleteSession(sid).catch(() => {});
    return null;
  }
  return session ? { sid, session } : null;
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
  const s = cache.get(sid);
  if (s.tokens.expiresAt - 60_000 > Date.now()) return s.tokens.accessToken;
  if (!s.tokens.refreshToken) throw new Error('expired');
  const { clientId, clientSecret } = config();
  const t = await tokenRequest({ client_id: clientId, client_secret: clientSecret, refresh_token: s.tokens.refreshToken, grant_type: 'refresh_token' });
  s.tokens.accessToken = t.access_token;
  s.tokens.expiresAt = Date.now() + t.expires_in * 1000;
  await saveSession(sid, s);
  return t.access_token;
}

// ---------- route handlers ----------

const redirect = (res, location, headers = {}) => {
  res.writeHead(302, { Location: location, ...headers });
  res.end();
};

export async function handleStart(req, res, url) {
  const { clientId, clientSecret } = config();
  if (!clientId || !clientSecret) return redirect(res, `${APP_URL}/login?google=not-configured`);
  const asked = url.searchParams.get('step');
  const step = asked === 'signup' || asked === 'calendar' || asked === 'gmail' ? asked : 'login';
  const state = `${step}.${randomBytes(16).toString('hex')}`;
  const verifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
  const current = await getSession(req);
  const hint = url.searchParams.get('login_hint') || current?.session.user.email;
  const loginHint = hint && hint.length <= 254 && /^[^@\s]+@[^@\s]+$/.test(hint) ? hint : undefined;
  redirect(res, buildAuthUrl({ clientId, step, state, loginHint, codeChallenge }), { 'Set-Cookie': cookie(STATE_COOKIE, `${state}~${verifier}`, 600) });
}

export async function handleCallback(req, res, url) {
  const [expected, verifier] = (parseCookies(req.headers.cookie)[STATE_COOKIE] ?? '').split('~');
  const state = url.searchParams.get('state') ?? '';
  const clear = cookie(STATE_COOKIE, '', 0);
  if (url.searchParams.get('error')) return redirect(res, `${APP_URL}/login?google=cancelled`, { 'Set-Cookie': clear });
  if (!expected || !verifier || state !== expected) return redirect(res, `${APP_URL}/login?google=error`, { 'Set-Cookie': clear });
  const { clientId, clientSecret } = config();
  try {
    const t = await tokenRequest({ client_id: clientId, client_secret: clientSecret, code: url.searchParams.get('code') ?? '', code_verifier: verifier, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' });
    const u = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` }, signal: AbortSignal.timeout(20_000) }).then((r) => r.json());
    const existing = await getSession(req);
    const email = u.email ?? '';
    if (!email || u.email_verified === false) throw new Error('no verified email');
    const same = existing && existing.session.user.email === email;
    const account = await loadAccount(email);
    // A fresh session id on every sign-in (the old one is deleted), so a cookie captured earlier stops working.
    const sid = randomBytes(24).toString('hex');
    if (existing) {
      cache.delete(existing.sid);
      await deleteSession(existing.sid).catch(() => {});
    }
    const prev = same ? existing.session.tokens : {};
    const refreshToken = t.refresh_token ?? account?.refreshToken ?? prev.refreshToken ?? null;
    // Everything this Google account has granted the app (calendar included, if granted when the account was created).
    const scope = [...new Set(`${t.scope ?? ''} ${refreshToken ? account?.scope ?? '' : ''}`.split(/\s+/).filter(Boolean))].join(' ');
    const tokenHasCalendar = (t.scope ?? '').includes(CALENDAR_SCOPE);
    const session = {
      createdAt: new Date().toISOString(),
      user: { email, name: u.name ?? u.given_name ?? '' },
      tokens: {
        accessToken: t.access_token,
        refreshToken,
        // If this token lacks the calendar but the account granted it before, refresh on first calendar call.
        expiresAt: scope.includes(CALENDAR_SCOPE) && !tokenHasCalendar ? 0 : Date.now() + t.expires_in * 1000,
        scope,
      },
    };
    cache.set(sid, session);
    await saveSession(sid, session);
    await saveAccount(email, { name: session.user.name, refreshToken, scope, createdAt: account?.createdAt ?? new Date().toISOString() });
    // After "Connect Gmail", go back to Settings; otherwise to the calendar.
    if (state.startsWith('gmail.')) {
      const ok = scope.includes(GMAIL_READ_SCOPE) && scope.includes(GMAIL_COMPOSE_SCOPE);
      return redirect(res, `${APP_URL}/settings?google=${ok ? 'gmail-connected' : 'gmail-missing'}`, { 'Set-Cookie': [clear, cookie(SESSION_COOKIE, sid, 60 * 60 * 24 * 30)] });
    }
    const step = scope.includes(CALENDAR_SCOPE) ? 'calendar-connected' : 'signed-in';
    const to = `${APP_URL}/calendar?google=${step}`;
    redirect(res, to, { 'Set-Cookie': [clear, cookie(SESSION_COOKIE, sid, 60 * 60 * 24 * 30)] });
  } catch (e) {
    console.error('[auth] Google sign-in failed:', e instanceof Error ? e.message : 'unknown');
    redirect(res, `${APP_URL}/login?google=error`, { 'Set-Cookie': clear });
  }
}

/** Email of the signed-in user for this request, or null. */
export async function sessionEmail(req) {
  return (await getSession(req))?.session.user.email || null;
}

export async function handleMe(req) {
  const { clientId, clientSecret } = config();
  const s = await getSession(req);
  return {
    configured: Boolean(clientId && clientSecret),
    signedIn: Boolean(s),
    email: s?.session.user.email ?? null,
    name: s?.session.user.name ?? null,
    calendarConnected: Boolean(s?.session.tokens.scope.includes(CALENDAR_SCOPE)),
    gmailConnected: Boolean(s?.session.tokens.scope.includes(GMAIL_READ_SCOPE) && s?.session.tokens.scope.includes(GMAIL_COMPOSE_SCOPE)),
  };
}

/**
 * A valid Google access token for this request's user, if they granted `scopes`.
 * Returns { token } or { status, error } (401 not signed in / expired, 403 permission not granted).
 */
export async function googleAccess(req, scopes) {
  const s = await getSession(req);
  if (!s) return { status: 401, error: 'Not signed in.' };
  if (!scopes.every((x) => s.session.tokens.scope.includes(x))) return { status: 403, error: 'Gmail is not connected. Connect it in Settings.' };
  try {
    return { token: await validAccessToken(s.sid), email: s.session.user.email, name: s.session.user.name };
  } catch {
    return { status: 401, error: 'Your Google session expired. Log in again.' };
  }
}

export async function handleCalendarEvents(req) {
  const s = await getSession(req);
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
export async function handleSignOut(req) {
  const s = await getSession(req);
  if (s) {
    cache.delete(s.sid);
    await deleteSession(s.sid);
  }
  return cookie(SESSION_COOKIE, '', 0);
}

/** Disconnect: revoke the app's access at Google and forget the session and the account (you would create it again). */
export async function handleDisconnect(req) {
  const s = await getSession(req);
  if (s) {
    const t = s.session.tokens.refreshToken ?? s.session.tokens.accessToken;
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: t }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
    const email = s.session.user.email;
    await deleteAccount(email);
    await deleteUserState(email); // Disconnect removes the account's app data too
    await deleteSessionsOf(email);
    for (const [sid, x] of cache) if (x.user.email === email) cache.delete(sid);
  }
  return cookie(SESSION_COOKIE, '', 0);
}
