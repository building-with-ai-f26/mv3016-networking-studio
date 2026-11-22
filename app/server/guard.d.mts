export type Bucket = 'ai' | 'aiSmall' | 'write' | 'auth';
export const LIMITS: Record<Bucket, { max: number; windowMs: number }>;
export function visitorId(req: { headers: Record<string, unknown>; socket?: { remoteAddress?: string } }, email?: string | null): string;
export function checkRate(bucket: Bucket, visitor: string, now?: number): { retryAfterSec: number } | null;
export function resetRates(): void;
export interface MonthlyUsage {
  month: string;
  costUsd: number;
  calls: number;
}
export const usageStore: { load(): Promise<MonthlyUsage | null>; save(u: MonthlyUsage): Promise<void> };
export function budgetUsd(): number;
export function overBudget(): Promise<boolean>;
export function recordSpend(costUsd: number): Promise<void>;
export function usageSummary(): Promise<{ month: string; spentUsd: number; calls: number; budgetUsd: number }>;
export function resetUsage(u?: MonthlyUsage | null): void;
