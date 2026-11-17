// "Almost set!": the welcome questions shown once after Create account (and to any account that never finished them).
// Answers become the account's profile; they can be edited later in Settings.
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Illustration } from '../components/Illustration';
import { CompanyChips, OrderedMultiSelect } from '../components/ProfileFields';
import { ALL_INDUSTRIES, ALL_ROLES } from '../data/seed';
import { track } from '../lib/analytics';
import { useStore } from '../state/store';
import type { Profile } from '../types';

const STEPS = ['About you', 'Your goals', 'Target companies'];

export function WelcomePage() {
  const uid = useId();
  const navigate = useNavigate();
  const { state, google, accountReady, completeOnboarding } = useStore();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Profile>(() => ({ ...state.profile, name: state.profile.name || google.name || '' }));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Almost set · Networking Studio';
    return () => {
      document.title = 'Networking Studio';
    };
  }, []);

  if (google.status === 'loading' || (google.signedIn && !accountReady)) return <div className="app-loading">Loading…</div>;
  if (!google.signedIn) return <Navigate to="/login" replace />;
  if (state.onboarded) return <Navigate to="/calendar" replace />;

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const next = () => {
    if (step === 0 && !draft.name.trim()) return setError('Add your name.');
    if (step === 1 && draft.roles.length === 0) return setError('Choose at least one target role.');
    if (step === 1 && draft.industries.length === 0) return setError('Choose at least one industry.');
    setError(null);
    if (step < STEPS.length - 1) return setStep(step + 1);
    completeOnboarding({ ...draft, name: draft.name.trim(), program: draft.program.trim(), city: draft.city.trim(), careerGoal: draft.careerGoal.trim() });
    track('onboarding_completed', { roles: draft.roles.length, industries: draft.industries.length, companies: draft.companies.length });
    navigate('/calendar', { replace: true });
  };

  return (
    <main className="login-shell" id="main">
      <div className="card login-card welcome-card">
        <div className="login-brand">
          <span className="brand-mark">
            <Illustration kind="brand" size={34} />
          </span>
          <span className="brand-text">Networking Studio</span>
        </div>
        <h1>Almost set!</h1>
        <p className="muted">
          {google.calendarConnected ? 'Your Google Calendar is connected. ' : ''}Three quick questions so your briefs and your calendar fit your goals. You can change
          everything later in Settings.
        </p>

        <ol className="welcome-steps" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s} className={i === step ? 'current' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
              <span className="dot" aria-hidden>
                {i < step ? <Check size={12} /> : i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
          noValidate
        >
          {step === 0 && (
            <>
              <div className="field">
                <label htmlFor={`${uid}-name`}>Name</label>
                <input id={`${uid}-name`} className="input" value={draft.name} autoComplete="name" onChange={(e) => set('name', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor={`${uid}-program`}>
                  School / program <span className="muted small">(optional)</span>
                </label>
                <input id={`${uid}-program`} className="input" placeholder="e.g. MBA, Class of 2027" value={draft.program} onChange={(e) => set('program', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor={`${uid}-city`}>
                  City <span className="muted small">(optional)</span>
                </label>
                <input id={`${uid}-city`} className="input" value={draft.city} onChange={(e) => set('city', e.target.value)} />
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="field">
                <label htmlFor={`${uid}-goal`}>
                  Career goal <span className="muted small">(optional)</span>
                </label>
                <textarea
                  id={`${uid}-goal`}
                  className="input"
                  rows={3}
                  placeholder="e.g. Move into product management at a fintech company"
                  value={draft.careerGoal}
                  onChange={(e) => set('careerGoal', e.target.value)}
                />
              </div>
              <OrderedMultiSelect label="Target roles" options={ALL_ROLES} value={draft.roles} onChange={(v) => set('roles', v)} />
              <OrderedMultiSelect label="Industries" options={ALL_INDUSTRIES} value={draft.industries} onChange={(v) => set('industries', v)} />
            </>
          )}

          {step === 2 && (
            <>
              <p className="small muted" style={{ marginTop: 0 }}>
                Companies you want to meet <span className="muted">(optional)</span>. Events with these companies are recognized as networking.
              </p>
              <CompanyChips value={draft.companies} onChange={(v) => set('companies', v)} />
            </>
          )}

          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}

          <div className="welcome-actions">
            {step > 0 ? (
              <button type="button" className="btn secondary" onClick={() => (setError(null), setStep(step - 1))}>
                <ArrowLeft size={16} aria-hidden /> Back
              </button>
            ) : (
              <span />
            )}
            <button type="submit" className="btn">
              {step < STEPS.length - 1 ? (
                <>
                  Next <ArrowRight size={16} aria-hidden />
                </>
              ) : (
                'Go to my calendar'
              )}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
