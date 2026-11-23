export type Bucket = 'ai' | 'aiSmall' | 'write' | 'auth' | 'gmailRead' | 'gmailDraft' | 'gmailSend' | 'discover' | 'aiAnon' | 'aiSmallAnon' | 'aiGlobal' | 'aiSmallGlobal';
export const LIMITS: Record<Bucket, { max: number; windowMs: number }>;
export function visitorId(req: { headers: Record<string, unknown>; socket?: { remoteAddress?: string } }, email?: string | null): string;
export function clientIp(req: { headers?: Record<string, unknown>; socket?: { remoteAddress?: string } }): string;
export function checkRate(bucket: Bucket, visitor: string, now?: number): { retryAfterSec: number } | null;
export function resetRates(): void;
export interface MonthlyUsage {
  month: string;
  costUsd: number;
  calls: number;
  searches?: number;
}
export const usageStore: { load(month: string): Promise<MonthlyUsage | null>; save(u: MonthlyUsage): Promise<void> };
export function budgetUsd(): number;
export function overBudget(): Promise<boolean>;
export function recordSpend(costUsd: number, searches?: number): Promise<void>;
export const FREE_SEARCHES_PER_MONTH: number;
export function paidSearchesOf(n: number): Promise<number>;
export function usageSummary(): Promise<{ month: string; spentUsd: number; calls: number; searches: number; freeSearches: number; budgetUsd: number }>;
export function resetUsage(u?: MonthlyUsage | null): void;
export function isAllowedOrigin(headers: Record<string, string | undefined>, allowed: Set<string>): boolean;
