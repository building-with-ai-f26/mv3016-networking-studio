// Abuse protection for every route that calls a paid API (Gemini) or writes data.
// 1) Per-visitor rate limits: after N calls in a time window the server answers 429 "Too many requests".
//    A visitor is the signed-in account (email hash) or, without sign-in, the IP address. Visitors without
//    sign-in (demo mode) get lower AI limits, and all visitors together share an hourly AI ceiling, so
//    rotating IP addresses can't burn through the budget in minutes.
// 2) A monthly AI budget for the whole app: once the estimated spend reaches AI_MONTHLY_BUDGET_USD,
//    every AI route answers 429 until the next month. The spend is saved so a restart does not reset it.
import { createHash } from 'node:crypto';
import { loadUsage, saveUsage } from './store.mjs';

/** Limits per visitor. `max` calls per `windowMs`. Kept below 30 so a burst of 30 calls is always stopped. */
export const LIMITS = {
  // Full AI briefs, "more questions" and chat: the expensive calls.
  ai: { max: 20, windowMs: 60 * 60_000 },
  // Classifier and event reader: small calls, one per calendar event, so a higher limit.
  aiSmall: { max: 120, windowMs: 60 * 60_000 },
  // Saving app data (debounced in the browser).
  write: { max: 60, windowMs: 60_000 },
  // Google sign-in starts (stops login spam).
  auth: { max: 20, windowMs: 10 * 60_000 },
  // Web search (Gemini + Google Search): each call runs paid searches.
  aiSearch: { max: 10, windowMs: 60 * 60_000 },
  // Without sign-in (demo mode, identified by IP): stricter.
  aiSearchAnon: { max: 3, windowMs: 60 * 60_000 },
  aiAnon: { max: 10, windowMs: 60 * 60_000 },
  aiSmallAnon: { max: 60, windowMs: 60 * 60_000 },
  // Whole app, all visitors together (backstop against many IPs).
  aiGlobal: { max: 300, windowMs: 60 * 60_000 },
  aiSmallGlobal: { max: 1500, windowMs: 60 * 60_000 },
  aiSearchGlobal: { max: 100, windowMs: 60 * 60_000 },
};
const MAX_TRACKED = 20_000; // visitors kept in memory at most

const hits = new Map(); // `${bucket}:${visitor}` -> array of timestamps

/** Who is calling: the signed-in account if any (hashed, never the raw email), otherwise the IP. */
export function visitorId(req, email) {
  if (email) return 'u:' + createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16);
  return 'ip:' + clientIp(req);
}

/**
 * The caller's IP. Behind Render (TRUST_PROXY=1) the socket is Render's proxy, so read the headers the proxy sets.
 * Never the FIRST x-forwarded-for entry: the visitor can write that one themselves to dodge the limits.
 * Order: CF-Connecting-IP / True-Client-IP (set by Render's Cloudflare edge, overwriting what the visitor sent),
 * then the LAST x-forwarded-for entry (added by the proxy).
 */
export function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const h = req.headers ?? {};
    const one = (v) => String(Array.isArray(v) ? v[0] : (v ?? '')).trim();
    const ip = one(h['cf-connecting-ip']) || one(h['true-client-ip']) || one(h['x-forwarded-for']).split(',').pop().trim();
    if (ip) return ip.slice(0, 64);
  }
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * CSRF guard for requests that change something: the browser's Origin must be one of this app's own addresses.
 * No Origin header (curl, server-to-server): allowed unless the browser marks it cross-site.
 */
export function isAllowedOrigin(headers, allowed) {
  const origin = headers.origin;
  if (origin) return allowed.has(origin);
  return headers['sec-fetch-site'] !== 'cross-site';
}

/** Returns null when allowed, or { retryAfterSec } when the visitor is over the limit. */
export function checkRate(bucket, visitor, now = Date.now()) {
  const { max, windowMs } = LIMITS[bucket];
  const key = `${bucket}:${visitor}`;
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    hits.set(key, list);
    return { retryAfterSec: Math.max(1, Math.ceil((list[0] + windowMs - now) / 1000)) };
  }
  list.push(now);
  if (!hits.has(key) && hits.size >= MAX_TRACKED) hits.delete(hits.keys().next().value); // drop the oldest visitor
  hits.set(key, list);
  return null;
}

/** For tests. */
export function resetRates() {
  hits.clear();
}

// Forget idle visitors every 10 minutes so memory does not grow.
setInterval(() => {
  const now = Date.now();
  for (const [key, list] of hits) {
    const bucket = key.split(':')[0];
    if (!list.some((t) => now - t < LIMITS[bucket].windowMs)) hits.delete(key);
  }
}, 10 * 60_000).unref();

// ---- Monthly AI budget ----
const monthKey = (d = new Date()) => d.toISOString().slice(0, 7); // "2026-11"
let usage = null;

/** Where the monthly total is saved: the database when configured (store.mjs), else a local file. */
export const usageStore = {
  load: (month) => loadUsage(month),
  save: (u) => saveUsage(u),
};

async function current() {
  if (!usage) usage = (await usageStore.load(monthKey()).catch(() => null)) ?? { month: monthKey(), costUsd: 0, calls: 0 };
  if (usage.month !== monthKey()) usage = { month: monthKey(), costUsd: 0, calls: 0 };
  return usage;
}

export const budgetUsd = () => Number(process.env.AI_MONTHLY_BUDGET_USD || 5);

/** True when this month's estimated AI spend has reached the budget. */
export async function overBudget() {
  return (await current()).costUsd >= budgetUsd();
}

/** Adds the cost of one AI call to this month's total. */
export async function recordSpend(costUsd) {
  const u = await current();
  u.costUsd = Math.round((u.costUsd + (Number(costUsd) || 0)) * 1e6) / 1e6;
  u.calls += 1;
  try {
    await usageStore.save(u);
  } catch {
    // keep counting in memory if saving fails
  }
}

export async function usageSummary() {
  const u = await current();
  return { month: u.month, spentUsd: u.costUsd, calls: u.calls, budgetUsd: budgetUsd() };
}

/** For tests. */
export function resetUsage(u = null) {
  usage = u;
}
