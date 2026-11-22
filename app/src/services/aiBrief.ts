// Browser side of the real AI brief: calls the LOCAL server (/api/brief), never the AI provider directly.
// Generated briefs are saved by the app store (in this browser's localStorage).
import type { AiBrief, AiBriefRun, AiEventInput, AiResearch } from '../types';

/** Optional PDF for one brief (base64, max ~2 MB). Sent once to the AI; not saved. */
export interface BriefAttachment {
  name: string;
  mimeType: 'application/pdf';
  data: string;
}

export async function requestAiBrief(event: AiEventInput, attachment?: BriefAttachment): Promise<AiBriefRun> {
  let res: Response;
  try {
    res = await fetch('/api/brief', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(attachment ? { ...event, attachment } : event) });
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

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('Could not reach the local server. Is npm run dev running?');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? 'Something went wrong.');
  return data as T;
}

/** "Generate more questions": 3 new questions that don't repeat the ones you have. */
export function requestMoreQuestions(event: AiEventInput, brief: AiBrief, existingQuestions: string[]) {
  return postJson<{ questions: Array<{ theme: string; question: string }>; costUsd: number }>('/api/brief/questions', { event, brief, existingQuestions });
}

/** "Ask about this brief": one AI reply, with the brief and the event as context. */
export function requestChatReply(event: AiEventInput, brief: AiBrief, messages: Array<{ role: 'user' | 'assistant'; text: string }>) {
  return postJson<{ reply: string; costUsd: number }>('/api/brief/chat', { event, brief, messages });
}

/** "Latest public info": live web search for the company and person (only these fields are sent). */
export async function requestResearch(event: AiEventInput): Promise<AiResearch> {
  const { title, datetime, company, person, role, topic } = event;
  const out = await postJson<AiResearch>('/api/research', { title, datetime, company, person, role, topic: topic ?? '' });
  return { text: out.text, sources: out.sources ?? [], queries: out.queries ?? [], suggestionsHtml: out.suggestionsHtml ?? '', costUsd: out.costUsd ?? 0, searchedAt: out.searchedAt };
}
