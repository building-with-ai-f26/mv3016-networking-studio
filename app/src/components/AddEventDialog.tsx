// "Add event" on the Calendar, two ways:
// - From my calendar: pick a Google Calendar event the filter (or you) hid, and choose its type.
// - Manually: type an event that is not in your calendar.
import { Search } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { NETWORKING_TYPES, TYPE_LABELS, type NetworkingType } from '../lib/classifier';
import { formatDateTime, nyWallTimeToIso } from '../lib/time';
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

export interface HiddenCalendarEvent {
  ev: UserEvent;
  /** Why it was hidden (e.g. "Recurring meeting", "You removed it"). */
  reason: string;
  /** Type pre-selected in the menu. */
  suggested: NetworkingType;
}

interface Props {
  defaultDate: ISODate;
  onSave: (ev: UserEvent) => void;
  onClose: () => void;
  /** Hidden Google Calendar events (only when a calendar is connected, or in demo mode). */
  hidden?: HiddenCalendarEvent[];
  onAddFromCalendar?: (ev: UserEvent, type: NetworkingType) => void;
}

export function AddEventDialog({ defaultDate, onSave, onClose, hidden = [], onAddFromCalendar }: Props) {
  const uid = useId();
  const hasCalendar = Boolean(onAddFromCalendar);
  const [tab, setTab] = useState<'calendar' | 'manual'>(hasCalendar ? 'calendar' : 'manual');
  const [query, setQuery] = useState('');
  const [types, setTypes] = useState<Record<string, NetworkingType>>({});
  const q = query.trim().toLowerCase();
  const matches = hidden.filter((h) => !q || h.ev.title.toLowerCase().includes(q) || (h.ev.location ?? '').toLowerCase().includes(q));
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
            {tab === 'calendar' ? 'Close' : 'Cancel'}
          </button>
          {tab === 'manual' && (
            <button type="submit" className="btn" form={`${uid}-form`}>
              Add to calendar
            </button>
          )}
        </>
      }
    >
      {hasCalendar && (
        <div className="tabs add-tabs" role="tablist" aria-label="How to add the event">
          <button type="button" role="tab" className="tab" aria-selected={tab === 'calendar'} onClick={() => setTab('calendar')}>
            From my calendar
          </button>
          <button type="button" role="tab" className="tab" aria-selected={tab === 'manual'} onClick={() => setTab('manual')}>
            Manually
          </button>
        </div>
      )}

      {tab === 'calendar' && (
        <div>
          <p className="muted small" style={{ marginTop: 0 }}>
            Events from your calendar, from today to the next 14 days, that are not on your networking week. Pick the one that is missing.
          </p>
          <div className="search" style={{ marginBottom: 12 }}>
            <Search size={16} aria-hidden />
            <input className="input" type="search" placeholder="Search your calendar" aria-label="Search your calendar" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {matches.length === 0 ? (
            <p className="muted small">{hidden.length === 0 ? 'All your calendar events are already on your networking week.' : 'No events match your search.'}</p>
          ) : (
            <ul className="hidden-list">
              {matches.map(({ ev, reason, suggested }) => (
                <li key={ev.id}>
                  <div className="hidden-info">
                    <strong>{ev.title}</strong>
                    <span className="muted small">
                      {formatDateTime(ev.start)} · {reason}
                    </span>
                  </div>
                  <label className="sr-only" htmlFor={`${uid}-t-${ev.id}`}>
                    Type for {ev.title}
                  </label>
                  <select
                    id={`${uid}-t-${ev.id}`}
                    className="chip-select"
                    value={types[ev.id] ?? suggested}
                    onChange={(e) => setTypes((t) => ({ ...t, [ev.id]: e.target.value as NetworkingType }))}
                  >
                    {NETWORKING_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn small" aria-label={`Add ${ev.title}`} onClick={() => onAddFromCalendar?.(ev, types[ev.id] ?? suggested)}>
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'manual' && (
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
      )}
    </Dialog>
  );
}
