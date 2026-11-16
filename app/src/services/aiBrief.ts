// Browser side of the real AI brief: calls the LOCAL server (/api/brief), never the AI provider directly.
// Generated briefs are kept in this browser only (localStorage), separate from the demo state.
import type { AiBriefRun, AiEventInput } from '../types';

const RUNS_KEY = 'networking-studio:ai-briefs:v1';
const MAX_RUNS = 20;

export const EMPTY_EVENT: AiEventInput = { title: '', datetime: '', company: '', person: '', role: '', notes: '' };

export async function requestAiBrief(event: AiEventInput): Promise<AiBriefRun> {
  let res: Response;
  try {
    res = await fetch('/api/brief', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
  } catch {
    throw new Error('Could not reach the local server. Is npm run dev running?');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.brief) {
    throw new Error(data?.error ?? (res.status === 404 || res.status >= 500 ? 'The local AI server is not running. Restart npm run dev.' : 'Something went wrong.'));
  }
  return {
    id: `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    event,
    brief: data.brief,
    usage: data.usage,
    costUsd: data.costUsd,
    model: data.model,
    generatedAt: data.generatedAt,
  };
}

export function loadRuns(): AiBriefRun[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RUNS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((r) => r && r.id && r.brief && r.event) : [];
  } catch {
    return [];
  }
}

export function saveRuns(runs: AiBriefRun[]): void {
  try {
    localStorage.setItem(RUNS_KEY, JSON.stringify(runs.slice(0, MAX_RUNS)));
  } catch {
    /* storage full or blocked: the brief still shows on screen */
  }
}

export function formatUsd(v: number): string {
  if (v === 0) return '$0.00';
  return v < 0.01 ? `$${v.toFixed(5)}` : `$${v.toFixed(4)}`;
}
