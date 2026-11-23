import { describe, expect, it, vi } from 'vitest';
import { collectCandidates, eventsFromHtml, isNyc, looksLikeSpam, toCandidate, topicsFor, trustedEvents } from '../../server/eventsources.mjs';

const DAY = 24 * 3600_000;
const now = Date.parse('2026-11-23T15:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const place = (locality: string, zip = '10001') => ({ '@type': 'Place', name: 'Venue', address: { addressLocality: locality, addressRegion: 'NY', postalCode: zip, streetAddress: '1 Main St' } });
const event = (over: Record<string, unknown> = {}) => ({
  '@type': 'Event',
  name: 'Building in Fintech: From Product to First Customers',
  url: 'https://www.eventbrite.com/e/building-in-fintech-123',
  startDate: iso(now + 5 * DAY),
  eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
  eventStatus: 'https://schema.org/EventScheduled',
  location: place('New York'),
  organizer: { name: 'Fintech Builders NYC' },
  offers: { price: '0' },
  description: 'A panel with fintech product leaders.',
  ...over,
});
const page = (...events: unknown[]) => `<html><script type="application/ld+json">${JSON.stringify({ '@type': 'ItemList', itemListElement: events.map((item, i) => ({ '@type': 'ListItem', position: i + 1, item })) })}</script></html>`;

describe('Trusted event sources', () => {
  it('reads events from the platform data (ItemList or Event)', () => {
    expect(eventsFromHtml(page(event(), event({ name: 'Other' })))).toHaveLength(2);
    expect(eventsFromHtml(`<script type="application/ld+json">${JSON.stringify(event())}</script>`)).toHaveLength(1);
  });

  it('keeps only trusted, in-person, scheduled NYC events in the next 2 months, free/paid from the offer', () => {
    expect(toCandidate(event(), now)).toMatchObject({ platform: 'Eventbrite', price: 'Free', organizer: 'Fintech Builders NYC' });
    expect(toCandidate(event({ url: 'https://scam-events.biz/e/1' }), now)).toBeNull();
    expect(toCandidate(event({ eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode' }), now)).toBeNull();
    expect(toCandidate(event({ eventStatus: 'https://schema.org/EventCancelled' }), now)).toBeNull();
    expect(toCandidate(event({ location: place('Jersey City', '07302') }), now)).toBeNull();
    expect(toCandidate(event({ startDate: iso(now + 90 * DAY) }), now)).toBeNull();
    expect(toCandidate(event({ offers: { lowPrice: '25' } }), now)?.price).toBe('Paid');
    expect(toCandidate(event({ url: 'https://luma.com/abc', location: place('Brooklyn', '11201') }), now)?.platform).toBe('Luma');
  });

  it('recognizes NYC by borough or ZIP and blocks spam and promoter mixers', () => {
    expect(isNyc({ addressLocality: 'Kings County', addressRegion: 'NY' })).toBe(true);
    expect(isNyc({ addressLocality: 'Hoboken', addressRegion: 'NJ', postalCode: '07030' })).toBe(false);
    expect(looksLikeSpam('Speed Dating for Professionals')).toBe(true);
    expect(looksLikeSpam('Networking Mixer | Private Equity | Venture Capital | Law | Fintech')).toBe(true);
    expect(looksLikeSpam('Women in AI Networking NYC', 'Business Minds Events')).toBe(true);
    expect(looksLikeSpam('The Future of AI Infrastructure', 'Startup Grind NYC')).toBe(false);
  });

  it('searches the platforms with the profile topics and keeps going if Eventbrite says "too many requests"', async () => {
    expect(topicsFor({ roles: ['Product Manager'], industries: ['Media & Entertainment'], companies: ['Streamly'] })).toEqual(['product', 'media', 'entertainment', 'streamly', 'conference', 'mba']);
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('eventbrite')) throw Object.assign(new Error('rate limited'), { rateLimited: true });
      if (url.includes('meetup')) return page(event({ url: 'https://www.meetup.com/nyc-product/events/1/', name: 'Product Leaders NYC' }));
      return page(event({ url: 'https://luma.com/x1', name: 'Media strategy night' }));
    });
    const list = await collectCandidates({ roles: ['Product Manager'], industries: [], companies: [] }, now, fetcher, 0);
    expect(fetcher.mock.calls.filter(([u]) => String(u).includes('eventbrite'))).toHaveLength(1); // stopped after the 429
    expect(list.map((c) => c.platform).sort()).toEqual(['Luma', 'Meetup']);
  });

  it('the AI only rates relevance; it never adds events, and low-relevance or non-credible ones are dropped', async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.includes('/e/') || url.includes('/events/') || /luma\.com\/[a-z0-9]+$/.test(url)
        ? `<script type="application/ld+json">${JSON.stringify(event({ url, name: url.includes('meetup') ? 'Product Leaders NYC' : url.includes('luma') ? 'Apple picking' : 'Building in Fintech: From Product to First Customers' }))}</script>`
        : page(event(), event({ url: 'https://www.meetup.com/nyc-product/events/1/', name: 'Product Leaders NYC' }), event({ url: 'https://luma.com/abc', name: 'Apple picking' })),
    );
    const call = vi.fn(async () => ({
      ok: true,
      status: 200,
      data: { candidates: [{ content: { parts: [{ text: JSON.stringify({ ratings: [{ index: 0, relevance: 90, credible: true, type: 'panel', why: 'Fintech product panel.' }, { index: 1, relevance: 80, credible: false, type: 'networking' }, { index: 2, relevance: 10, credible: true, type: 'other' }, { index: 99, relevance: 99, credible: true, type: 'panel' }] }) }] } }] },
    }));
    const out = await trustedEvents({ roles: ['Product Manager'], industries: ['Fintech'], companies: [] }, 'PM in fintech', call, 'm', now, fetcher, 0);
    expect(out.events.map((e) => e.title)).toEqual(['Building in Fintech: From Product to First Customers']);
    expect(out.events[0]).toMatchObject({ link: 'https://www.eventbrite.com/e/building-in-fintech-123', sourceLabel: '✓ Eventbrite', why: 'Fintech product panel.', type: 'panel' });
  });
});
