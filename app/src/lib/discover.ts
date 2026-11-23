// Discover: merge events from the web, newsletters and CampusGroups; score them against the student's profile;
// show only upcoming ones that are not already on the calendar or dismissed.
import type { DiscoverEvent, DiscoverState, Profile, UserEvent } from '../types';
import { nyDateKey } from './time';

export const WEB_EVERY_MS = 24 * 3600_000;
export const MAIL_EVERY_MS = 3 * 3600_000;

export const EMPTY_DISCOVER: DiscoverState = { events: [], lastWebAt: '', lastMailAt: '', processed: [], dismissed: [], icalUrl: '' };

const key = (e: { title: string; start: string }) => `${e.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 50)}|${nyDateKey(e.start)}`;

/** Adds new events (same title + day = same event; keeps the one with more details) and drops events that already ended. */
export function mergeEvents(current: DiscoverEvent[], incoming: DiscoverEvent[], now = Date.now()): DiscoverEvent[] {
  const byKey = new Map<string, DiscoverEvent>();
  // A checked event page counts most; an old unchecked Google redirect link counts nothing.
  const richness = (e: DiscoverEvent) => (e.link && !/vertexaisearch\.cloud\.google\.com/.test(e.link) ? 2 : 0) + (e.venue ? 1 : 0) + (e.why ? 1 : 0) + (e.price !== 'Not listed' ? 1 : 0);
  for (const e of [...current, ...incoming]) {
    const k = key(e);
    const prev = byKey.get(k);
    if (!prev || richness(e) >= richness(prev)) byKey.set(k, { ...e, foundAt: prev?.foundAt ?? e.foundAt });
  }
  return [...byKey.values()].filter((e) => Date.parse(e.end || e.start) + (e.end ? 0 : 3 * 3600_000) > now).slice(0, 300);
}

/** How well an event fits the profile: priority companies, then target roles, industries, event type; free gets a small bonus. */
export function scoreEvent(e: DiscoverEvent, p: Profile): number {
  const t = `${e.title} ${e.organizer} ${e.why} ${e.venue}`.toLowerCase();
  let s = 0;
  p.companies.forEach((c, i) => c && t.includes(c.toLowerCase()) && (s += 100 - i * 5));
  p.roles.forEach((r, i) => r && t.includes(r.toLowerCase().replace(/ manager$/, '')) && (s += 25 - i * 2));
  p.industries.forEach((x, i) => x && t.includes(x.toLowerCase().split(/[ &/]/)[0]) && (s += 15 - i));
  if (['networking', 'panel', 'conference'].includes(e.type)) s += 10;
  if (e.source !== 'web') s += 8; // from your own newsletters, clubs or CampusGroups
  if (e.free) s += 3;
  return s;
}

const similarTitle = (a: string, b: string) => {
  const w = (x: string) => new Set(x.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((y) => y.length > 3));
  const x = w(a);
  const y = w(b);
  if (!x.size || !y.size) return false;
  let shared = 0;
  for (const v of x) if (y.has(v)) shared++;
  return shared / Math.min(x.size, y.size) >= 0.6;
};

/** Upcoming, not dismissed, not already on the calendar; best fit first, then sooner. */
export function visibleEvents(d: DiscoverState, profile: Profile, calendar: UserEvent[], now = Date.now()): Array<DiscoverEvent & { score: number }> {
  const dismissed = new Set(d.dismissed);
  return d.events
    .filter((e) => Date.parse(e.start) > now - 3600_000 && !dismissed.has(e.id))
    .filter((e) => !calendar.some((c) => nyDateKey(c.start) === nyDateKey(e.start) && similarTitle(c.title, e.title)))
    .map((e) => ({ ...e, score: scoreEvent(e, profile) }))
    .sort((a, b) => b.score - a.score || a.start.localeCompare(b.start));
}

/** "High priority": a priority company, or both a target role and a target industry, or a very strong overall fit. */
export function isHighPriority(e: DiscoverEvent, p: Profile): boolean {
  const t = `${e.title} ${e.organizer} ${e.why}`.toLowerCase();
  const company = p.companies.some((c) => c && t.includes(c.toLowerCase()));
  const role = p.roles.some((r) => r && t.includes(r.toLowerCase().replace(/ manager$/, '')));
  const industry = p.industries.some((x) => x && t.includes(x.toLowerCase().split(/[ &/]/)[0]));
  return company || (role && industry) || scoreEvent(e, p) >= 45;
}

/** Events grouped by week (Monday to Sunday, New York time): "This week", "Next week", "Week of Dec 7"; each week by date. */
export function byWeek<T extends DiscoverEvent>(events: T[], now = Date.now()): Array<{ label: string; events: T[] }> {
  const monday = (iso: string) => {
    const d = new Date(`${nyDateKey(iso)}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const thisWeek = monday(new Date(now).toISOString());
  const nextWeek = monday(new Date(now + 7 * 24 * 3600_000).toISOString());
  const groups = new Map<string, T[]>();
  for (const e of [...events].sort((a, b) => a.start.localeCompare(b.start))) {
    const k = monday(e.start);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, list]) => ({
      label: k === thisWeek ? 'This week' : k === nextWeek ? 'Next week' : `Week of ${new Date(`${k}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`,
      events: list,
    }));
}

/** A link already checked to be the event's own page (older runs stored unchecked Google redirect links). */
export const verifiedLink = (e: DiscoverEvent) => (e.link && !/vertexaisearch\.cloud\.google\.com/.test(e.link) ? e.link : '');

/** When the event page could not be confirmed: a Google search for the event instead of a wrong link. */
export function findEventLink(e: DiscoverEvent): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${e.title} ${new Date(e.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })} New York`)}`;
}

/** Google Calendar "add event" link, pre-filled (no permission needed: Google opens it for the user). */
export function googleCalendarLink(e: DiscoverEvent): string {
  const fmt = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const end = e.end || new Date(Date.parse(e.start) + 2 * 3600_000).toISOString();
  const p = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates: `${fmt(e.start)}/${fmt(end)}`, location: e.venue, details: [e.why, e.link].filter(Boolean).join('\n\n') });
  return `https://calendar.google.com/calendar/render?${p}`;
}

export const TYPE_LABEL: Record<DiscoverEvent['type'], string> = {
  networking: 'Networking',
  panel: 'Panel',
  conference: 'Conference',
  workshop: 'Workshop',
  info_session: 'Info session',
  other: 'Event',
};

/** The event as an app calendar event (so it gets a brief like any other). */
export function toUserEvent(e: DiscoverEvent): UserEvent {
  return {
    id: `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: e.title,
    start: e.start,
    end: e.end || new Date(Date.parse(e.start) + 2 * 3600_000).toISOString(),
    location: e.venue,
    type: e.type === 'panel' ? 'Career panel' : e.type === 'networking' ? 'Networking night' : e.type === 'info_session' ? 'Company presentation' : 'Other',
    company: '',
    person: '',
    role: '',
    notes: [e.organizer && `Organizer: ${e.organizer}`, e.why, e.link].filter(Boolean).join('\n'),
    source: 'manual',
  };
}
