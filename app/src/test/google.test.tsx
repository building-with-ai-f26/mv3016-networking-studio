import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAuthUrl, cleanDescription, mapCalendarEvent, nameFromEmail, parseCookies, REDIRECT_URI } from '../../server/google.mjs';
import { onboardedAccountState, renderApp } from './renderApp';

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
    // Only name + domain, never the full email.
    expect(e.attendees).toEqual([
      { name: '', domain: 'school.edu', self: true, organizer: false, responseStatus: 'accepted' },
      { name: 'Jordan', domain: 'acme.com', self: false, organizer: true, responseStatus: '' },
    ]);
    expect(JSON.stringify(e)).not.toMatch(/jordan@acme\.com|me@school\.edu/);
    expect(e.online).toBe(true); // has a Meet link
    expect(mapCalendarEvent({ id: 'd', start: { date: '2026-11-20' }, end: { date: '2026-11-21' } }).allDay).toBe(true);
  });

  it('cleans descriptions: no HTML, emails, links or phone numbers', () => {
    const d = cleanDescription('<p>Join <b>Meta</b> PM Sam (sam@meta.com)</p><br>https://zoom.us/j/123 · call +1 (212) 555-0100');
    expect(d).toContain('Meta');
    expect(d).not.toMatch(/sam@meta\.com|zoom\.us|555-0100|<b>/);
    expect(d).toContain('Sam (email at meta.com)'); // the name and the domain stay
  });

  it('reads a name from the email itself (never sending the email): hassan.khan → Hassan Khan', () => {
    expect(nameFromEmail('hassan.khan@school.edu')).toBe('Hassan Khan');
    expect(nameFromEmail('jordan@acme.com')).toBe('Jordan');
    expect(nameFromEmail('mv3016@school.edu')).toBe('');
    expect(nameFromEmail('careers.team@acme.com')).toBe('');
    const e = mapCalendarEvent({ id: 'h', summary: 'Chat', start: { dateTime: '2026-11-18T16:00:00-05:00' }, end: { dateTime: '2026-11-18T16:30:00-05:00' }, attendees: [{ email: 'hassan.khan@school.edu' }] });
    expect(e.attendees[0]).toMatchObject({ name: 'Hassan Khan', domain: 'school.edu' });
    expect(JSON.stringify(e)).not.toContain('hassan.khan@');
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
        if (url === '/api/state') return new Response(JSON.stringify({ state: onboardedAccountState() }));
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
    expect(screen.getByLabelText('Change type for Coffee chat with Sam')).toHaveValue('coffee_chat');
    expect(screen.queryByText('Demo week')).not.toBeInTheDocument(); // sample events and demo week only in demo mode
  });
});

describe('AI reading of an event (server helpers)', () => {
  it('sends no emails, excludes the student, and keeps sources', async () => {
    const { buildExtractRequest, parseExtractResponse, validateExtractInput } = await import('../../server/extract.mjs');
    const { input } = validateExtractInput({ title: 'Chat with sam@acme.com', description: 'Contact: dana@acme.com', studentNames: ['Alex Student'], attendees: [{ name: 'Hassan Khan', domain: 'school.edu' }] });
    const req = buildExtractRequest(input!, { model: 'gemini-3.5-flash-lite' });
    expect(req.contents[0].parts[0].text).not.toMatch(/@acme\.com|sam@|dana@/);
    expect(req.contents[0].parts[0].text).toContain('Hassan Khan · school.edu');
    const out = parseExtractResponse(
      { candidates: [{ content: { parts: [{ text: JSON.stringify({ people: [{ name: 'Alex Student', role: '', company: '', source: 'attendees' }, { name: 'Hassan Khan', role: '', company: '', source: 'attendees' }], companies: [], topic: 'Conference' }) }] } }] },
      input,
    );
    expect(out.result.people.map((p) => p.name)).toEqual(['Hassan Khan']);
  });
});
