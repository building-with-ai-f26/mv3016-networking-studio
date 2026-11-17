import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onboardedAccountState, renderApp } from './renderApp';

describe('Login screen', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the login before the app, and the demo stays available', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/calendar', { demo: false });
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.queryByText('Your networking week')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Explore the demo without signing in' }));
    expect(await screen.findByText('Your networking week')).toBeInTheDocument();
    expect(router.location?.pathname).toBe('/calendar');
  });

  it('Settings has an Account section to leave the demo (or log out)', async () => {
    const user = userEvent.setup();
    renderApp('/settings');
    await user.click(await screen.findByRole('button', { name: 'Exit demo' }));
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(localStorage.getItem('networking-studio:demo-mode')).toBeNull();
  });

  it('validates the email before going to Google', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ configured: true, signedIn: false }))));
    const user = userEvent.setup();
    renderApp('/login', { demo: false });
    await screen.findByRole('heading', { name: 'Log in' });
    await user.type(screen.getByLabelText(/Email/), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Log in with Google' }));
    expect(screen.getByText(/Enter a valid email address/)).toBeInTheDocument();
  });

  it('a signed-in Google user goes straight to the calendar and is asked to connect it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/api/state'
          ? new Response(JSON.stringify({ state: onboardedAccountState() }))
          : new Response(url === '/api/me' ? JSON.stringify({ configured: true, signedIn: true, email: 'student@example.com', name: 'Sam Student', calendarConnected: false }) : '{}'),
      ),
    );
    renderApp('/login', { demo: false });
    expect(await screen.findByRole('link', { name: 'Connect Google Calendar' })).toHaveAttribute('href', '/auth/google/start?step=calendar');
    expect(screen.queryByText('Demo mode')).not.toBeInTheDocument();
  });
});

describe('Create account → "Almost set!"', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a new account answers 3 welcome questions (no pre-filled sample profile), then sees its calendar; answers are saved on the server', async () => {
    const puts: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/me') return new Response(JSON.stringify({ configured: true, signedIn: true, email: 'new@example.com', name: 'Taylor Brooks', calendarConnected: false }));
        if (url === '/api/state' && init?.method === 'PUT') {
          puts.push(JSON.parse(String(init.body)));
          return new Response('{"ok":true}');
        }
        if (url === '/api/state') return new Response(JSON.stringify({ state: null })); // new account: nothing saved yet
        return new Response('{}', { status: 404 });
      }),
    );
    const user = userEvent.setup();
    const { router } = renderApp('/calendar', { demo: false });
    expect(await screen.findByRole('heading', { name: 'Almost set!' })).toBeInTheDocument();
    expect(router.location?.pathname).toBe('/welcome');

    // Step 1: name comes from Google; nothing else is pre-filled from the sample profile.
    expect(screen.getByLabelText('Name')).toHaveValue('Taylor Brooks');
    expect(screen.getByLabelText(/School \/ program/)).toHaveValue('');
    await user.type(screen.getByLabelText(/School \/ program/), 'MBA 2027');
    await user.click(screen.getByRole('button', { name: /Next/ }));

    // Step 2: at least one role and one industry are required.
    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose at least one target role.');
    await user.click(screen.getByRole('button', { name: /Add Product Management/ }));
    await user.click(screen.getByRole('button', { name: /Add Healthcare/ }));
    await user.click(screen.getByRole('button', { name: /Next/ }));

    // Step 3: companies are optional.
    expect(screen.queryByText('Mastercard')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Go to my calendar' }));
    expect(await screen.findByText('Your networking week')).toBeInTheDocument();

    await waitFor(() => expect(puts.length).toBeGreaterThan(0));
    const saved = puts[puts.length - 1] as { onboarded: boolean; contacts: unknown[]; profile: { program: string; roles: string[]; industries: string[]; companies: string[] } };
    expect(saved.onboarded).toBe(true);
    expect(saved.contacts).toEqual([]); // no sample contacts in a real account
    expect(saved.profile).toMatchObject({ program: 'MBA 2027', roles: ['Product Management'], industries: ['Healthcare'], companies: [] });
  });
});
