// Browser side of the real AI brief: calls the LOCAL server (/api/brief), never the AI provider directly.
// Generated briefs are saved by the app store (in this browser's localStorage).
import type { AiBriefRun, AiEventInput } from '../types';

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

export function formatUsd(v: number): string {
  if (v === 0) return '$0.00';
  return v < 0.01 ? `$${v.toFixed(5)}` : `$${v.toFixed(4)}`;
}
