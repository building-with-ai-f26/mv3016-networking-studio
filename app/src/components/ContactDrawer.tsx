// One contact's follow-up: stage, email, LinkedIn invitation (open LinkedIn + AI note to copy), thank-you / follow-up
// email (Gmail composer with your comments), replies, coffee chat, and the interaction history.
import { CalendarCheck, Check, Copy, ExternalLink, Linkedin, Loader2, MailCheck, PenLine, RefreshCw } from 'lucide-react';
import { useId, useState } from 'react';
import { track } from '../lib/analytics';
import { applyFoundAddress, linkedinSearchUrl, mergeActivity, recordCoffee, recordEmail, recordLinkedin, recordReply, STAGE_LABEL, stageOf, type GmailActivity } from '../lib/followups';
import { formatShortDate } from '../lib/time';
import { useStore } from '../state/store';
import type { Contact } from '../types';
import { copyText } from './brief/copy';
import { Dialog } from './Dialog';
import { EmailComposer, postJson } from './EmailComposer';

export function StageBadge({ c }: { c: Contact }) {
  const s = stageOf(c);
  return <span className={`stage stage-${s}`}>{STAGE_LABEL[s]}</span>;
}

/**
 * Brings Gmail up to date for all contacts: everything exchanged with each contact's email (sent from the app or from
 * Gmail) and replies to emails sent from the app. Returns how many contacts got a new reply.
 */
export async function syncGmail(contacts: Contact[], save: (c: Contact) => void): Promise<number> {
  let replied = 0;
  // 1) Contacts met in person usually have no email on file: find it in Gmail by their name.
  const noEmail = contacts.filter((c) => !c.isSample && !c.email && !(c.emailCandidates ?? []).length && c.name.trim().split(/\s+/).length >= 2);
  if (noEmail.length) {
    const { found } = await postJson<{ found: Record<string, { exact: string[] }> }>('/api/gmail/addresses', { contacts: noEmail.map((c) => ({ id: c.id, name: c.name })) });
    contacts = contacts.map((c) => {
      const next = applyFoundAddress(c, found[c.id]?.exact ?? []);
      if (next !== c) save(next);
      return next;
    });
  }
  const withEmail = contacts.filter((c) => !c.isSample && c.email);
  if (withEmail.length) {
    const { activity } = await postJson<{ activity: Record<string, GmailActivity[]> }>('/api/gmail/activity', { contacts: withEmail.map((c) => ({ id: c.id, email: c.email })) });
    for (const c of withEmail) {
      const next = mergeActivity(c, activity[c.id] ?? []);
      if (next !== c) {
        if (stageOf(next) === 'replied' && stageOf(c) !== 'replied') replied++;
        save(next);
      }
    }
  }
  // Emails sent from the app to contacts without an address on file: check their threads.
  const others = contacts.filter((c) => !c.isSample && !c.email);
  const pending = others.flatMap((c) => (c.emails ?? []).filter((e) => !e.repliedAt && e.threadId).map((e) => ({ threadId: e.threadId, sentAt: e.sentAt })));
  if (pending.length) {
    const { replies } = await postJson<{ replies: Array<{ threadId: string; repliedAt: string; snippet: string }> }>('/api/gmail/replies', { threads: pending });
    for (const r of replies) {
      const c = others.find((x) => x.emails?.some((e) => e.threadId === r.threadId));
      if (c) (save(recordReply(c, r)), replied++);
    }
  }
  if (replied) track('email_replies_found', { count: replied });
  return replied;
}

export function ContactDrawer({ contact, onClose, onToast }: { contact: Contact; onClose: () => void; onToast: (m: string) => void }) {
  const { state, upsertContact, google } = useStore();
  const c = state.contacts.find((x) => x.id === contact.id) ?? contact;
  const uid = useId();
  const [email, setEmail] = useState(c.email ?? '');
  const [comments, setComments] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'' | 'note' | 'replies'>('');
  const [error, setError] = useState<string | null>(null);
  const event = c.events?.at(-1);
  const stage = stageOf(c);

  const writeNote = async () => {
    setBusy('note');
    setError(null);
    try {
      const d = await postJson<{ note: string }>('/api/linkedin/note', {
        language: state.profile.briefLanguage ?? 'en',
        studentName: state.profile.name,
        studentProgram: state.profile.program,
        name: c.name,
        role: c.role,
        company: c.company,
        eventTitle: event?.title ?? '',
        comments,
      });
      setNote(d.note);
      track('linkedin_note_written');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not write the note.');
    } finally {
      setBusy('');
    }
  };

  const findReplies = async () => {
    setBusy('replies');
    setError(null);
    try {
      const n = await syncGmail([c], upsertContact);
      onToast(n ? `${c.name} replied!` : 'No reply yet.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check Gmail.');
    } finally {
      setBusy('');
    }
  };

  return (
    <Dialog variant="drawer" title={c.name} onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>
        {[c.role, c.company].filter(Boolean).join(' · ') || 'Role and company not recorded'}
        {event ? ` · Met at ${event.title} (${formatShortDate(event.date.slice(0, 10))})` : ''}
      </p>
      <p>
        <StageBadge c={c} />
      </p>

      {!c.email && (c.emailCandidates ?? []).length > 0 && (
        <div className="notice info small" role="status">
          Found in your Gmail next to “{c.name}”:{' '}
          {(c.emailCandidates ?? []).map((e) => (
            <button key={e} type="button" className="btn ghost small" onClick={() => (upsertContact({ ...c, email: e, emailCandidates: undefined }), setEmail(e), onToast('Email saved'))}>
              Use {e}
            </button>
          ))}
        </div>
      )}
      <div className="field">
        <label htmlFor={`${uid}-email`}>Email (optional; found automatically when you email them from Gmail)</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input id={`${uid}-email`} className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
          <button type="button" className="btn secondary small" disabled={email === (c.email ?? '')} onClick={() => (upsertContact({ ...c, email: email.trim() }), onToast('Email saved'))}>
            Save
          </button>
        </div>
      </div>

      <section className="drawer-step">
        <h3>
          <Linkedin size={17} aria-hidden /> LinkedIn
        </h3>
        {c.linkedinAt ? (
          <p className="small">
            <Check size={14} aria-hidden /> Invitation sent on {formatShortDate(c.linkedinAt.slice(0, 10))}.
          </p>
        ) : (
          <>
            <p className="muted small">LinkedIn doesn't let apps send invitations: open their profile, paste the note, and mark it as sent.</p>
            <div className="field">
              <label htmlFor={`${uid}-licomments`}>Comments to include (optional)</label>
              <input id={`${uid}-licomments`} className="input" value={comments} maxLength={500} onChange={(e) => setComments(e.target.value)} placeholder="e.g. loved her point about measurement" />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn small" onClick={() => void writeNote()} disabled={busy !== ''}>
                {busy === 'note' ? <Loader2 size={15} className="spin" aria-hidden /> : <PenLine size={15} aria-hidden />} {note ? 'Rewrite note' : 'Write invitation note'}
              </button>
              <a className="btn secondary small" href={linkedinSearchUrl(c.name, c.company)} target="_blank" rel="noopener noreferrer" onClick={() => track('linkedin_opened')}>
                Find on LinkedIn <ExternalLink size={14} aria-hidden />
              </a>
            </div>
            {note && (
              <div className="field" style={{ marginTop: 10 }}>
                <label htmlFor={`${uid}-note`}>
                  Invitation note ({note.length}/300)
                </label>
                <textarea id={`${uid}-note`} className="textarea" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button type="button" className="btn ghost small" onClick={async () => onToast((await copyText(note)) ? 'Note copied' : 'Could not copy. Select the text instead.')}>
                    <Copy size={15} aria-hidden /> Copy note
                  </button>
                </div>
              </div>
            )}
            <button type="button" className="btn ghost small" style={{ marginTop: 8 }} onClick={() => (upsertContact(recordLinkedin(c)), track('linkedin_marked_sent'), onToast('Marked as sent on LinkedIn'))}>
              <Check size={15} aria-hidden /> Mark invitation as sent
            </button>
          </>
        )}
      </section>

      <section className="drawer-step">
        <h3>
          <MailCheck size={17} aria-hidden /> Email
        </h3>
        {(c.emails ?? []).length > 0 && (
          <ul className="clean small">
            {(c.emails ?? []).map((e) => (
              <li key={e.threadId}>
                {formatShortDate(e.sentAt.slice(0, 10))} · “{e.subject}” · {e.repliedAt ? <strong>replied {formatShortDate(e.repliedAt.slice(0, 10))}</strong> : 'no reply yet'}
              </li>
            ))}
          </ul>
        )}
        {google.gmailConnected && (c.email || (c.emails ?? []).some((e) => !e.repliedAt)) && (
          <button type="button" className="btn ghost small" onClick={() => void findReplies()} disabled={busy !== ''}>
            {busy === 'replies' ? <Loader2 size={15} className="spin" aria-hidden /> : <RefreshCw size={15} aria-hidden />} Sync with Gmail
          </button>
        )}
        {google.gmailConnected ? (
          <EmailComposer
            key={`${c.id}-${(c.emails ?? []).length}`}
            recipientName={c.name}
            defaultTo={c.email ?? ''}
            defaultKind={stage === 'followup' ? 'followup' : (c.emails ?? []).length ? 'followup' : 'thanks'}
            event={{ title: event?.title ?? '', company: c.company, datetime: event?.date ?? '' }}
            onSent={(sent) => upsertContact(recordEmail({ ...c, email: c.email || email.trim() }, sent))}
            onToast={onToast}
          />
        ) : (
          <p className="muted small">
            <a href="/auth/google/start?step=gmail">Connect Gmail</a> to write and track emails from here.
          </p>
        )}
      </section>

      <section className="drawer-step">
        <h3>
          <CalendarCheck size={17} aria-hidden /> Coffee chat
        </h3>
        {c.coffeeAt ? (
          <p className="small">
            <Check size={14} aria-hidden /> Done on {formatShortDate(c.coffeeAt.slice(0, 10))}.
          </p>
        ) : (
          <button type="button" className="btn ghost small" onClick={() => (upsertContact(recordCoffee(c)), track('coffee_chat_done'), onToast('Coffee chat marked as done'))}>
            <Check size={15} aria-hidden /> Mark coffee chat as done
          </button>
        )}
      </section>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <section className="drawer-step">
        <h3>History</h3>
        {(c.history ?? []).length === 0 ? (
          <p className="muted small">No interactions recorded yet.</p>
        ) : (
          <ol className="history">
            {[...(c.history ?? [])].reverse().map((h, i) => (
              <li key={i}>
                <span className="muted small">{formatShortDate(h.at.slice(0, 10))}</span>{' '}
                {h.link ? (
                  <a href={h.link} target="_blank" rel="noopener noreferrer">
                    {h.text}
                  </a>
                ) : (
                  h.text
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </Dialog>
  );
}
