// Date helpers. All event times are displayed in America/New_York,
// independent of the computer's own timezone or current date.
import { DEMO_TIMEZONE } from '../data/seed';
import type { ISODate, ISODateTime } from '../types';

const TZ = DEMO_TIMEZONE;

/** YYYY-MM-DD of an instant, as seen in New York. */
export function nyDateKey(iso: ISODateTime): ISODate {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function formatTime(iso: ISODateTime): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function formatTimeRange(start: ISODateTime, end: ISODateTime): string {
  return `${formatTime(start)} – ${formatTime(end)}`;
}

export function tzAbbrev(iso: ISODateTime): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'short' }).formatToParts(new Date(iso));
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? 'ET';
}

export function formatLongDate(iso: ISODateTime): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(iso));
}

export function formatDateTime(iso: ISODateTime): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

// ---- Date-only arithmetic (done in UTC so the local machine timezone never matters) ----

function toUTC(d: ISODate): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

function fromUTC(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: ISODate, n: number): ISODate {
  const x = toUTC(d);
  x.setUTCDate(x.getUTCDate() + n);
  return fromUTC(x);
}

export function isValidDateKey(d: string | null): d is ISODate {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return fromUTC(toUTC(d)) === d;
}

/** Monday of the week containing the given date. */
export function mondayOf(d: ISODate): ISODate {
  const dow = toUTC(d).getUTCDay(); // 0 = Sunday
  return addDays(d, dow === 0 ? -6 : 1 - dow);
}

export function weekDays(monday: ISODate): ISODate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function formatDayHeading(d: ISODate): { weekday: string; date: string } {
  const x = toUTC(d);
  return {
    weekday: new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' }).format(x),
    date: new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(x),
  };
}

export function formatWeekRange(monday: ISODate): string {
  const start = toUTC(monday);
  const end = toUTC(addDays(monday, 6));
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const m = (x: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' }).format(x);
  const y = end.getUTCFullYear();
  return sameMonth
    ? `${m(start)} ${start.getUTCDate()}–${end.getUTCDate()}, ${y}`
    : `${m(start)} ${start.getUTCDate()} – ${m(end)} ${end.getUTCDate()}, ${y}`;
}

export function formatShortDate(d: ISODate | ''): string {
  if (!d) return 'Not recorded';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(toUTC(d));
}
