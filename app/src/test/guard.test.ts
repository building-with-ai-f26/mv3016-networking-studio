import { afterEach, describe, expect, it } from 'vitest';
import { budgetUsd, checkRate, LIMITS, overBudget, recordSpend, resetRates, resetUsage, usageStore, visitorId } from '../../server/guard.mjs';

describe('Abuse protection (server)', () => {
  afterEach(() => {
    resetRates();
    resetUsage();
  });

  it('30 AI calls in a row: the limit kicks in and returns a retry time', () => {
    const results = Array.from({ length: 30 }, () => checkRate('ai', 'ip:1.2.3.4'));
    const blocked = results.filter(Boolean);
    expect(results.slice(0, LIMITS.ai.max).every((r) => r === null)).toBe(true);
    expect(blocked.length).toBe(30 - LIMITS.ai.max);
    expect(blocked[0]!.retryAfterSec).toBeGreaterThan(0);
  });

  it('limits are per visitor and reset after the window', () => {
    for (let i = 0; i < LIMITS.ai.max; i++) checkRate('ai', 'ip:A', 0);
    expect(checkRate('ai', 'ip:A', 1000)).not.toBeNull();
    expect(checkRate('ai', 'ip:B', 1000)).toBeNull();
    expect(checkRate('ai', 'ip:A', LIMITS.ai.windowMs + 1)).toBeNull();
  });

  it('identifies signed-in visitors by a hash, never the raw email', () => {
    const id = visitorId({ headers: {}, socket: {} }, 'student@example.com');
    expect(id).toMatch(/^u:[0-9a-f]{16}$/);
    expect(id).not.toContain('student');
  });

  it('stops all AI once the monthly budget is spent', async () => {
    const saved: unknown[] = [];
    usageStore.save = async (u: unknown) => void saved.push(u);
    resetUsage({ month: new Date().toISOString().slice(0, 7), costUsd: budgetUsd() - 0.001, calls: 10 });
    expect(await overBudget()).toBe(false);
    await recordSpend(0.002);
    expect(await overBudget()).toBe(true);
    expect(saved.length).toBe(1);
  });
});
