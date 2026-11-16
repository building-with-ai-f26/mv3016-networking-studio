import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAuthUrl, cleanDescription, mapCalendarEvent, parseCookies, REDIRECT_URI } from '../../server/google.mjs';
import { renderApp } from './renderApp';

describe('Google server helpers', () => {
  it('sign-in asks only for identity; calendar step asks for read-only calendar with offline access', () => {
    const signin = new URL(buildAuthUrl({ clientId: 'cid', step: 'signin', state: 's1' }));
    expect(signin.searchParams.get('scope')).toBe('openid email profile');
    expect(signin.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    const cal = new URL(buildAuthUrl({ clientId: 'cid', step: 'calendar', state: 's2', loginHint: 'a@b.com' }));
    expect(cal.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/calendar.readonly');
    expect(cal.searchParams.get('scope')).not.toMatch(/calendar(?!\.readonly)\b(?!\.)/);
    expect(cal.searchParams.get('access_type')).toBe('offline');
    expect(cal.searchParams.get('login_hint')).toBe('a@b.com');
  });

  it('keeps only the fields the app needs (no description or meeting links)', () => {
    const e = mapCalendarEvent({
      id: 'x1',
      summary: 'Coffee chat',
      description: 'private notes',
      hangoutLink: 'https://meet.example/abc',
      start: { dateTime: '2026-11-18T16:00:00-05:00' },
      end: { dateTime: '2026-11-18T16:30:00-05:00' },
      attendees: [
        { email: 'me@school.edu', self: true, responseStatus: 'accepted' },
        { email: 'room@resource.calendar.google.com', resource: true },
        { email: 'jordan@acme.com', displayName: 'Jordan', organizer: true },
      ],
    });
    expect(e.description).toBe('private notes');
    expect(e).not.toHaveProperty('hangoutLink');
    expect(e.selfResponse).toBe('accepted');
    expect(e.attendees.map((a) => a.email)).toEqual(['me@school.edu', 'jordan@acme.com']);
    expect(mapCalendarEvent({ id: 'd', start: { date: '2026-11-20' }, end: { date: '2026-11-21' } }).allDay).toBe(true);
  });

  it('cleans descriptions: no HTML, emails, links or phone numbers', () => {
    const d = cleanDescription('<p>Join <b>Meta</b> PM Sam (sam@meta.com)</p><br>https://zoom.us/j/123 · call +1 (212) 555-0100');
    expect(d).toContain('Meta');
    expect(d).not.toMatch(/sam@meta\.com|zoom\.us|555-0100|<b>/);
  });

  it('parses cookies', () => {
    expect(parseCookies('a=1; ns_sid=abc%20d')).toEqual({ a: '1', ns_sid: 'abc d' });
  });
});

describe('Calendar with Google connected', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opens on the current week and shows Google events with their source', async () => {
    const start = new Date(Date.now() + 2 * 3600_000);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/me') return new Response(JSON.stringify({ configured: true, signedIn: true, email: 'student@example.com', calendarConnected: true }));
        if (url === '/api/calendar/events')
          return new Response(
            JSON.stringify({
              events: [{ id: 'abc', title: 'Coffee chat with Sam', start: start.toISOString(), end: new Date(start.getTime() + 1800_000).toISOString(), allDay: false, location: '', eventType: 'default', recurringEventId: null, selfResponse: 'accepted', status: 'confirmed', attendees: [] }],
            }),
          );
        return new Response('{}', { status: 404 });
      }),
    );
    renderApp('/calendar');
    expect(await screen.findByRole('link', { name: 'Coffee chat with Sam' })).toHaveAttribute('href', '/events/g-abc');
    expect(screen.getByText('Google Calendar')).toBeInTheDocument();
    expect(screen.getByText(/Google Calendar connected \(read-only\)/)).toBeInTheDocument();
  });
});
