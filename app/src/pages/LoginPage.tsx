// First screen. Two paths:
// - Create account: Google asks once for your name, email and read-only calendar access.
// - Log in: just pick your Google account; you land directly in your session (calendar already granted).
// Demo mode stays available without an account.
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Illustration } from '../components/Illustration';
import { useStore } from '../state/store';

const MESSAGES: Record<string, string> = {
  cancelled: 'Google sign-in was cancelled. You can try again.',
  error: 'Google sign-in failed. If your school account blocks test apps, try a personal Gmail (added as a test user).',
  'not-configured': 'Google sign-in is not set up yet: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to app/.env.',
};

type Mode = 'login' | 'signup';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function LoginPage() {
  const uid = useId();
  const navigate = useNavigate();
  const { google, enterDemo } = useStore();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const flag = new URLSearchParams(window.location.search).get('google');

  useEffect(() => {
    document.title = 'Sign in · Networking Studio';
    return () => {
      document.title = 'Networking Studio';
    };
  }, []);

  if (google.status === 'ready' && google.signedIn) return <Navigate to="/calendar" replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = email.trim();
    // The email is optional: it only pre-selects the Google account.
    if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return setError('Enter a valid email address, or leave it empty.');
    if (google.status !== 'ready') return setError('The local server is not running. Start it with npm run dev, or explore the demo.');
    if (!google.configured) return setError(MESSAGES['not-configured']);
    const hint = v ? `&login_hint=${encodeURIComponent(v)}` : '';
    window.location.assign(`/auth/google/start?step=${mode}${hint}`);
  };

  return (
    <main className="login-shell" id="main">
      <div className="card login-card">
        <div className="login-brand">
          <span className="brand-mark">
            <Illustration kind="brand" size={34} />
          </span>
          <span className="brand-text">Networking Studio</span>
        </div>
        <h1>{mode === 'login' ? 'Log in' : 'Create your account'}</h1>
        <p className="muted">Get an AI prep brief before every coffee chat, panel and info session in your calendar.</p>

        <div className="tabs login-tabs" role="tablist" aria-label="Log in or create an account">
          <button type="button" role="tab" className="tab" aria-selected={mode === 'login'} onClick={() => setMode('login')}>
            Log in
          </button>
          <button type="button" role="tab" className="tab" aria-selected={mode === 'signup'} onClick={() => setMode('signup')}>
            Create account
          </button>
        </div>

        {flag && MESSAGES[flag] && (
          <p className="notice" role="alert">
            {MESSAGES[flag]}
          </p>
        )}

        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor={`${uid}-email`}>
              Email <span className="muted small">(optional)</span>
            </label>
            <input
              id={`${uid}-email`}
              className="input"
              type="email"
              autoComplete="email"
              placeholder="you@gmail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${uid}-err` : undefined}
            />
            {error && (
              <span className="field-error" id={`${uid}-err`}>
                {error}
              </span>
            )}
          </div>
          <button type="submit" className="btn login-google" disabled={google.status === 'loading'}>
            <GoogleIcon />
            {mode === 'login' ? 'Log in with Google' : 'Create account with Google'}
          </button>
        </form>
        <p className="muted small" style={{ marginTop: 10 }}>
          {mode === 'login'
            ? 'Already have an account? Pick your Google account and you go straight to your calendar.'
            : 'Google will ask once for your name, email and read-only access to your calendar. Networking Studio never changes your calendar.'}
        </p>

        <div className="login-divider" role="separator">
          <span>or</span>
        </div>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            enterDemo();
            navigate('/calendar');
          }}
        >
          Explore the demo without signing in
        </button>
      </div>
    </main>
  );
}
