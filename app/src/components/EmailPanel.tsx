// "Emails" on an event page (signed-in users with Gmail connected):
// - Related emails: recent emails about this person/company, read from Gmail on the server. "Use in brief" adds one
//   (cleaned: no emails, links or numbers) to the event's details; nothing goes to the AI without that click.
// - Write an email: the AI drafts a thank-you / follow-up / coffee chat request; you edit it; then "Save as Gmail draft"
//   or "Send…", which asks for confirmation. The app never sends anything on its own.
import { Loader2, Mail, Search } from 'lucide-react';
import { useState } from 'react';
import { track } from '../lib/analytics';
import { useStore } from '../state/store';
import type { AiBriefRun, UserEvent } from '../types';
import { EmailComposer, type SentEmail } from './EmailComposer';
import { contactFromSuggestion, recordEmail } from '../lib/followups';
import { useToast } from './Toast';

interface FoundEmail {
  id: string;
  subject: string;
  fromName: string;
  fromEmail: string;
  fromDomain: string;
  date: string;
  snippet: string;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error ?? 'Something went wrong.');
  return d as T;
}

/** No emails, links or phone numbers in what we keep as event context. */
const clean = (t: string) =>
  t
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/https?:\/\/\S+|www\.\S+/gi, '[link]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[number]');

/** A short, citation-free summary of the brief for the email writer. */
function briefSummary(run?: AiBriefRun): string {
  if (!run) return '';
  const b = run.brief;
  const noRefs = (t: string) => t.replace(/\s*\[\d{1,2}\]/g, '');
  if (b.version === 3) return noRefs([b.headline, b.angle, ...(b.bigPicture?.company ?? []), ...b.companyNews.items.slice(0, 3).map((n) => n.headline)].join(' ')).slice(0, 2500);
  return [b.essentials.summary, b.essentials.goal].join(' ').slice(0, 2500);
}


export function EmailPanel({ event, run }: { event: UserEvent; run?: AiBriefRun }) {
  const { google, state, setEventDetails, upsertContact } = useStore();
  const [toast, showToast] = useToast();
  const [found, setFound] = useState<FoundEmail[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!google.signedIn) return null;
  const company = event.company || state.eventDetails[event.id]?.company || '';
  const person = event.person || state.eventDetails[event.id]?.person || '';

  if (!google.gmailConnected) {
    return (
      <section className="card email-panel no-print" aria-labelledby={`mail-${event.id}`}>
        <h2 id={`mail-${event.id}`}>
          <Mail size={18} aria-hidden /> Emails
        </h2>
        <p className="muted small">Connect Gmail to find emails about this event and write thank-you or follow-up drafts. Nothing is sent without your click.</p>
        <a className="btn small" href="/auth/google/start?step=gmail">
          Connect Gmail
        </a>
      </section>
    );
  }

  const search = async () => {
    setSearching(true);
    setError(null);
    try {
      const d = await post<{ emails: FoundEmail[] }>('/api/gmail/related', { person, company, title: event.title });
      setFound(d.emails);
      track('gmail_searched', { event_id: event.id, results: d.emails.length });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not search Gmail.');
    } finally {
      setSearching(false);
    }
  };

  const useInBrief = (m: FoundEmail) => {
    const d = state.eventDetails[event.id] ?? { company, person, role: event.role ?? '', topic: '', extra: '', confirmedAt: '' };
    const line = clean(`Email "${m.subject}" from ${m.fromName}${m.fromDomain ? ` (${m.fromDomain})` : ''}, ${m.date}: ${m.snippet}`);
    setEventDetails(event.id, { ...d, extra: [d.extra, line].filter(Boolean).join('\n').slice(0, 6000) });
    track('gmail_used_in_brief', { event_id: event.id });
    showToast('Added to this event. Regenerate the brief to use it.');
  };

  // After sending: keep it in the person's contact (history + reply tracking), creating the contact if needed.
  const recordSent = (sent: SentEmail) => {
    const name = person.split(/\s*(?:,|;| and )\s*/)[0]?.trim();
    if (!name) return;
    const existing = state.contacts.find((c) => c.name.trim().toLowerCase() === name.toLowerCase());
    const base = existing ?? contactFromSuggestion({ key: '', name, role: event.role, company, eventId: event.id, eventTitle: event.title, eventDate: event.start });
    upsertContact(recordEmail(base, sent));
  };

  return (
    <section className="card email-panel no-print ph-no-capture" aria-labelledby={`mail-${event.id}`}>
      <h2 id={`mail-${event.id}`}>
        <Mail size={18} aria-hidden /> Emails
      </h2>

      <h3>Related emails</h3>
      <p className="muted small">Recent emails in your Gmail about {[person, company].filter(Boolean).join(' or ') || 'this event'} (last 12 months).</p>
      <button type="button" className="btn secondary small" onClick={() => void search()} disabled={searching}>
        {searching ? <Loader2 size={15} className="spin" aria-hidden /> : <Search size={15} aria-hidden />} Find related emails
      </button>
      {found && found.length === 0 && <p className="muted small">No related emails found.</p>}
      {found && found.length > 0 && (
        <ul className="mail-list">
          {found.map((m) => (
            <li key={m.id}>
              <div className="mail-head">
                <strong>{m.subject || '(no subject)'}</strong>
                <span className="muted small">
                  {m.fromName} · {m.date}
                </span>
              </div>
              <p className="small" style={{ margin: '4px 0' }}>
                {m.snippet}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn ghost small" onClick={() => useInBrief(m)}>
                  Use in brief
                </button>
                {m.fromEmail && (
                  <button type="button" className="btn ghost small" onClick={() => setTo(m.fromEmail)}>
                    Reply to this person
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3 style={{ marginTop: 18 }}>Write an email</h3>
      <EmailComposer
        recipientName={person}
        defaultTo={to}
        key={to}
        event={{ title: event.title, company, datetime: event.start }}
        briefSummary={briefSummary(run)}
        onSent={recordSent}
        onToast={showToast}
      />
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {toast}
    </section>
  );
}
