import { render } from '@testing-library/react';
import { MemoryRouter, useLocation, useRoutes, type Location } from 'react-router-dom';
import { routes } from '../routes';
import { StoreProvider } from '../state/store';

// jsdom + Node's fetch types clash with React Router's data router, so tests use a
// MemoryRouter with the same route table. A fresh StoreProvider re-reads localStorage (= reload).
export const router: { location: Location | null } = { location: null };

function Routes() {
  router.location = useLocation();
  return useRoutes(routes);
}

export function renderApp(path = '/calendar') {
  const utils = render(
    <StoreProvider>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes />
      </MemoryRouter>
    </StoreProvider>,
  );
  return { router, ...utils };
}
