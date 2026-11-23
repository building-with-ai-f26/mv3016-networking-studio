import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanEmailText, isBulkOrClub, normalizeEvents, parseIcal, safePublicUrl, sameEvent, validIcalUrl } from '../../server/discover.mjs';
import { byWeek, findEventLink, googleCalendarLink, isHighPriority, mergeEvents, scoreEvent, verifiedLink, visibleEvents } from '../lib/discover';
import type { DiscoverEvent, Profile } from '../types';
import { onboardedAccountState, renderApp } from './renderApp';

const DAY = 24 * 3600_000;
const now = Date.parse('2026-11-23T15:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const ev = (over: Partial<DiscoverEvent> = {}): DiscoverEvent => ({
  id: 'web-a',
  title: 'Product Management Mixer',
  start: iso(now + 3 * DAY),
  end: '',
  venue: 'Flatiron, NYC',
  organizer: 'Tech Social',
  price: 'Free',
  free: true,
  type: 'networking',
  why: 'PMs from fintech and media.',
  link: 'https://lu.ma/abc',
  source: 'web',
  sourceLabel: 'Web',
  ...over,
});
const profile = { name: 'Alex', program: 'MBA', city: 'NYC', timezone: 'America/New_York', careerGoal: 'PM', industries: ['Media', 'Fintech'], roles: ['Product Manager'], companies: ['Streamly', 'Payco'], showEmailPreview: false } as Profile;

describe('Discover (server helpers)', () => {
  it('keeps only upcoming in-person NYC events, and drops meeting or unsubscribe links', () => {
    const out = normalizeEvents(
      [
        { title: 'Panel at Streamly', start: iso(now + DAY), venue: 'SoHo', organizer: 'Club', price: 'Free', type: 'panel', inPersonNyc: true, why: 'x', link: 'https://www.eventbrite.com/e/123' },
        { title: 'Webinar', start: iso(now + DAY), venue: 'Online', organizer: 'X', price: 'Free', type: 'other', inPersonNyc: false, why: '' },
        { title: 'Past mixer', start: iso(now - 2 * DAY), venue: 'NYC', organizer: 'X', price: '$20', type: 'networking', inPersonNyc: true, why: '' },
        { title: 'Zoom link event', start: iso(now + 2 * DAY), venue: 'NYC', organizer: 'X', price: '$25', type: 'networking', inPersonNyc: true, why: '', link: 'https://zoom.us/j/123' },
      ],
      { source: 'web', sourceLabel: 'Web', now },
    );
    expect(out.map((e) => e.title)).toEqual(['Panel at Streamly', 'Zoom link event']);
    expect(out[0]).toMatchObject({ free: true, link: 'https://www.eventbrite.com/e/123' });
    expect(out[1]).toMatchObject({ free: false, price: '$25', link: '' });
  });

  it('reads newsletters and club emails only, never personal 1:1 emails', () => {
    expect(isBulkOrClub([{ name: 'List-Unsubscribe', value: '<mailto:x>' }, { name: 'From', value: 'News <news@company.com>' }])).toBe(true);
    expect(isBulkOrClub([{ name: 'From', value: 'Tech Club <techclub@stern.nyu.edu>' }])).toBe(true);
    expect(isBulkOrClub([{ name: 'From', value: 'NYU <notifications@nyu.campusgroups.com>' }])).toBe(true);
    expect(isBulkOrClub([{ name: 'From', value: 'Jordan <jordan@gmail.com>' }])).toBe(false);
  });

  it('keeps event links, removes meeting and unsubscribe links, emails and phone numbers', () => {
    const t = cleanEmailText('Register: https://www.eventbrite.com/e/123 Join: https://zoom.us/j/999 Unsubscribe https://x.com/unsubscribe?id=1 Contact a@b.com or +1 212 555 0101');
    expect(t).toContain('https://www.eventbrite.com/e/123');
    expect(t).not.toMatch(/zoom\.us|unsubscribe\?|a@b\.com|555/);
  });

  it('keeps a link only when the page is about the same event, and only public https pages', () => {
    expect(sameEvent('AI Dev 25 x NYC — Andrew Ng | Eventbrite', "AI Dev / New York City: Andrew Ng's AI Developer Conference")).toBe(true);
    expect(sameEvent('NYC Finance Tech Networking: Founders & Investors Night', "AI Dev / New York City: Andrew Ng's AI Developer Conference")).toBe(false);
    expect(safePublicUrl('https://www.eventbrite.com/e/1')).not.toBeNull();
    for (const bad of ['http://x.com', 'https://localhost/a', 'https://10.0.0.1/a', 'https://user:pw@x.com']) expect(safePublicUrl(bad)).toBeNull();
  });

  it('reads the CampusGroups calendar (only https links on campusgroups.com)', () => {
    expect(validIcalUrl('webcal://nyu.campusgroups.com/ical/abc.ics')).toBe('https://nyu.campusgroups.com/ical/abc.ics');
    expect(validIcalUrl('https://evil.example/x.ics')).toBeNull();
    expect(validIcalUrl('http://169.254.169.254/latest')).toBeNull();
    const [e] = parseIcal('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Tech Club Mixer\r\nDTSTART:20261203T180000\r\nLOCATION:KMC 2-70\\, 44 W 4th St\r\nURL:https://nyu.campusgroups.com/event/1\r\nEND:VEVENT\r\nEND:VCALENDAR');
    expect(e).toMatchObject({ title: 'Tech Club Mixer', start: '2026-12-03T23:00:00.000Z', venue: 'KMC 2-70, 44 W 4th St', inPersonNyc: true });
  });
});

describe('Discover (logic)', () => {
  it('merges duplicates (same title and day), keeps the richer one, and drops events that already happened', () => {
    const a = ev({ id: 'web-a', link: '' });
    const b = ev({ id: 'email-a', source: 'email', link: 'https://lu.ma/abc', why: 'From your Tech Club newsletter' });
    const old = ev({ id: 'old', title: 'Old', start: iso(now - DAY) });
    const merged = mergeEvents([a, old], [b], now);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('email-a');
  });

  it('ranks by fit: priority companies first; hides dismissed events and ones already on your calendar', () => {
    const fit = ev({ id: 'fit', title: 'Streamly product night' });
    const meh = ev({ id: 'meh', title: 'General business mixer', why: '' });
    const onCal = ev({ id: 'cal', title: 'Fintech founders breakfast' });
    expect(scoreEvent(fit, profile)).toBeGreaterThan(scoreEvent(meh, profile));
    const d = { events: [meh, fit, onCal, ev({ id: 'no', title: 'Not for me' })], lastWebAt: '', lastMailAt: '', processed: [], dismissed: ['no'], icalUrl: '' };
    const calendar = [{ id: 'u', title: 'Fintech founders breakfast', start: onCal.start, end: onCal.start, location: '', type: 'Other' as const, company: '', person: '', role: '', notes: '', source: 'manual' as const }];
    expect(visibleEvents(d, profile, calendar, now).map((e) => e.id)).toEqual(['fit', 'meh']);
  });

  it('groups by week, tags high priority, and never shows an unchecked link as Register', () => {
    const weeks = byWeek([ev({ id: 'a', start: iso(now + DAY) }), ev({ id: 'b', start: iso(now + 9 * DAY) }), ev({ id: 'c', start: iso(now + 20 * DAY) })], now);
    expect(weeks.map((w) => w.label)).toEqual(['This week', 'Next week', expect.stringMatching(/^Week of /)]);
    expect(isHighPriority(ev({ title: 'Payco fintech night' }), profile)).toBe(true);
    expect(isHighPriority(ev({ title: 'General mixer', why: '' }), profile)).toBe(false);
    expect(verifiedLink(ev({ link: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/x' }))).toBe('');
    expect(findEventLink(ev())).toMatch(/^https:\/\/www\.google\.com\/search\?q=Product%20Management%20Mixer/);
  });

  it('builds a pre-filled Google Calendar link (no permission needed)', () => {
    const url = new URL(googleCalendarLink(ev()));
    expect(url.hostname).toBe('calendar.google.com');
    expect(url.searchParams.get('text')).toBe('Product Management Mixer');
    expect(url.searchParams.get('dates')).toMatch(/^\d{8}T\d{6}Z\/\d{8}T\d{6}Z$/);
  });
});

describe('Discover (in the app)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows fitting events without a refresh button; paid ones are marked; Add to my calendar works', async () => {
    const realNow = Date.now();
    const events = [
      ev({ id: 'e1', title: 'Streamly product night', start: iso(realNow + 2 * DAY) }),
      ev({ id: 'e2', title: 'Media strategy summit', start: iso(realNow + 5 * DAY), free: false, price: '$45', type: 'conference', source: 'email', sourceLabel: 'Email · Media Club' }),
    ];
    const base = onboardedAccountState();
    const state = { ...base, profile: { ...base.profile, companies: ['Streamly'] }, discover: { events, lastWebAt: iso(realNow), lastMailAt: iso(realNow), processed: [], dismissed: [], icalUrl: '' } };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/state') return new Response(JSON.stringify({ state }));
        if (url === '/api/me') return new Response(JSON.stringify({ configured: true, signedIn: true, email: 'student@example.com', calendarConnected: false, gmailConnected: false }));
        return new Response('{}', { status: 404 });
      }),
    );
    renderApp('/discover');
    const first = (await screen.findByRole('heading', { name: 'Streamly product night' })).closest('article')!;
    expect(screen.queryByRole('button', { name: /Refresh/ })).toBeNull();
    const paid = screen.getByRole('heading', { name: 'Media strategy summit' }).closest('article')!;
    expect(paid).toHaveTextContent('Paid');
    expect(paid).not.toHaveTextContent('$45');
    expect(screen.getByRole('heading', { name: /This week|Next week|Week of/ })).toBeInTheDocument();
    expect(first).toHaveTextContent('High priority');
    expect(within(first as HTMLElement).getByRole('link', { name: /Register/ })).toHaveAttribute('href', 'https://lu.ma/abc');
    await userEvent.setup().click(within(first as HTMLElement).getByRole('button', { name: /Add to my calendar/ }));
    expect(await screen.findByText(/Added to your calendar/)).toBeInTheDocument();
  });
});
