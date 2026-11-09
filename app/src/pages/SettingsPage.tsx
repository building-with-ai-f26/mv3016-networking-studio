import { ArrowDown, ArrowLeft, ArrowUp, CalendarDays, Plus, RotateCcw, X } from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { ALL_INDUSTRIES, ALL_ROLES } from '../data/seed';
import { useStore } from '../state/store';
import type { Profile } from '../types';

function OrderedMultiSelect({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const id = useId();
  const move = (i: number, d: -1 | 1) => {
    const next = [...value];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  const unselected = options.filter((o) => !value.includes(o));
  return (
    <div>
      <h3 id={`${id}-sel`} style={{ marginBottom: 8 }}>
        Selected {label.toLowerCase()} (priority order)
      </h3>
      {value.length === 0 ? (
        <p className="muted small">None selected. Add at least one below.</p>
      ) : (
        <ol className="ordered" aria-labelledby={`${id}-sel`}>
          {value.map((v, i) => (
            <li key={v}>
              <span className="priority-num" aria-hidden>
                {i + 1}
              </span>
              <span className="name">
                <span className="sr-only">Priority {i + 1}: </span>
                {v}
              </span>
              <button type="button" className="icon-btn" aria-label={`Move ${v} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp size={16} aria-hidden />
              </button>
              <button type="button" className="icon-btn" aria-label={`Move ${v} down`} disabled={i === value.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown size={16} aria-hidden />
              </button>
              <button type="button" className="icon-btn" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>
                <X size={16} aria-hidden />
              </button>
            </li>
          ))}
        </ol>
      )}
      {unselected.length > 0 && (
        <>
          <p className="small muted" style={{ margin: '4px 0 6px' }} id={`${id}-add`}>
            Add {label.toLowerCase()}:
          </p>
          <div className="chip-row" role="group" aria-labelledby={`${id}-add`}>
            {unselected.map((o) => (
              <button key={o} type="button" className="chip outline" onClick={() => onChange([...value, o])} aria-label={`Add ${o}`}>
                <Plus size={13} aria-hidden /> {o}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CompanyChips({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const id = useId();
  const add = (e?: FormEvent) => {
    e?.preventDefault();
    const v = draft.trim();
    if (!v) {
      setError('Type a company name first.');
      return;
    }
    if (value.some((x) => x.toLowerCase() === v.toLowerCase())) {
      setError(`${v} is already on your list.`);
      return;
    }
    onChange([...value, v]);
    setDraft('');
    setError('');
  };
  return (
    <div>
      <ul className="chip-row" style={{ listStyle: 'none', padding: 0, margin: '0 0 12px' }} aria-label="Target companies">
        {value.map((c) => (
          <li className="chip" key={c}>
            {c}
            <button type="button" className="chip-remove" aria-label={`Remove ${c}`} onClick={() => onChange(value.filter((x) => x !== c))}>
              <X size={14} aria-hidden />
            </button>
          </li>
        ))}
        {value.length === 0 && <li className="muted small">No target companies yet.</li>}
      </ul>
      <div className="composer" style={{ maxWidth: 440 }}>
        <label htmlFor={id} className="sr-only">
          Add a target company
        </label>
        <input
          id={id}
          className="input"
          placeholder="Add a company"
          value={draft}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn secondary" onClick={() => add()}>
          <Plus size={16} aria-hidden /> Add
        </button>
      </div>
      {error && (
        <p className="field-error" id={`${id}-err`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function SettingsPage() {
  const { state, updateProfile, setCalendarConnected, resetDemo, persistStatus } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [draft, setDraft] = useState<Profile>(state.profile);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmReset, setConfirmReset] = useState(false);
  const [toast, showToast] = useToast();
  const uid = useId();

  // If stored profile changes (e.g. demo reset), reload the draft.
  useEffect(() => setDraft(state.profile), [state.profile]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(state.profile);
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const back = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate('/calendar');
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!draft.name.trim()) errs.name = 'Name is required.';
    if (draft.industries.length === 0) errs.industries = 'Select at least one industry.';
    if (draft.roles.length === 0) errs.roles = 'Select at least one target role.';
    setErrors(errs);
    if (Object.keys(errs).length) {
      showToast('Please fix the highlighted fields');
      return;
    }
    updateProfile({ ...draft, name: draft.name.trim() });
    showToast(persistStatus === 'ok' || persistStatus === 'recovered' ? 'Settings saved' : 'Settings updated for this session (cannot save in this browser)');
  };

  const cancel = () => {
    setDraft(state.profile);
    setErrors({});
    showToast('Changes discarded');
  };

  return (
    <div className="page">
      <button type="button" className="btn ghost small back-link" onClick={back}>
        <ArrowLeft size={16} aria-hidden /> Back
      </button>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="subtitle">Editable demo preferences, not verified recruiting choices.</p>
        </div>
      </div>
      <div className="notice info small">Sample data. Changes are saved in this browser. Calendar sync, AI responses, and email delivery are simulated.</div>

      <form onSubmit={save} noValidate>
        <section className="card settings-section" aria-labelledby={`${uid}-profile`}>
          <h2 id={`${uid}-profile`}>Profile</h2>
          <p className="muted small">Event times in this demo are always shown in New York time.</p>
          <div className="form-grid">
            <div className="field">
              <label htmlFor={`${uid}-name`}>Name</label>
              <input id={`${uid}-name`} className="input" value={draft.name} onChange={(e) => set('name', e.target.value)} aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? `${uid}-name-err` : undefined} />
              {errors.name && (
                <span className="field-error" id={`${uid}-name-err`}>
                  {errors.name}
                </span>
              )}
            </div>
            <div className="field">
              <label htmlFor={`${uid}-program`}>School / program</label>
              <input id={`${uid}-program`} className="input" value={draft.program} onChange={(e) => set('program', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`${uid}-city`}>City</label>
              <input id={`${uid}-city`} className="input" value={draft.city} onChange={(e) => set('city', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`${uid}-tz`}>Timezone</label>
              <select id={`${uid}-tz`} className="select" value={draft.timezone} onChange={(e) => set('timezone', e.target.value)}>
                {['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London'].map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor={`${uid}-goal`}>Career goal</label>
            <textarea id={`${uid}-goal`} className="textarea" value={draft.careerGoal} onChange={(e) => set('careerGoal', e.target.value)} />
          </div>
        </section>

        <section className="card settings-section" aria-labelledby={`${uid}-ind`}>
          <h2 id={`${uid}-ind`}>Industries</h2>
          <p className="muted small">Priority order sets the order of industry groups in Industry News.</p>
          <OrderedMultiSelect label="Industries" options={ALL_INDUSTRIES} value={draft.industries} onChange={(v) => set('industries', v)} />
          {errors.industries && <p className="field-error">{errors.industries}</p>}
        </section>

        <section className="card settings-section" aria-labelledby={`${uid}-roles`}>
          <h2 id={`${uid}-roles`}>Target roles</h2>
          <p className="muted small">Shown as your goal context and used to order curated question variants.</p>
          <OrderedMultiSelect label="Roles" options={ALL_ROLES} value={draft.roles} onChange={(v) => set('roles', v)} />
          {errors.roles && <p className="field-error">{errors.roles}</p>}
        </section>

        <section className="card settings-section" aria-labelledby={`${uid}-co`}>
          <h2 id={`${uid}-co`}>Target companies</h2>
          <CompanyChips value={draft.companies} onChange={(v) => set('companies', v)} />
        </section>

        <section className="card settings-section" aria-labelledby={`${uid}-conn`}>
          <h2 id={`${uid}-conn`}>Connectors</h2>
          <div className="connector">
            <span className="connector-icon">
              <CalendarDays size={22} aria-hidden />
            </span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <strong>Google Calendar</strong> <span className="chip peach small">Demo connection</span>
              <p className="muted small" style={{ margin: '4px 0 0' }} role="status">
                {state.calendarConnected
                  ? 'Simulated as connected. No Google account is linked and no calendar data is read.'
                  : 'Not connected. The four calendar events are local samples.'}
              </p>
            </div>
            {state.calendarConnected ? (
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  setCalendarConnected(false);
                  showToast('Demo connection removed. Sample events stay in your calendar.');
                }}
              >
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  setCalendarConnected(true);
                  showToast('Simulated connection on — no real Google sign-in happened');
                }}
              >
                Simulate connection
              </button>
            )}
          </div>
          <p className="muted small" style={{ marginTop: 10 }}>
            Disconnecting does not delete the sample events: they are stored locally as demo data.
          </p>
        </section>

        <section className="card settings-section" aria-labelledby={`${uid}-brief`}>
          <h2 id={`${uid}-brief`}>Brief preferences</h2>
          <ul className="clean small" style={{ paddingLeft: 20 }}>
            <li>Preparation brief: 48 hours before each event (simulated in demo mode).</li>
            <li>Email reminder: 24 hours before each event (never sent in demo mode).</li>
          </ul>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, minHeight: 44 }}>
            <input type="checkbox" checked={draft.showEmailPreview} onChange={(e) => set('showEmailPreview', e.target.checked)} style={{ width: 20, height: 20 }} />
            Show “Preview reminder email” on event pages (preview only)
          </label>
        </section>

        <section className="card settings-section" aria-labelledby={`${uid}-demo`}>
          <h2 id={`${uid}-demo`}>Demo controls</h2>
          <p className="muted small">Restore all sample data: profile, brief statuses, questions, chats, contacts, saved articles and Lab layout.</p>
          <button type="button" className="btn secondary" onClick={() => setConfirmReset(true)}>
            <RotateCcw size={16} aria-hidden /> Reset demo data
          </button>
        </section>

        <div className="save-bar">
          {dirty && <span className="muted small">You have unsaved changes</span>}
          <button type="button" className="btn secondary" onClick={cancel} disabled={!dirty}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={!dirty}>
            Save settings
          </button>
        </div>
      </form>

      {confirmReset && (
        <ConfirmDialog
          title="Reset demo data?"
          message={<p>This replaces everything you changed in this browser with the original sample data.</p>}
          confirmLabel="Reset demo data"
          danger
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            resetDemo();
            setConfirmReset(false);
            showToast('Demo data reset');
          }}
        />
      )}
      {toast}
    </div>
  );
}
