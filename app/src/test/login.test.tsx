import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from './renderApp';

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
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url === '/api/me' ? JSON.stringify({ configured: true, signedIn: true, email: 'student@example.com', name: 'Sam Student', calendarConnected: false }) : '{}')));
    renderApp('/login', { demo: false });
    expect(await screen.findByRole('link', { name: 'Connect Google Calendar' })).toHaveAttribute('href', '/auth/google/start?step=calendar');
    expect(screen.queryByText('Demo mode')).not.toBeInTheDocument();
  });
});
