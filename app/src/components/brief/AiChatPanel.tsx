// "Ask about this brief" for AI briefs: a real AI chat (through the local server) with the brief and the event as context.
// The conversation is saved with the brief in the account's data.
import { Bot, Send } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { track } from '../../lib/analytics';
import { requestChatReply } from '../../services/aiBrief';
import { useStore } from '../../state/store';
import type { AiBriefRun } from '../../types';

const SHORTCUTS = ['Give me a 60-second recap', 'Help me ask a stronger question', 'What should I prioritize?'];

export function AiChatPanel({ run, eventId }: { run: AiBriefRun; eventId: string }) {
  const { updateAiRun, aiInputOf } = useStore();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const messages = run.chat ?? [];

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages.length, busy]);

  const send = async (text: string) => {
    const t = text.trim();
    const input = aiInputOf(eventId);
    if (!t || busy || !input) return;
    const userMsg = { role: 'user' as const, text: t, at: new Date().toISOString() };
    updateAiRun(eventId, (r) => ({ ...r, chat: [...(r.chat ?? []), userMsg] }));
    setDraft('');
    setBusy(true);
    setError(null);
    track('chat_message_sent', { event_id: eventId, source: 'ai' });
    try {
      const history = [...messages, userMsg].map(({ role, text: x }) => ({ role, text: x }));
      const { reply } = await requestChatReply(input, run.brief, history);
      updateAiRun(eventId, (r) => ({ ...r, chat: [...(r.chat ?? []), { role: 'assistant', text: reply, at: new Date().toISOString() }] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not get an answer.');
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(draft);
  };

  return (
    <section className="card chat no-print" aria-labelledby={`ai-chat-${eventId}`}>
      <div className="chat-head">
        <h2 id={`ai-chat-${eventId}`}>Ask about this brief</h2>
        <span className="chip small">
          <Bot size={14} aria-hidden /> AI assistant · uses this brief, no web search
        </span>
      </div>
      <div className="chat-log" ref={logRef} aria-live="polite" aria-label="Conversation">
        {messages.length === 0 && !busy && <p className="muted small">Ask a follow-up about this event, or use a shortcut below.</p>}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <span className="sr-only">{m.role === 'user' ? 'You: ' : 'AI assistant: '}</span>
            {m.text}
          </div>
        ))}
        {busy && (
          <div className="msg assistant" aria-label="AI assistant is typing">
            <span className="typing" aria-hidden>
              <span />
              <span />
              <span />
            </span>
          </div>
        )}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="shortcuts">
        {SHORTCUTS.map((s) => (
          <button key={s} type="button" className="chip outline" onClick={() => void send(s)} disabled={busy}>
            {s}
          </button>
        ))}
      </div>
      <form className="composer" onSubmit={onSubmit}>
        <label htmlFor={`ai-chat-input-${eventId}`} className="sr-only">
          Message the AI assistant
        </label>
        <input id={`ai-chat-input-${eventId}`} className="input" placeholder="Ask a follow-up question" value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="off" maxLength={2000} />
        <button type="submit" className="btn" disabled={busy || !draft.trim()} aria-label="Send message">
          <Send size={16} aria-hidden /> <span className="send-label">Send</span>
        </button>
      </form>
    </section>
  );
}
