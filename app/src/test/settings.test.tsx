import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from './renderApp';

const groupOrder = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent ?? '').filter((t) => t.startsWith('#'));

describe('Settings', () => {
  it('priority changes persist and reorder news groups', async () => {
    const user = userEvent.setup();
    const first = renderApp('/settings');
    await user.click(screen.getByRole('button', { name: 'Move Industrial Technology up' }));
    await user.click(screen.getByRole('button', { name: 'Move Industrial Technology up' }));
    await user.click(screen.getByRole('button', { name: 'Move Industrial Technology up' }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByText('Settings saved')).toBeInTheDocument();
    first.unmount();

    renderApp('/news');
    expect(groupOrder()).toEqual(['#1Industrial Technology', '#2Fintech & Payments', '#3Technology & AI', '#4Media & Entertainment']);
  });

  it('Cancel discards unsaved changes', async () => {
    const user = userEvent.setup();
    renderApp('/settings');
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Someone Else');
    await user.click(screen.getByRole('button', { name: 'Move Product Strategy up' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Alex');
    expect(screen.getByRole('button', { name: 'Move Product Management up' })).toBeDisabled();
  });

  it('prevents case-insensitive duplicate companies and validates required fields', async () => {
    const user = userEvent.setup();
    renderApp('/settings');
    await user.type(screen.getByLabelText('Add a target company'), 'siemens{enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('already on your list');
    await user.clear(screen.getByLabelText('Name'));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByText('Name is required.')).toBeInTheDocument();
  });

  it('Google: shows sign-in when configured, then connect calendar, sign out and disconnect', async () => {
    let me = { configured: true, signedIn: false, email: null as string | null, calendarConnected: false };
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/me') return new Response(JSON.stringify(me));
      if (url === '/auth/disconnect') return new Response('{"ok":true}');
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderApp('/settings');
    expect(await screen.findByRole('link', { name: 'Sign in with Google' })).toHaveAttribute('href', '/auth/google/start?step=signin');
    cleanup();

    me = { configured: true, signedIn: true, email: 'student@example.com', calendarConnected: false };
    const user = userEvent.setup();
    renderApp('/settings');
    expect(await screen.findByRole('link', { name: 'Connect Google Calendar' })).toHaveAttribute('href', '/auth/google/start?step=calendar');
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(fetchMock).toHaveBeenCalledWith('/auth/disconnect', expect.objectContaining({ method: 'POST' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument(); // back to the login screen
    vi.unstubAllGlobals();
  });

  it('reset demo data requires confirmation and restores samples', async () => {
    const user = userEvent.setup();
    renderApp('/settings');
    await user.click(screen.getByRole('button', { name: 'Remove Siemens' }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await user.click(screen.getByRole('button', { name: /Reset demo data/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Remove Siemens' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Reset demo data/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reset demo data' }));
    expect(screen.getByRole('button', { name: 'Remove Siemens' })).toBeInTheDocument();
  });
});

describe('Storage fallback', () => {
  it('recovers from corrupt saved data', () => {
    localStorage.setItem('networking-studio:v1', '{not json');
    renderApp('/calendar');
    expect(screen.getByText(/could not be read, so the sample data was restored/)).toBeInTheDocument();
    expect(screen.getAllByTestId(/^event-/)).toHaveLength(4);
  });
});
