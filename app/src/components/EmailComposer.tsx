// Email composer (Gmail): the AI drafts a thank-you / follow-up / coffee chat request from the event and your comments;
// you edit it; "Save as Gmail draft" or "Send…" (asks for confirmation). Used on event pages and in Contacts.
import { Loader2, Mail, PenLine, Send } from 'lucide-react';
import { useId, useState } from 'react';
import { track } from '../lib/analytics';
import { useStore } from '../state/store';
import { Dialog } from './Dialog';

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error ?? 'Something went wrong.');
  return d as T;
}

export const EMAIL_KIND_LABEL: Record<string, string> = {
  thanks: 'Thank-you note',
  followup: 'Follow-up',
  coffee: 'Ask for a coffee chat',
  intro: 'Intro before the event',
};

export interface SentEmail {
  threadId: string;
  sentAt: string;
  kind: string;
  subject: string;
  to: string;
}

export function EmailComposer({
  recipientName,
  defaultTo = '',
  defaultKind = 'thanks',
  event,
  briefSummary = '',
  onSent,
  onToast,
}: {
  recipientName: string;
  defaultTo?: string;
  defaultKind?: string;
  event: { title: string; company: string; datetime: string };
  briefSummary?: string;
  onSent?: (e: SentEmail) => void;
  onToast: (msg: string) => void;
}) {
  const { state } = useStore();
  const uid = useId();
  const [kind, setKind] = useState(defaultKind);
  const [comments, setComments] = useState('');
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'' | 'write' | 'draft' | 'send'>('');
  const [error, setError] = useState<string | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);

  const write = async () => {
    setBusy('write');
    setError(null);
    try {
      const d = await postJson<{ subject: string; body: string }>('/api/gmail/compose', {
        kind,
        language: state.profile.briefLanguage ?? 'en',
        studentName: state.profile.name,
        studentProgram: state.profile.program,
        recipientName,
        event,
        briefSummary,
        notes: comments,
      });
      setSubject(d.subject);
      setBody(d.body);
      setDraftId(null);
      track('email_draft_written', { kind });
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
      const d = await postJson<{ draftId: string }>('/api/gmail/drafts', { to, subject, body });
      setDraftId(d.draftId);
      track('email_draft_saved', { kind });
      onToast('Saved as a draft in your Gmail.');
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
      const r = await postJson<{ threadId: string }>('/api/gmail/send', { draftId: id });
      track('email_sent', { kind });
      onSent?.({ threadId: r.threadId, sentAt: new Date().toISOString(), kind, subject, to });
      onToast(`Email sent to ${to}.`);
      setDraftId(null);
      setSubject('');
      setBody('');
      setComments('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the email.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="composer-box">
      <div className="form-grid">
        <div className="field">
          <label htmlFor={`${uid}-kind`}>Type</label>
          <select id={`${uid}-kind`} className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(EMAIL_KIND_LABEL).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${uid}-to`}>To</label>
          <input id={`${uid}-to`} className="input" type="email" placeholder="name@company.com" value={to} onChange={(e) => setTo(e.target.value)} autoComplete="off" />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${uid}-notes`}>Comments to include in the draft (optional)</label>
        <textarea
          id={`${uid}-notes`}
          className="textarea"
          value={comments}
          maxLength={2000}
          onChange={(e) => setComments(e.target.value)}
          placeholder="e.g. Thank her for the tip about the ads measurement team; mention we're both from Lima; ask for 20 minutes next week."
        />
      </div>
      <button type="button" className="btn small" onClick={() => void write()} disabled={busy !== ''}>
        {busy === 'write' ? <Loader2 size={15} className="spin" aria-hidden /> : <PenLine size={15} aria-hidden />} {subject ? 'Rewrite with AI' : 'Write with AI'}
      </button>

      {(subject || body) && (
        <div className="mail-draft">
          <div className="field">
            <label htmlFor={`${uid}-subj`}>Subject</label>
            <input id={`${uid}-subj`} className="input" value={subject} maxLength={200} onChange={(e) => (setSubject(e.target.value), setDraftId(null))} />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-body`}>Email</label>
            <textarea id={`${uid}-body`} className="textarea" rows={9} value={body} maxLength={10000} onChange={(e) => (setBody(e.target.value), setDraftId(null))} />
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
    </div>
  );
}
