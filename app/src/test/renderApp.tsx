import { render } from '@testing-library/react';
import { MemoryRouter, useLocation, useRoutes, type Location } from 'react-router-dom';
import { routes } from '../routes';
import { createAccountState } from '../services/storage';
import { StoreProvider } from '../state/store';

// jsdom + Node's fetch types clash with React Router's data router, so tests use a
// MemoryRouter with the same route table. A fresh StoreProvider re-reads localStorage (= reload).
export const router: { location: Location | null } = { location: null };

function Routes() {
  router.location = useLocation();
  return useRoutes(routes);
}

export function renderApp(path = '/calendar', { demo = true }: { demo?: boolean } = {}) {
  // Tests explore the app in demo mode unless they test the login screen.
  if (demo) localStorage.setItem('networking-studio:demo-mode', '1');
  const utils = render(
    <StoreProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes />
      </MemoryRouter>
    </StoreProvider>,
  );
  return { router, ...utils };
}

/** Saved data for a signed-in test account that already answered "Almost set!". */
export function onboardedAccountState() {
  return { ...createAccountState('Sam Student'), profile: { ...createAccountState('Sam Student').profile, roles: ['Product Management'], industries: ['Technology & AI'] }, onboarded: true };
}

/**
 * A base time for "events in a few hours" that stays in the current New York week (tests that open the calendar on
 * the current week would otherwise fail on Sunday evenings, when "in 2 hours" is already next week).
 */
export function sameWeekBase(): number {
  const now = Date.now();
  const weekOf = (ms: number) => {
    const d = new Date(`${new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  return weekOf(now + 8 * 3600_000) === weekOf(now) ? now : now - 10 * 3600_000;
}
