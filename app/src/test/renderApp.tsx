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
