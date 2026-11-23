import { ArrowLeft, CalendarDays, LogOut, Mail, RotateCcw } from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../components/Dialog';
import { CompanyChips, OrderedMultiSelect } from '../components/ProfileFields';
import { useToast } from '../components/Toast';
import { ALL_INDUSTRIES, ALL_ROLES } from '../data/seed';
import { useStore } from '../state/store';
import type { Profile } from '../types';

export function SettingsPage() {
  const { state, updateProfile, resetDemo, persistStatus, google, signOutGoogle, disconnectGoogle, exitDemo, restoreRemoved } = useStore();
  const removedList = Object.entries(state.removed).sort((a, b) => b[1].removedAt.localeCompare(a[1].removedAt));
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
      <section className="card settings-section account-card" aria-labelledby={`${uid}-account`}>
        <div>
          <h2 id={`${uid}-account`}>Account</h2>
          <p className="muted small" style={{ margin: 0 }}>
            {google.signedIn ? `Logged in as ${google.email}` : 'You are exploring the demo with sample data. Nothing is linked to your Google account.'}
          </p>
        </div>
        {google.signedIn ? (
          <button
            type="button"
            className="btn secondary"
            onClick={async () => {
              await signOutGoogle();
              navigate('/login');
            }}
          >
            <LogOut size={16} aria-hidden /> Log out
          </button>
        ) : (
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              exitDemo();
              navigate('/login');
            }}
          >
            <LogOut size={16} aria-hidden /> Exit demo
          </button>
        )}
      </section>
      {!google.signedIn && <div className="notice info small">Sample data. Changes are saved in this browser. Calendar sync, AI responses, and email delivery are simulated.</div>}

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
          <div className="field">
            <label htmlFor={`${uid}-bg`}>About you (optional)</label>
            <textarea
              id={`${uid}-bg`}
              className="textarea"
              placeholder="e.g. From Lima, 5 years in strategy consulting, speak Spanish and Portuguese"
              value={draft.background ?? ''}
              onChange={(e) => set('background', e.target.value.slice(0, 600))}
            />
            <span className="muted small">Used only to personalize your briefs (e.g. a question about a pilot in your home country). Don't include contact details.</span>
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
              <strong>Google account & Calendar</strong> <span className="chip small">Read-only</span>
              <p className="muted small" style={{ margin: '4px 0 0' }} role="status">
                {google.status === 'loading'
                  ? 'Checking your Google connection…'
                  : google.status === 'unavailable'
                    ? 'The local server is not running, so Google sign-in is off. Demo mode still works.'
                    : !google.configured
                      ? 'Google sign-in is not set up yet (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET missing in app/.env).'
                      : google.calendarConnected
                        ? `Signed in as ${google.email}. Calendar connected (read-only): the next 14 days are shown on your calendar.`
                        : google.signedIn
                          ? `Signed in as ${google.email}. Calendar not connected yet.`
                          : 'Not signed in. The four calendar events are local samples.'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {google.configured && !google.signedIn && (
                <a className="btn" href="/auth/google/start?step=signin">
                  Sign in with Google
                </a>
              )}
              {google.signedIn && !google.calendarConnected && (
                <a className="btn" href="/auth/google/start?step=calendar">
                  Connect Google Calendar
                </a>
              )}
              {google.signedIn && (
                <>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={async () => {
                      await disconnectGoogle();
                      navigate('/login');
                    }}
                  >
                    Disconnect
                  </button>
                </>
              )}
            </div>
          </div>
          {google.signedIn && (
            <div className="connector" style={{ marginTop: 12 }}>
              <span className="connector-icon">
                <Mail size={22} aria-hidden />
              </span>
              <div style={{ flex: 1, minWidth: 200 }}>
                <strong>Gmail</strong> <span className="chip small">Read + drafts</span>
                <p className="muted small" style={{ margin: '4px 0 0' }} role="status">
                  {google.gmailConnected
                    ? 'Connected. On each event: find related emails and write drafts. Nothing is ever sent without your click.'
                    : 'Find emails related to an event and write thank-you or follow-up drafts. The app can read and create drafts, never delete, and only sends when you click Send.'}
                </p>
              </div>
              {!google.gmailConnected && (
                <a className="btn" href="/auth/google/start?step=gmail">
                  Connect Gmail
                </a>
              )}
            </div>
          )}
          <p className="muted small" style={{ marginTop: 10 }}>
            Sign-in, calendar and Gmail run on the app's server: your Google tokens are encrypted and never reach the browser or Git. Disconnect revokes all access at Google. The
            sample events always stay available in demo mode.
          </p>
        </section>

        <section className="card settings-section" aria-labelledby={`${uid}-removed`}>
          <h2 id={`${uid}-removed`}>Removed events</h2>
          {removedList.length === 0 ? (
            <p className="muted small">Events you remove from your calendar appear here, so you can bring them back.</p>
          ) : (
            <>
              <p className="muted small">Restore an event to show it again on your networking week.</p>
              <ul className="hidden-list">
                {removedList.map(([key, r]) => (
                  <li key={key}>
                    <div className="hidden-info">
                      <strong>{r.title}</strong>
                      <span className="muted small">
                        {r.kind === 'series' ? 'Whole series · ' : ''}
                        {r.when}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn secondary small"
                      aria-label={`Restore ${r.title}`}
                      onClick={() => {
                        restoreRemoved(key);
                        showToast(`Restored: ${r.title}`);
                      }}
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
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
          <label htmlFor={`${uid}-lang`} style={{ display: 'block', marginTop: 14, fontWeight: 600 }}>
            Brief language
          </label>
          <select
            id={`${uid}-lang`}
            className="input"
            style={{ maxWidth: 260, marginTop: 6 }}
            value={state.profile.briefLanguage ?? 'en'}
            onChange={(e) => {
              const briefLanguage = e.target.value === 'es' ? 'es' : 'en';
              set('briefLanguage', briefLanguage);
              updateProfile({ ...state.profile, briefLanguage });
            }}
          >
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
          <p className="muted small" style={{ margin: '6px 0 0' }}>
            For new briefs. Suggested questions stay in English so you can ask them as written.
          </p>
        </section>

        {/* Only in demo mode: resetting a real account would replace its profile with the sample one. */}
        {!google.signedIn && (
          <section className="card settings-section" aria-labelledby={`${uid}-demo`}>
            <h2 id={`${uid}-demo`}>Demo controls</h2>
            <p className="muted small">Restore all sample data: profile, brief statuses, questions, chats, contacts, saved articles and Lab layout.</p>
            <button type="button" className="btn secondary" onClick={() => setConfirmReset(true)}>
              <RotateCcw size={16} aria-hidden /> Reset demo data
            </button>
          </section>
        )}

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
