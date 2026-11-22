// Abuse protection for every route that calls a paid API (Gemini) or writes data.
// 1) Per-visitor rate limits: after N calls in a time window the server answers 429 "Too many requests".
//    A visitor is the signed-in account (email hash) or, without sign-in, the IP address.
// 2) A monthly AI budget for the whole app: once the estimated spend reaches AI_MONTHLY_BUDGET_USD,
//    every AI route answers 429 until the next month. The spend is saved so a restart does not reset it.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
};

const hits = new Map(); // `${bucket}:${visitor}` -> array of timestamps

/** Who is calling: the signed-in account if any (hashed, never the raw email), otherwise the IP. */
export function visitorId(req, email) {
  if (email) return 'u:' + createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16);
  // Behind Render's proxy the real IP is the first entry of x-forwarded-for.
  const fwd = process.env.TRUST_PROXY === '1' ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
  return 'ip:' + (fwd || req.socket?.remoteAddress || 'unknown');
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
const usagePath = () => fileURLToPath(new URL('../.data/ai-usage.json', import.meta.url));
const monthKey = (d = new Date()) => d.toISOString().slice(0, 7); // "2026-11"
let usage = null;

/** Pluggable storage so the budget can live in the database once it is connected. */
export const usageStore = {
  async load() {
    try {
      return existsSync(usagePath()) ? JSON.parse(readFileSync(usagePath(), 'utf8')) : null;
    } catch {
      return null;
    }
  },
  async save(u) {
    mkdirSync(dirname(usagePath()), { recursive: true });
    writeFileSync(usagePath(), JSON.stringify(u));
  },
};

async function current() {
  if (!usage) usage = (await usageStore.load()) ?? { month: monthKey(), costUsd: 0, calls: 0 };
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
