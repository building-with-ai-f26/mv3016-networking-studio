import { CalendarDays, FlaskConical, Newspaper, Settings, Users } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useStore } from '../state/store';
import { Illustration } from './Illustration';

const NAV = [
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, match: ['/calendar', '/events'] },
  { to: '/contacts', label: 'Contacts', icon: Users, match: ['/contacts'] },
  { to: '/news', label: 'Industry News', icon: Newspaper, match: ['/news'] },
];

function initials(name: string): string {
  // Spec: header avatar shows MV for the seeded user.
  return name.trim() === 'Michaela' ? 'MV' : name.trim().split(/\s+/).map((p) => p[0]?.toUpperCase() ?? '').join('').slice(0, 2) || 'MV';
}

export function Layout() {
  const { state, persistStatus } = useStore();
  const { pathname } = useLocation();
  const isActive = (match: string[]) => match.some((m) => pathname.startsWith(m));

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="topbar">
        <NavLink to="/calendar" className="brand" aria-label="Networking Studio home (Calendar)">
          <span className="brand-mark">
            <Illustration kind="brand" size={30} />
          </span>
          <span className="brand-text">Networking Studio</span>
        </NavLink>
        <div className="topbar-right">
          <span className="demo-badge" title="Sample data. Calendar sync, AI responses, and email delivery are simulated.">
            <FlaskConical size={14} aria-hidden /> Demo mode
          </span>
          <span className="avatar" aria-label={`Signed in as ${state.profile.name} (demo profile)`} role="img">
            {initials(state.profile.name)}
          </span>
          <NavLink
            to="/settings"
            className="icon-btn"
            aria-label="Settings"
            aria-current={pathname.startsWith('/settings') ? 'page' : undefined}
          >
            <Settings size={20} aria-hidden />
          </NavLink>
        </div>
      </header>
      <div className="body-row">
        <nav className="sidenav" aria-label="Main">
          <ul>
            {NAV.map(({ to, label, icon: Icon, match }) => (
              <li key={to}>
                <NavLink to={to} className={() => (isActive(match) ? 'nav-link active' : 'nav-link')} aria-current={isActive(match) ? 'page' : undefined}>
                  <Icon size={19} aria-hidden /> {label}
                </NavLink>
              </li>
            ))}
          </ul>
          <p className="sidenav-foot">Lab lives inside Industry News.</p>
        </nav>
        <main id="main" className="main" tabIndex={-1}>
          {persistStatus !== 'ok' && (
            <div className="notice" role="status">
              {persistStatus === 'recovered'
                ? 'Saved demo data could not be read, so the sample data was restored. New changes will be saved in this browser.'
                : 'Changes cannot be saved in this browser right now (storage is unavailable). The demo still works, but changes will be lost on reload.'}
            </div>
          )}
          <Outlet />
        </main>
      </div>
      <nav className="bottomnav" aria-label="Main (mobile)">
        {NAV.map(({ to, label, icon: Icon, match }) => (
          <NavLink key={to} to={to} className={() => (isActive(match) ? 'active' : '')} aria-current={isActive(match) ? 'page' : undefined}>
            <Icon size={20} aria-hidden />
            {label === 'Industry News' ? 'News' : label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
