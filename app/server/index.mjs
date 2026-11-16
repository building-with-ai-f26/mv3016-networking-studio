// Local API server for Networking Studio (port 8787). Started by `npm run dev` together with Vite.
// The AI key lives ONLY here (read from app/.env). The browser calls /api/... and never sees the key.
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildGeminiRequest, estimateCostUsd, parseGeminiResponse, validateEventInput } from './brief.mjs';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

const PORT = Number(process.env.API_PORT || 8787);
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 2500);
// Paid-tier prices per 1M tokens, used to show "cost per run". Update them if you change the model.
const PRICES = {
  inputPerMillion: Number(process.env.GEMINI_PRICE_INPUT_PER_M || 0.1),
  outputPerMillion: Number(process.env.GEMINI_PRICE_OUTPUT_PER_M || 0.4),
};
const MAX_BODY_BYTES = 20_000;

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function handleBrief(req, res) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return send(res, 503, { error: 'GEMINI_API_KEY is missing in app/.env. Add it and restart npm run dev.' });
  let body;
  try {
    body = await readJson(req);
  } catch {
    return send(res, 400, { error: 'Invalid request.' });
  }
  const { event, error } = validateEventInput(body);
  if (error) return send(res, 400, { error });

  const started = Date.now();
  let r;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(buildGeminiRequest(event, { model: MODEL, maxOutputTokens: MAX_OUTPUT_TOKENS })),
      signal: AbortSignal.timeout(60_000),
    });
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
    const { brief, usage } = parseGeminiResponse(data);
    const costUsd = estimateCostUsd(usage, PRICES);
    console.log(`[api] brief ok · ${MODEL} · ${usage.inputTokens} in / ${usage.outputTokens} out · $${costUsd.toFixed(5)} · ${Date.now() - started} ms`);
    return send(res, 200, { brief, usage, costUsd, model: MODEL, generatedAt: new Date().toISOString() });
  } catch (e) {
    return send(res, 502, { error: e instanceof Error ? e.message : 'Could not read the AI answer.' });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return send(res, 200, { ok: true, aiConfigured: Boolean(process.env.GEMINI_API_KEY), model: MODEL });
  }
  if (req.method === 'POST' && url.pathname === '/api/brief') return handleBrief(req, res);
  return send(res, 404, { error: 'Not found' });
});

// Listen on localhost only, so nothing on your network can use your AI key.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[api] listening on http://localhost:${PORT} · model ${MODEL} · AI key ${process.env.GEMINI_API_KEY ? 'found' : 'MISSING'}`);
});
