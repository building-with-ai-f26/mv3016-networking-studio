// Browser side of Google sign-in + Calendar. Everything goes through the LOCAL server;
// tokens stay on the server and the browser only holds an httpOnly session cookie.
import { nyWallTimeToIso } from '../lib/time';
import type { GoogleAccount, GoogleCalendarEvent, UserEvent } from '../types';

export const SIGNED_OUT: GoogleAccount = { status: 'unavailable', configured: false, signedIn: false, email: null, name: null, calendarConnected: false };

export async function fetchAccount(): Promise<GoogleAccount> {
  try {
    const r = await fetch('/api/me', { credentials: 'same-origin' });
    if (!r.ok) return SIGNED_OUT;
    const d = await r.json();
    return { status: 'ready', configured: !!d.configured, signedIn: !!d.signedIn, email: d.email ?? null, name: d.name ?? null, calendarConnected: !!d.calendarConnected };
  } catch {
    return SIGNED_OUT; // local server not running: demo mode still works
  }
}

export async function fetchCalendarEvents(): Promise<GoogleCalendarEvent[]> {
  const r = await fetch('/api/calendar/events', { credentials: 'same-origin' });
  const d = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(d?.events)) throw new Error(d?.error ?? 'Could not load your Google Calendar.');
  return d.events;
}

export async function postAuth(path: '/auth/signout' | '/auth/disconnect'): Promise<void> {
  await fetch(path, { method: 'POST', credentials: 'same-origin' }).catch(() => {});
}

/** Google gives all-day events as plain dates; show them in New York time like everything else. */
function toIso(v: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? nyWallTimeToIso(v, '00:00') : v;
}

export function toUserEvent(e: GoogleCalendarEvent): UserEvent {
  return {
    id: `g-${e.id}`,
    title: e.title,
    start: toIso(e.start),
    end: toIso(e.end || e.start),
    location: e.location,
    type: 'Other',
    company: '',
    person: '',
    role: '',
    notes: '',
    source: 'google',
    google: { description: e.description ?? '', allDay: e.allDay, eventType: e.eventType, recurringEventId: e.recurringEventId, selfResponse: e.selfResponse, attendees: e.attendees },
  };
}
