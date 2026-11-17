import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildClassifyRequest, parseClassifyResponse, validateClassifyInput } from '../../server/classify.mjs';
import { classifyByRules, companiesFromAttendees, companyFromDomain, fallbackForAmbiguous, personFromTitle } from '../lib/classifier';
import type { GoogleAttendee, UserEvent } from '../types';
import { onboardedAccountState, renderApp } from './renderApp';

const me: GoogleAttendee = { email: 'student@stern.nyu.edu', name: '', self: true, organizer: false, responseStatus: 'accepted' };
const guest = (email: string): GoogleAttendee => ({ email, name: '', self: false, organizer: true, responseStatus: 'accepted' });

function gev(title: string, opts: Partial<NonNullable<UserEvent['google']>> = {}): UserEvent {
  return {
    id: `g-${title}`,
    title,
    start: '2026-11-18T16:00:00-05:00',
    end: '2026-11-18T17:00:00-05:00',
    location: '',
    type: 'Other',
    company: '',
    person: '',
    role: '',
    notes: '',
    source: 'google',
    google: { description: '', allDay: false, eventType: 'default', recurringEventId: null, selfResponse: 'accepted', attendees: [me, guest('host@stern.nyu.edu')], ...opts },
  };
}
const ctx = { targetCompanies: ['Spotify', 'Siemens'] };
const typeOf = (ev: UserEvent) => classifyByRules(ev, ctx)?.type ?? 'ambiguous';

describe('Networking classifier: rules', () => {
  it.each([
    ['TECH-GB 2160 Lecture', 'not_networking'],
    ['Corporate Finance Recitation', 'not_networking'],
    ['Section 3 midterm exam', 'not_networking'],
    ['Office hours with professor', 'not_networking'],
    ['Coffee chat with Jordan Lee', 'coffee_chat'],
    ['Ana <> Jordan', 'coffee_chat'],
    ['Mock interview with career coach', 'mock_interview'],
    ['Spotify interview - round 2', 'interview'],
    ['Career Panel: Inside Go-to-Market Roles', 'career_panel'],
    ['STA: Lunch and Learn with Taylor Brooks', 'company_presentation'],
    ['DevSummit [Corp Rel - Sponsors]', 'not_networking'],
    ['STA Board Meeting', 'not_networking'],
    ['Civic Board Fellows Interview', 'not_networking'],
    ['EFL Fellow orientation', 'not_networking'],
    ['Sam / Maya - Weekly Connect', 'not_networking'],
    ['Siemens Info Session', 'company_presentation'],
    ['Media & Sports Alumni Mixer', 'networking_event'],
    ['Recruiting happy hour', 'networking_event'],
    ['Stern Tech Trek: Bay Area', 'networking_event'],
  ])('“%s” → %s', (title, expected) => {
    expect(typeOf(gev(title))).toBe(expected);
  });

  it('excludes all-day, declined, out-of-office and focus time events', () => {
    expect(typeOf(gev('Coffee chat', { allDay: true }))).toBe('not_networking');
    expect(typeOf(gev('Coffee chat', { selfResponse: 'declined' }))).toBe('not_networking');
    expect(typeOf(gev('OOO', { eventType: 'outOfOffice' }))).toBe('not_networking');
    expect(typeOf(gev('Deep work', { eventType: 'focusTime' }))).toBe('not_networking');
  });

  it('treats recurring meetings as not networking', () => {
    expect(typeOf(gev('Coffee chat with Sam', { recurringEventId: 'series1' }))).toBe('not_networking');
  });

  it('excludes events with no other attendees, unless the title has a networking signal', () => {
    expect(typeOf(gev('Read case for Thursday', { attendees: [me] }))).toBe('not_networking');
    expect(typeOf(gev('Coffee chat with Sam', { attendees: [me] }))).toBe('coffee_chat');
  });

  it('sends ambiguous events (company attendee, no clear type) to the AI, with a sensible fallback', () => {
    const ev = gev('Catch up', { attendees: [me, guest('jordan@meta.com')] });
    expect(classifyByRules(ev, ctx)).toBeNull();
    expect(fallbackForAmbiguous(ev, ctx)).toMatchObject({ type: 'networking_event', company: 'Meta' });
  });

  it('extracts the company from non-school email domains and the person from the title', () => {
    expect(companyFromDomain('meta.com')).toBe('Meta');
    expect(companyFromDomain('mail.spotify.co.uk')).toBe('Spotify');
    expect(companiesFromAttendees(gev('x', { attendees: [me, guest('a@gmail.com'), guest('b@nyu.edu'), guest('c@siemens.com')] }))).toEqual(['Siemens']);
    expect(personFromTitle('Coffee chat with Jordan Lee')).toBe('Jordan Lee');
    expect(personFromTitle('Ana <> Jordan')).toBe('Jordan');
  });
});

describe('Networking classifier: AI step (server helpers)', () => {
  it('never sends emails and asks for strict JSON', () => {
    const { input } = validateClassifyInput({ title: 'Catch up', description: 'x', attendeeCompanies: ['Meta'], attendeeCount: 2, targetCompanies: [] });
    const req = buildClassifyRequest(input!, { model: 'gemini-3.5-flash-lite' });
    expect(req.contents[0].parts[0].text).not.toMatch(/@/);
    expect(req.generationConfig).toMatchObject({ responseMimeType: 'application/json', temperature: 0 });
    const out = parseClassifyResponse({ candidates: [{ content: { parts: [{ text: '{"type":"coffee_chat","confidence":0.8,"reason":"1:1 with a PM","company":"Meta","person":"","role":""}' }] } }] });
    expect(out.result).toMatchObject({ type: 'coffee_chat', company: 'Meta' });
    expect(() => parseClassifyResponse({ candidates: [{ content: { parts: [{ text: '{"type":"party"}' }] } }] })).toThrow();
  });
});

describe('Calendar: classification badges and overrides', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('hides classes, shows networking events with a reason, and remembers overrides', async () => {
    const at = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
    const mk = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
      id, title, start: at(2), end: at(3), allDay: false, location: '', description: '', eventType: 'default', recurringEventId: null, selfResponse: 'accepted', status: 'confirmed',
      attendees: [{ email: 'me@nyu.edu', name: '', self: true, organizer: false, responseStatus: 'accepted' }, { email: 'host@nyu.edu', name: '', self: false, organizer: true, responseStatus: 'accepted' }],
      ...extra,
    });
    let saved: { classOverrides?: Record<string, string> } = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/state' && init?.method === 'PUT') {
          saved = JSON.parse(String(init.body));
          return new Response('{"ok":true}');
        }
        if (url === '/api/state') return new Response(JSON.stringify({ state: onboardedAccountState() }));
        if (url === '/api/me') return new Response(JSON.stringify({ configured: true, signedIn: true, email: 'student@example.com', calendarConnected: true }));
        if (url === '/api/calendar/events') return new Response(JSON.stringify({ events: [mk('a', 'TECH-GB 2160 Lecture'), mk('b', 'Coffee chat with Sam'), mk('c', 'Weekly club sync', { recurringEventId: 'series1' })] }));
        return new Response('{}', { status: 404 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/calendar');
    const card = (await screen.findByRole('link', { name: 'Coffee chat with Sam' })).closest('article')!;
    const badge = within(card as HTMLElement).getByLabelText('Change type for Coffee chat with Sam');
    expect(badge).toHaveValue('coffee_chat');
    expect(badge).toHaveAttribute('title', 'Why: Title says “coffee chat”');
    expect(screen.queryByText('TECH-GB 2160 Lecture')).not.toBeInTheDocument();
    expect(screen.queryByText('Weekly club sync')).not.toBeInTheDocument(); // recurring
    expect(screen.queryByRole('button', { name: /Show hidden events/ })).not.toBeInTheDocument();

    // No brief yet: only the white Generate button, no Open brief.
    expect(within(card as HTMLElement).getByRole('button', { name: /Generate brief with AI/ })).toHaveClass('secondary');
    expect(within(card as HTMLElement).queryByRole('link', { name: /Open brief/ })).not.toBeInTheDocument();

    // Correcting the type hides the event and is remembered.
    await user.selectOptions(badge, 'not_networking');
    expect(screen.queryByRole('link', { name: 'Coffee chat with Sam' })).not.toBeInTheDocument();
    // Saved with the account's data on the server.
    await waitFor(() => expect(saved.classOverrides).toEqual({ 'g-b': 'not_networking' }));
  });
});
