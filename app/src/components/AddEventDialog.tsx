// "Add event" form on the Calendar: lets the user add a networking event by hand.
import { useId, useState, type FormEvent } from 'react';
import { nyWallTimeToIso } from '../lib/time';
import type { EventType, ISODate, UserEvent } from '../types';
import { Dialog } from './Dialog';

const TYPES: EventType[] = ['Coffee chat', 'Networking night', 'Career panel', 'Company presentation', 'Mock interview', 'Interview', 'Other'];

interface Draft {
  title: string;
  date: string;
  start: string;
  end: string;
  location: string;
  type: EventType;
  company: string;
  person: string;
  role: string;
  notes: string;
}

export function AddEventDialog({ defaultDate, onSave, onClose }: { defaultDate: ISODate; onSave: (ev: UserEvent) => void; onClose: () => void }) {
  const uid = useId();
  const [d, setD] = useState<Draft>({ title: '', date: defaultDate, start: '16:00', end: '17:00', location: '', type: 'Coffee chat', company: '', person: '', role: '', notes: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!d.title.trim()) errs.title = 'Add a title.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) errs.date = 'Pick a date.';
    if (!d.start) errs.start = 'Pick a start time.';
    if (d.end && d.start && d.end <= d.start) errs.end = 'End must be after start.';
    if (!d.company.trim() && !d.person.trim()) errs.company = 'Add a company or a person, so the AI has something to prepare.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const start = nyWallTimeToIso(d.date, d.start);
    onSave({
      id: `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      title: d.title.trim(),
      start,
      end: d.end ? nyWallTimeToIso(d.date, d.end) : start,
      location: d.location.trim(),
      type: d.type,
      company: d.company.trim(),
      person: d.person.trim(),
      role: d.role.trim(),
      notes: d.notes.trim(),
      source: 'manual',
    });
  };

  const input = (k: 'title' | 'location' | 'company' | 'person' | 'role', label: string, placeholder: string) => (
    <div className="field">
      <label htmlFor={`${uid}-${k}`}>{label}</label>
      <input
        id={`${uid}-${k}`}
        className="input"
        value={d[k]}
        placeholder={placeholder}
        maxLength={k === 'title' ? 200 : 120}
        onChange={(e) => set(k, e.target.value)}
        aria-invalid={errors[k] ? true : undefined}
        aria-describedby={errors[k] ? `${uid}-${k}-err` : undefined}
      />
      {errors[k] && (
        <span className="field-error" id={`${uid}-${k}-err`}>
          {errors[k]}
        </span>
      )}
    </div>
  );

  return (
    <Dialog
      title="Add event"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" form={`${uid}-form`}>
            Add to calendar
          </button>
        </>
      }
    >
      <form id={`${uid}-form`} onSubmit={submit} noValidate>
        <p className="muted small" style={{ marginTop: 0 }}>
          Add a networking event by hand. Times are New York time. Then use “Generate brief with AI” on the calendar.
        </p>
        {input('title', 'Event title *', 'Coffee chat with Jordan')}
        <div className="form-grid">
          <div className="field">
            <label htmlFor={`${uid}-date`}>Date *</label>
            <input id={`${uid}-date`} type="date" className="input" value={d.date} onChange={(e) => set('date', e.target.value)} aria-invalid={errors.date ? true : undefined} />
            {errors.date && <span className="field-error">{errors.date}</span>}
          </div>
          <div className="field">
            <label htmlFor={`${uid}-start`}>Start *</label>
            <input id={`${uid}-start`} type="time" className="input" value={d.start} onChange={(e) => set('start', e.target.value)} />
            {errors.start && <span className="field-error">{errors.start}</span>}
          </div>
          <div className="field">
            <label htmlFor={`${uid}-end`}>End</label>
            <input id={`${uid}-end`} type="time" className="input" value={d.end} onChange={(e) => set('end', e.target.value)} aria-invalid={errors.end ? true : undefined} />
            {errors.end && <span className="field-error">{errors.end}</span>}
          </div>
          <div className="field">
            <label htmlFor={`${uid}-type`}>Type</label>
            <select id={`${uid}-type`} className="select" value={d.type} onChange={(e) => set('type', e.target.value as EventType)}>
              {TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-grid">
          {input('company', 'Company', 'Spotify')}
          {input('person', 'Person', 'Jordan Lee')}
          {input('role', 'Role', 'Product Manager')}
          {input('location', 'Location', 'Zoom or address')}
        </div>
        <div className="field">
          <label htmlFor={`${uid}-notes`}>Notes</label>
          <textarea id={`${uid}-notes`} className="input" rows={3} maxLength={2000} value={d.notes} placeholder="What you want from this conversation" onChange={(e) => set('notes', e.target.value)} />
        </div>
      </form>
    </Dialog>
  );
}
