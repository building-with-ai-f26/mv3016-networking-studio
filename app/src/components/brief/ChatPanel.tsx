import { Bot, Send } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CHAT_SHORTCUTS, CHAT_TYPING_MS, demoReply } from '../../services/mockServices';
import { useStore } from '../../state/store';
import type { Brief, ChatMessage } from '../../types';

let counter = 0;
const newId = () => `m-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** Per-event demo chat. Messages are stored per event ID, so chats never mix. */
export function ChatPanel({ brief }: { brief: Brief }) {
  const { state, addChatMessage } = useStore();
  const messages = state.chats[brief.eventId] ?? [];
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; msg: ChatMessage } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // If the user leaves mid-reply, store the reply instead of losing it.
  useEffect(
    () => () => {
      if (pending.current) {
        clearTimeout(pending.current.timer);
        addChatMessage(pending.current.msg);
        pending.current = null;
      }
    },
    [addChatMessage],
  );

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, typing]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || typing) return;
    const now = new Date().toISOString();
    addChatMessage({ id: newId(), eventId: brief.eventId, role: 'user', text: t, createdAt: now });
    const reply: ChatMessage = { id: newId(), eventId: brief.eventId, role: 'assistant', text: demoReply(brief, t, state.profile), createdAt: now };
    setTyping(true);
    const timer = setTimeout(() => {
      pending.current = null;
      addChatMessage(reply);
      setTyping(false);
    }, CHAT_TYPING_MS);
    pending.current = { timer, msg: reply };
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
    setDraft('');
  };

  return (
    <section className="card chat" aria-labelledby="chat-title">
      <div className="chat-head">
        <h2 id="chat-title">Ask about this brief</h2>
        <span className="chip peach small">
          <Bot size={14} aria-hidden /> Demo assistant · sample responses
        </span>
      </div>
      <div className="chat-log" ref={logRef} aria-live="polite" aria-label="Conversation">
        {messages.length === 0 && !typing && <p className="muted small">Ask a question about this event or use a shortcut below.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            <span className="sr-only">{m.role === 'user' ? 'You: ' : 'Demo assistant: '}</span>
            {m.text}
          </div>
        ))}
        {typing && (
          <div className="msg assistant" aria-label="Demo assistant is typing">
            <span className="typing" aria-hidden>
              <span />
              <span />
              <span />
            </span>
          </div>
        )}
      </div>
      <div className="shortcuts">
        {CHAT_SHORTCUTS.map((s) => (
          <button key={s.intent} type="button" className="chip outline" onClick={() => send(s.label)} disabled={typing}>
            {s.label}
          </button>
        ))}
      </div>
      <form className="composer" onSubmit={onSubmit}>
        <label htmlFor={`chat-input-${brief.eventId}`} className="sr-only">
          Message the demo assistant
        </label>
        <input
          id={`chat-input-${brief.eventId}`}
          className="input"
          placeholder="Ask a follow-up, or start with “Note:” to keep a note"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoComplete="off"
        />
        <button type="submit" className="btn" disabled={typing || !draft.trim()} aria-label="Send message">
          <Send size={16} aria-hidden /> <span className="send-label">Send</span>
        </button>
      </form>
    </section>
  );
}
