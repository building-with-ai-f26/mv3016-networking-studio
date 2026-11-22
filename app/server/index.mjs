// Local API server for Networking Studio (port 8787). Started by `npm run dev` together with Vite.
// The AI key lives ONLY here (read from app/.env). The browser calls /api/... and never sees the key.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleCalendarEvents, handleCallback, handleDisconnect, handleMe, handleSignOut, handleStart, sessionEmail } from './google.mjs';
import { MAX_STATE_BYTES, readUserState, writeUserState } from './userState.mjs';
import { buildClassifyRequest, parseClassifyResponse, validateClassifyInput } from './classify.mjs';
import { buildExtractRequest, parseExtractResponse, validateExtractInput } from './extract.mjs';
import { checkRate, isAllowedOrigin, overBudget, recordSpend, usageSummary, visitorId } from './guard.mjs';
import { buildChatRequest, buildGeminiRequest, buildMoreQuestionsRequest, estimateCostUsd, parseChat, parseGeminiResponse, parseMoreQuestions, validateEventInput, validateFollowUp } from './brief.mjs';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
const loadEnv = () => existsSync(envPath) && process.loadEnvFile(envPath);
loadEnv();

// Render gives PORT and needs HOST=0.0.0.0. Locally: 127.0.0.1:8787 (nothing else on your network can reach it).
const PORT = Number(process.env.PORT || process.env.API_PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_HTTPS = (process.env.PUBLIC_URL ?? '').startsWith('https://');
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 4000);
// Paid-tier prices per 1M tokens, used to show "cost per run". Update them if you change the model.
const PRICES = {
  inputPerMillion: Number(process.env.GEMINI_PRICE_INPUT_PER_M || 0.3),
  outputPerMillion: Number(process.env.GEMINI_PRICE_OUTPUT_PER_M || 2.5),
};
const MAX_BODY_BYTES = 20_000;

// Pages may only load code from this site (plus PostHog analytics), can't be framed, and forms only go to Google sign-in.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://*.posthog.com",
  "connect-src 'self' https://*.posthog.com",
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
  "frame-ancestors 'none'",
].join('; ');

// Requests that change something must come from this app's own pages (blocks other websites from
// triggering AI calls or account actions with the visitor's cookie: CSRF).
const ALLOWED_ORIGINS = new Set(
  [process.env.PUBLIC_URL, 'http://localhost:5173', 'http://127.0.0.1:5173', `http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]
    .filter(Boolean)
    .map((u) => u.replace(/\/$/, '')),
);


// Browser security headers on every response.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  ...(PUBLIC_HTTPS ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
  res.end(JSON.stringify(body));
}

async function readJson(req, maxBytes = MAX_BODY_BYTES) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Request is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function handleBrief(req, res) {
  if (!process.env.GEMINI_API_KEY) loadEnv(); // picks up a key added while the server is running
  const key = process.env.GEMINI_API_KEY;
  if (!key) return send(res, 503, { error: 'GEMINI_API_KEY is missing in app/.env. Add it, then try again.' });
  let body;
  try {
    body = await readJson(req, 3_200_000); // room for an optional ~2 MB PDF
  } catch {
    return send(res, 400, { error: 'Invalid request (the file may be too large: max 2 MB).' });
  }
  const { event, error, attachment } = validateEventInput(body);
  if (error) return send(res, 400, { error });

  const started = Date.now();
  let r;
  try {
    // Up to 3 tries when Gemini is temporarily overloaded (503), waiting 2 s and then 4 s.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((ok) => setTimeout(ok, 2000 * attempt));
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(buildGeminiRequest(event, { model: MODEL, maxOutputTokens: MAX_OUTPUT_TOKENS, attachment })),
        signal: AbortSignal.timeout(60_000),
      });
      if (r.status !== 503) break;
    }
  } catch {
    return send(res, 502, { error: 'Could not reach the AI service. Check your internet connection.' });
  }
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    // Log only the status and Google's short message (never the key or the event details).
    console.error(`[api] Gemini error ${r.status}: ${data?.error?.status ?? ''} ${data?.error?.message ?? ''}`.slice(0, 300));
    const msg = r.status === 429 ? 'AI rate limit reached. Wait a minute and try again.' : `The AI service returned an error (${r.status}).`;
    return send(res, 502, { error: msg });
  }
  try {
    let { brief, usage } = parseGeminiResponse(data);
    // The brief promises 10 questions. If the model miscounted, ask once more (cheap) and keep the better answer.
    if (brief.questionCount < 10) {
      const r2 = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(buildGeminiRequest(event, { model: MODEL, maxOutputTokens: MAX_OUTPUT_TOKENS, attachment })),
        signal: AbortSignal.timeout(60_000),
      }).catch(() => null);
      let retry = null;
      if (r2?.ok) {
        try {
          retry = parseGeminiResponse(await r2.json());
        } catch {
          retry = null; // keep the first answer
        }
      }
      if (retry) {
        usage = { inputTokens: usage.inputTokens + retry.usage.inputTokens, outputTokens: usage.outputTokens + retry.usage.outputTokens };
        if (retry.brief.questionCount >= brief.questionCount) brief = retry.brief;
      }
    }
    delete brief.questionCount;
    const costUsd = estimateCostUsd(usage, PRICES);
    await recordSpend(costUsd);
    console.log(`[api] brief ok · ${MODEL} · ${usage.inputTokens} in / ${usage.outputTokens} out · $${costUsd.toFixed(5)} · ${Date.now() - started} ms`);
    return send(res, 200, { brief, usage, costUsd, model: MODEL, generatedAt: new Date().toISOString() });
  } catch (e) {
    return send(res, 502, { error: e instanceof Error ? e.message : 'Could not read the AI answer.' });
  }
}

/** AI step of the networking classifier (only for events the rules could not decide). */
async function handleClassify(req, res) {
  if (!process.env.GEMINI_API_KEY) return send(res, 503, { error: 'GEMINI_API_KEY is missing in app/.env.' });
  let body;
  try {
    body = await readJson(req);
  } catch {
    return send(res, 400, { error: 'Invalid request.' });
  }
  const { input, error } = validateClassifyInput(body);
  if (error) return send(res, 400, { error });
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify(buildClassifyRequest(input, { model: MODEL })),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      console.error(`[api] Gemini classify error ${r.status}: ${data?.error?.status ?? ''}`);
      // Pass 429 through so the browser knows to slow down.
      return send(res, r.status === 429 ? 429 : 502, { error: r.status === 429 ? 'AI rate limit reached.' : `AI error (${r.status}).` });
    }
    const { result, usage } = parseClassifyResponse(data);
    const costUsd = estimateCostUsd(usage, PRICES);
    await recordSpend(costUsd);
    console.log(`[api] classify ok · ${usage.inputTokens} in / ${usage.outputTokens} out · $${costUsd.toFixed(6)}`);
    return send(res, 200, { ...result, costUsd });
  } catch {
    return send(res, 502, { error: 'Could not classify this event.' });
  }
}

/** One Gemini call with up to 3 tries when Gemini is overloaded (503). Returns { ok, status, data }. */
async function gemini(body, timeoutMs = 60_000) {
  let r;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((ok) => setTimeout(ok, 2000 * attempt));
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.status !== 503) break;
  }
  const data = await r.json().catch(() => null);
  if (!r.ok) console.error(`[api] Gemini error ${r.status}: ${data?.error?.status ?? ''}`);
  return { ok: r.ok, status: r.status, data };
}

/** Reads a whole event with AI: people (name, role, company), companies and topic, with the source of each. */
async function handleExtract(req, res) {
  if (!process.env.GEMINI_API_KEY) return send(res, 503, { error: 'GEMINI_API_KEY is missing in app/.env.' });
  let body;
  try {
    body = await readJson(req);
  } catch {
    return send(res, 400, { error: 'Invalid request.' });
  }
  const { input, error } = validateExtractInput(body);
  if (error) return send(res, 400, { error });
  try {
    const { ok, status, data } = await gemini(buildExtractRequest(input, { model: MODEL }), 30_000);
    if (!ok) return send(res, status === 429 ? 429 : 502, { error: status === 429 ? 'AI rate limit reached.' : `AI error (${status}).` });
    const { result, usage } = parseExtractResponse(data, input);
    const costUsd = estimateCostUsd(usage, PRICES);
    await recordSpend(costUsd);
    console.log(`[api] extract ok · ${result.people.length} people · ${usage.inputTokens} in / ${usage.outputTokens} out · $${costUsd.toFixed(6)}`);
    return send(res, 200, { ...result, costUsd });
  } catch {
    return send(res, 502, { error: 'Could not read this event.' });
  }
}

/** Follow-ups on a brief: "Generate more questions" and the "Ask about this brief" chat. */
async function handleFollowUp(req, res, kind) {
  if (!process.env.GEMINI_API_KEY) return send(res, 503, { error: 'GEMINI_API_KEY is missing in app/.env.' });
  let body;
  try {
    body = await readJson(req, 100_000);
  } catch {
    return send(res, 400, { error: 'Invalid request.' });
  }
  const { input, error } = validateFollowUp(body);
  if (error) return send(res, 400, { error });
  try {
    const request = kind === 'questions' ? buildMoreQuestionsRequest(input, { model: MODEL }) : buildChatRequest(input, { model: MODEL });
    const { ok, status, data } = await gemini(request, 45_000);
    if (!ok) return send(res, status === 429 ? 429 : 502, { error: status === 429 ? 'AI rate limit reached. Wait a minute and try again.' : `The AI service returned an error (${status}).` });
    const out = kind === 'questions' ? parseMoreQuestions(data, input.existing) : parseChat(data);
    const costUsd = estimateCostUsd(out.usage, PRICES);
    await recordSpend(costUsd);
    console.log(`[api] ${kind} ok · ${out.usage.inputTokens} in / ${out.usage.outputTokens} out · $${costUsd.toFixed(5)}`);
    return send(res, 200, { ...out, costUsd, model: MODEL });
  } catch (e) {
    return send(res, 502, { error: e instanceof Error ? e.message : 'Could not read the AI answer.' });
  }
}

/**
 * Abuse protection before any paid AI call or data write: per-visitor rate limit (429) and the monthly AI budget.
 * Returns true when the request may go on; otherwise it has already answered 429.
 */
async function allowed(req, res, bucket, { ai = false } = {}) {
  let email = null;
  try {
    email = await sessionEmail(req);
  } catch {
    email = null;
  }
  // Demo visitors (no sign-in) get the stricter AI limits; every AI call also counts toward the app-wide ceiling.
  const own = email || !bucket.startsWith('ai') ? bucket : `${bucket}Anon`;
  const limited = checkRate(own, visitorId(req, email)) ?? (bucket.startsWith('ai') ? checkRate(`${bucket}Global`, 'all') : null);
  if (limited) {
    send(res, 429, { error: `Too many requests. Please wait ${Math.ceil(limited.retryAfterSec / 60)} min and try again.` }, { 'Retry-After': String(limited.retryAfterSec) });
    return false;
  }
  if (ai && (await overBudget())) {
    send(res, 429, { error: 'The monthly AI budget for this app has been reached. AI features are paused until next month.' });
    return false;
  }
  return true;
}

// ---- The built app (app/dist), served by this same server when it is deployed (one URL for everything) ----
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain' };

function serveApp(req, res, pathname) {
  if (!existsSync(DIST + 'index.html')) return false;
  // Only files inside dist/ (no "../" tricks). Unknown paths get index.html so the app's own routes work.
  let file = normalize(join(DIST, decodeURIComponent(pathname)));
  const found = file.startsWith(DIST) && existsSync(file) && !statSync(file).isDirectory();
  if (!found && pathname.startsWith('/assets/')) return send(res, 404, { error: 'Not found' }), true;
  if (!found) file = DIST + 'index.html';
  const isAsset = file.includes('/assets/');
  res.writeHead(200, {
    ...(file.endsWith('.html') ? { 'Content-Security-Policy': CSP } : {}),
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...SECURITY_HEADERS,
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
  return true;
}

const server = createServer(async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GEMINI_API_KEY) loadEnv(); // picks up keys added while running
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return send(res, 200, { ok: true, aiConfigured: Boolean(process.env.GEMINI_API_KEY), model: MODEL });
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? 'GET') && !isAllowedOrigin(req.headers, ALLOWED_ORIGINS)) {
    return send(res, 403, { error: 'Request from another website blocked.' });
  }
  if (req.method === 'GET' && url.pathname === '/api/usage') {
    // Only signed-in users see the app's AI spend.
    return (await sessionEmail(req).catch(() => null)) ? send(res, 200, await usageSummary()) : send(res, 401, { error: 'Not signed in.' });
  }
  if (req.method === 'POST' && url.pathname === '/api/brief') return (await allowed(req, res, 'ai', { ai: true })) && handleBrief(req, res);
  if (req.method === 'POST' && url.pathname === '/api/brief/questions') return (await allowed(req, res, 'ai', { ai: true })) && handleFollowUp(req, res, 'questions');
  if (req.method === 'POST' && url.pathname === '/api/brief/chat') return (await allowed(req, res, 'ai', { ai: true })) && handleFollowUp(req, res, 'chat');
  if (req.method === 'POST' && url.pathname === '/api/classify') return (await allowed(req, res, 'aiSmall', { ai: true })) && handleClassify(req, res);
  if (req.method === 'POST' && url.pathname === '/api/extract') return (await allowed(req, res, 'aiSmall', { ai: true })) && handleExtract(req, res);
  try {
    if (req.method === 'GET' && url.pathname === '/auth/google/start') return (await allowed(req, res, 'auth')) && (await handleStart(req, res, url));
    if (req.method === 'GET' && url.pathname === '/auth/google/callback') return await handleCallback(req, res, url);
    if (req.method === 'GET' && url.pathname === '/api/me') return send(res, 200, await handleMe(req));
    // Per-account app data: only for the signed-in user, never for anyone else.
    if (url.pathname === '/api/state') {
      const email = await sessionEmail(req);
      if (!email) return send(res, 401, { error: 'Not signed in.' });
      if (req.method === 'GET') return send(res, 200, { state: await readUserState(email) });
      if (req.method === 'PUT') {
        if (!(await allowed(req, res, 'write'))) return;
        try {
          await writeUserState(email, await readJson(req, MAX_STATE_BYTES));
          return send(res, 200, { ok: true });
        } catch (e) {
          return send(res, 400, { error: e instanceof Error ? e.message : 'Invalid state.' });
        }
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/calendar/events') {
      const [status, body] = await handleCalendarEvents(req);
      return send(res, status, body);
    }
    if (req.method === 'POST' && url.pathname === '/auth/signout') return send(res, 200, { ok: true }, { 'Set-Cookie': await handleSignOut(req) });
    if (req.method === 'POST' && url.pathname === '/auth/disconnect') return send(res, 200, { ok: true }, { 'Set-Cookie': await handleDisconnect(req) });
  } catch (e) {
    console.error('[api] error:', e instanceof Error ? e.message : 'unknown');
    return send(res, 500, { error: 'Server error.' });
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/auth/')) {
    try {
      if (serveApp(req, res, url.pathname)) return;
    } catch {
      return send(res, 400, { error: 'Bad request' });
    }
  }
  return send(res, 404, { error: 'Not found' });
});

// Locally: listen on localhost only, so nothing on your network can use your AI key. On Render: HOST=0.0.0.0.
server.listen(PORT, HOST, () => {
  console.log(`[api] listening on http://localhost:${PORT} · model ${MODEL} · AI key ${process.env.GEMINI_API_KEY ? 'found' : 'MISSING'}`);
});
