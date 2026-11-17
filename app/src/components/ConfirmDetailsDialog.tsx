// "Confirm details": before generating a brief for an event with missing details, ask only for what is missing,
// plus "Paste anything useful" and an optional file (PDF, TXT, CSV). What you type is saved with your account;
// a PDF is sent once to the AI for this brief and not saved.
import { Paperclip, Sparkles, X } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { knownDetails, missingDetails, MISSING_LABEL, type MissingField } from '../lib/eventDetails';
import type { BriefAttachment } from '../services/aiBrief';
import { useStore } from '../state/store';
import type { EventDetails, UserEvent } from '../types';
import { Dialog } from './Dialog';

const MAX_FILE_BYTES = 2 * 1024 * 1024;

function toBase64(buf: ArrayBuffer): string {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Generate a brief, asking "Confirm details" first when the event is missing company, person or topic. */
export function useGenerateBrief(): { requestGenerate: (eventId: string, opts?: { edit?: boolean }) => void; dialog: ReactNode } {
  const { generateAiBrief, findUserEvent, classified, state } = useStore();
  const [openFor, setOpenFor] = useState<string | null>(null);

  const requestGenerate = (eventId: string, opts: { edit?: boolean } = {}) => {
    const ev = findUserEvent(eventId);
    if (!ev) return;
    const details = state.eventDetails[eventId];
    const missing = missingDetails(ev, classified[eventId]?.classification, details);
    if (opts.edit || (missing.length > 0 && !details?.confirmedAt)) setOpenFor(eventId);
    else void generateAiBrief(eventId);
  };

  const ev = openFor ? findUserEvent(openFor) : undefined;
  const dialog = ev ? <ConfirmDetailsDialog ev={ev} onClose={() => setOpenFor(null)} /> : null;
  return { requestGenerate, dialog };
}

function ConfirmDetailsDialog({ ev, onClose }: { ev: UserEvent; onClose: () => void }) {
  const uid = useId();
  const { classified, state, setEventDetails, generateAiBrief } = useStore();
  const cls = classified[ev.id]?.classification;
  const saved = state.eventDetails[ev.id];
  const known = knownDetails(ev, cls, saved);
  const missing = new Set<MissingField>(missingDetails(ev, cls, saved));
  const [d, setD] = useState({ company: known.company, person: known.person, role: known.role, topic: saved?.topic ?? '', extra: saved?.extra ?? '' });
  const [file, setFile] = useState<{ name: string; attachment?: BriefAttachment; text?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof d, v: string) => setD((x) => ({ ...x, [k]: v }));

  const pickFile = async (f: File | undefined) => {
    setError(null);
    if (!f) return setFile(null);
    if (f.size > MAX_FILE_BYTES) return setError('The file is too large (max 2 MB).');
    const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    const isText = /\.(txt|csv|md)$/i.test(f.name) || f.type.startsWith('text/');
    if (!isPdf && !isText) return setError('Use a PDF, TXT or CSV file.');
    if (isPdf) setFile({ name: f.name, attachment: { name: f.name, mimeType: 'application/pdf', data: toBase64(await f.arrayBuffer()) } });
    else setFile({ name: f.name, text: (await f.text()).slice(0, 5000) });
  };

  const save = (): EventDetails => {
    const fromFile = file?.text ? `\n\nFrom ${file.name}:\n${file.text}` : '';
    const details: EventDetails = {
      company: d.company.trim(),
      person: d.person.trim(),
      role: d.role.trim(),
      topic: d.topic.trim(),
      extra: (d.extra.trim() + fromFile).trim().slice(0, 6000),
      confirmedAt: new Date().toISOString(),
    };
    setEventDetails(ev.id, details);
    return details;
  };

  const generate = () => {
    const details = save();
    onClose();
    void generateAiBrief(ev.id, file?.attachment, details);
  };

  const field = (k: 'company' | 'person' | 'role' | 'topic', label: string, placeholder: string, missingKey?: MissingField) => (
    <div className="field">
      <label htmlFor={`${uid}-${k}`}>
        {label} {missingKey && missing.has(missingKey) && <span className="chip peach small missing-chip">Missing</span>}
      </label>
      <input id={`${uid}-${k}`} className="input" value={d[k]} placeholder={placeholder} maxLength={k === 'topic' ? 300 : 200} onChange={(e) => set(k, e.target.value)} />
    </div>
  );

  return (
    <Dialog
      title="Confirm details"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={generate}>
            Skip and generate anyway
          </button>
          <button type="button" className="btn" onClick={generate}>
            <Sparkles size={16} aria-hidden /> Generate brief
          </button>
        </>
      }
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        <strong>{ev.title}</strong>
        {missing.size > 0
          ? ` is missing: ${[...missing].map((m) => MISSING_LABEL[m]).join(', ')}. Add their name and company if you know them; the rest is optional.`
          : '. Check or add details for a better brief.'}
      </p>
      <div className="form-grid">
        {field('company', 'Company', 'e.g. Stripe', 'company')}
        {field('person', 'Person(s)', 'e.g. Daniel Ortiz', 'person')}
        {field('role', 'Role (optional)', 'e.g. Product Manager')}
      </div>
      {field('topic', 'What is it about? (optional)', 'e.g. PM recruiting and payments partnerships')}
      <div className="field">
        <label htmlFor={`${uid}-extra`}>Paste anything useful</label>
        <textarea
          id={`${uid}-extra`}
          className="input"
          rows={4}
          maxLength={5000}
          placeholder="The invitation text, the speaker's bio, the agenda, a LinkedIn summary…"
          value={d.extra}
          onChange={(e) => set('extra', e.target.value)}
        />
      </div>
      <div className="field">
        <span className="field-label">
          Add a file <span className="muted small">(optional: attendee list, bio, agenda · PDF, TXT or CSV · max 2 MB)</span>
        </span>
        {file ? (
          <div className="file-pill">
            <Paperclip size={15} aria-hidden /> {file.name}
            <button type="button" className="chip-remove" aria-label={`Remove ${file.name}`} onClick={() => setFile(null)}>
              <X size={14} aria-hidden />
            </button>
          </div>
        ) : (
          <label className="btn secondary small file-btn">
            <Paperclip size={15} aria-hidden /> Choose file
            <input type="file" accept=".pdf,.txt,.csv,.md,application/pdf,text/plain,text/csv" className="sr-only" aria-label="Add a file" onChange={(e) => void pickFile(e.target.files?.[0])} />
          </label>
        )}
        <span className="muted small">A PDF is sent to the AI only for this brief and is not saved. Text and CSV files are added to your notes for this event.</span>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
