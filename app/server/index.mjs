// Local API server for Networking Studio (port 8787). Started by `npm run dev` together with Vite.
// The AI key lives ONLY here (read from app/.env). The browser calls /api/... and never sees the key.
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handleCalendarEvents, handleCallback, handleDisconnect, handleMe, handleSignOut, handleStart, sessionEmail } from './google.mjs';
import { MAX_STATE_BYTES, readUserState, writeUserState } from './userState.mjs';
import { buildClassifyRequest, parseClassifyResponse, validateClassifyInput } from './classify.mjs';
import { buildChatRequest, buildGeminiRequest, buildMoreQuestionsRequest, estimateCostUsd, parseChat, parseGeminiResponse, parseMoreQuestions, validateEventInput, validateFollowUp } from './brief.mjs';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
const loadEnv = () => existsSync(envPath) && process.loadEnvFile(envPath);
loadEnv();

const PORT = Number(process.env.API_PORT || 8787);
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 4000);
// Paid-tier prices per 1M tokens, used to show "cost per run". Update them if you change the model.
const PRICES = {
  inputPerMillion: Number(process.env.GEMINI_PRICE_INPUT_PER_M || 0.3),
  outputPerMillion: Number(process.env.GEMINI_PRICE_OUTPUT_PER_M || 2.5),
};
const MAX_BODY_BYTES = 20_000;

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
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
    console.log(`[api] ${kind} ok · ${out.usage.inputTokens} in / ${out.usage.outputTokens} out · $${costUsd.toFixed(5)}`);
    return send(res, 200, { ...out, costUsd, model: MODEL });
  } catch (e) {
    return send(res, 502, { error: e instanceof Error ? e.message : 'Could not read the AI answer.' });
  }
}

const server = createServer(async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GEMINI_API_KEY) loadEnv(); // picks up keys added while running
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return send(res, 200, { ok: true, aiConfigured: Boolean(process.env.GEMINI_API_KEY), model: MODEL });
  }
  if (req.method === 'POST' && url.pathname === '/api/brief') return handleBrief(req, res);
  if (req.method === 'POST' && url.pathname === '/api/brief/questions') return handleFollowUp(req, res, 'questions');
  if (req.method === 'POST' && url.pathname === '/api/brief/chat') return handleFollowUp(req, res, 'chat');
  if (req.method === 'POST' && url.pathname === '/api/classify') return handleClassify(req, res);
  try {
    if (req.method === 'GET' && url.pathname === '/auth/google/start') return handleStart(req, res, url);
    if (req.method === 'GET' && url.pathname === '/auth/google/callback') return await handleCallback(req, res, url);
    if (req.method === 'GET' && url.pathname === '/api/me') return send(res, 200, handleMe(req));
    // Per-account app data: only for the signed-in user, never for anyone else.
    if (url.pathname === '/api/state') {
      const email = sessionEmail(req);
      if (!email) return send(res, 401, { error: 'Not signed in.' });
      if (req.method === 'GET') return send(res, 200, { state: readUserState(email) });
      if (req.method === 'PUT') {
        try {
          writeUserState(email, await readJson(req, MAX_STATE_BYTES));
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
    if (req.method === 'POST' && url.pathname === '/auth/signout') return send(res, 200, { ok: true }, { 'Set-Cookie': handleSignOut(req) });
    if (req.method === 'POST' && url.pathname === '/auth/disconnect') return send(res, 200, { ok: true }, { 'Set-Cookie': await handleDisconnect(req) });
  } catch (e) {
    console.error('[api] error:', e instanceof Error ? e.message : 'unknown');
    return send(res, 500, { error: 'Server error.' });
  }
  return send(res, 404, { error: 'Not found' });
});

// Listen on localhost only, so nothing on your network can use your AI key.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[api] listening on http://localhost:${PORT} · model ${MODEL} · AI key ${process.env.GEMINI_API_KEY ? 'found' : 'MISSING'}`);
});
