// "Emails" on an event page (signed-in users with Gmail connected):
// - Related emails: recent emails about this person/company, read from Gmail on the server. "Use in brief" adds one
//   (cleaned: no emails, links or numbers) to the event's details; nothing goes to the AI without that click.
// - Write an email: the AI drafts a thank-you / follow-up / coffee chat request; you edit it; then "Save as Gmail draft"
//   or "Send…", which asks for confirmation. The app never sends anything on its own.
import { Loader2, Mail, PenLine, Search, Send } from 'lucide-react';
import { useState } from 'react';
import { track } from '../lib/analytics';
import { useStore } from '../state/store';
import type { AiBriefRun, UserEvent } from '../types';
import { Dialog } from './Dialog';
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

const KINDS: Array<{ id: string; label: string }> = [
  { id: 'thanks', label: 'Thank-you note' },
  { id: 'followup', label: 'Follow-up' },
  { id: 'coffee', label: 'Ask for a coffee chat' },
  { id: 'intro', label: 'Intro before the event' },
];

export function EmailPanel({ event, run }: { event: UserEvent; run?: AiBriefRun }) {
  const { google, state, setEventDetails } = useStore();
  const [toast, showToast] = useToast();
  const [found, setFound] = useState<FoundEmail[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [kind, setKind] = useState('thanks');
  const [notes, setNotes] = useState('');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'' | 'write' | 'draft' | 'send'>('');
  const [error, setError] = useState<string | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);

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

  const write = async () => {
    setBusy('write');
    setError(null);
    try {
      const d = await post<{ subject: string; body: string }>('/api/gmail/compose', {
        kind,
        language: state.profile.briefLanguage ?? 'en',
        studentName: state.profile.name,
        studentProgram: state.profile.program,
        recipientName: person,
        event: { title: event.title, company, datetime: event.start },
        briefSummary: briefSummary(run),
        notes,
      });
      setSubject(d.subject);
      setBody(d.body);
      setDraftId(null);
      track('email_draft_written', { event_id: event.id, kind });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not write the email.');
    } finally {
      setBusy('');
    }
  };

  const saveDraft = async (): Promise<string | null> => {
    setBusy('draft');
    setError(null);
    try {
      const d = await post<{ draftId: string }>('/api/gmail/drafts', { to, subject, body });
      setDraftId(d.draftId);
      track('email_draft_saved', { event_id: event.id });
      showToast('Saved as a draft in your Gmail.');
      return d.draftId;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the draft.');
      return null;
    } finally {
      setBusy('');
    }
  };

  const sendNow = async () => {
    setConfirmSend(false);
    const id = draftId ?? (await saveDraft());
    if (!id) return;
    setBusy('send');
    try {
      await post('/api/gmail/send', { draftId: id });
      track('email_sent', { event_id: event.id, kind });
      showToast(`Email sent to ${to}.`);
      setDraftId(null);
      setSubject('');
      setBody('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the email.');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="card email-panel no-print ph-no-capture" aria-labelledby={`mail-${event.id}`}>
      <h2 id={`mail-${event.id}`}>
        <Mail size={18} aria-hidden /> Emails
      </h2>

      <h3>Related emails</h3>
      <p className="muted small">Recent emails in your Gmail about {[person, company].filter(Boolean).join(' or ') || 'this event'} (last 6 months).</p>
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
      <div className="form-grid">
        <div className="field">
          <label htmlFor={`mail-kind-${event.id}`}>Type</label>
          <select id={`mail-kind-${event.id}`} className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`mail-to-${event.id}`}>To</label>
          <input id={`mail-to-${event.id}`} className="input" type="email" placeholder="name@company.com" value={to} onChange={(e) => setTo(e.target.value)} autoComplete="off" />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`mail-notes-${event.id}`}>What you talked about (optional, makes it specific)</label>
        <textarea id={`mail-notes-${event.id}`} className="textarea" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. She suggested I look at the ads measurement team; we both lived in Lima." />
      </div>
      <button type="button" className="btn small" onClick={() => void write()} disabled={busy !== ''}>
        {busy === 'write' ? <Loader2 size={15} className="spin" aria-hidden /> : <PenLine size={15} aria-hidden />} {subject ? 'Rewrite with AI' : 'Write with AI'}
      </button>

      {(subject || body) && (
        <div className="mail-draft">
          <div className="field">
            <label htmlFor={`mail-subj-${event.id}`}>Subject</label>
            <input id={`mail-subj-${event.id}`} className="input" value={subject} maxLength={200} onChange={(e) => (setSubject(e.target.value), setDraftId(null))} />
          </div>
          <div className="field">
            <label htmlFor={`mail-body-${event.id}`}>Email</label>
            <textarea id={`mail-body-${event.id}`} className="textarea" rows={9} value={body} maxLength={10000} onChange={(e) => (setBody(e.target.value), setDraftId(null))} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn secondary small" onClick={() => void saveDraft()} disabled={busy !== '' || !to || !subject || !body}>
              {busy === 'draft' ? <Loader2 size={15} className="spin" aria-hidden /> : <Mail size={15} aria-hidden />} {draftId ? 'Saved in Gmail drafts' : 'Save as Gmail draft'}
            </button>
            <button type="button" className="btn small" onClick={() => setConfirmSend(true)} disabled={busy !== '' || !to || !subject || !body}>
              {busy === 'send' ? <Loader2 size={15} className="spin" aria-hidden /> : <Send size={15} aria-hidden />} Send…
            </button>
          </div>
          <p className="muted small">Review it first: the AI can make mistakes. Nothing is sent until you confirm.</p>
        </div>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {confirmSend && (
        <Dialog
          title="Send this email?"
          onClose={() => setConfirmSend(false)}
          footer={
            <>
              <button type="button" className="btn ghost" onClick={() => setConfirmSend(false)}>
                Cancel
              </button>
              <button type="button" className="btn" onClick={() => void sendNow()}>
                <Send size={15} aria-hidden /> Send now
              </button>
            </>
          }
        >
          <p>
            It will be sent from your Gmail to <strong>{to}</strong> with the subject “{subject}”.
          </p>
        </Dialog>
      )}
      {toast}
    </section>
  );
}
