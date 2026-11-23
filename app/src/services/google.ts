// Browser side of Google sign-in + Calendar. Everything goes through the LOCAL server;
// tokens stay on the server and the browser only holds an httpOnly session cookie.
import { nyWallTimeToIso } from '../lib/time';
import type { GoogleAccount, GoogleCalendarEvent, UserEvent } from '../types';

export const SIGNED_OUT: GoogleAccount = { status: 'unavailable', configured: false, signedIn: false, email: null, name: null, calendarConnected: false };

export async function fetchAccount(retry = import.meta.env.MODE !== 'test'): Promise<GoogleAccount> {
  try {
    const r = await fetch('/api/me', { credentials: 'same-origin' });
    // The local server may be restarting for a moment (npm run dev): try once more before giving up.
    if (r.status >= 500 && retry) {
      await new Promise((res) => setTimeout(res, 1200));
      return fetchAccount(false);
    }
    if (!r.ok) return SIGNED_OUT;
    const d = await r.json();
    return { status: 'ready', configured: !!d.configured, signedIn: !!d.signedIn, email: d.email ?? null, name: d.name ?? null, calendarConnected: !!d.calendarConnected, gmailConnected: !!d.gmailConnected };
  } catch {
    if (retry) {
      await new Promise((res) => setTimeout(res, 1200));
      return fetchAccount(false);
    }
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
    google: { description: e.description ?? '', allDay: e.allDay, eventType: e.eventType, recurringEventId: e.recurringEventId, selfResponse: e.selfResponse, attendees: e.attendees, organizerName: e.organizerName ?? '', organizerDomain: e.organizerDomain ?? '', online: Boolean(e.online) },
  };
}

/** This account's saved app data from the local server, or null for a new account (or if the server is unreachable). */
export async function fetchAccountState(): Promise<unknown | null> {
  try {
    const r = await fetch('/api/state', { credentials: 'same-origin' });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.state ?? null;
  } catch {
    return null;
  }
}

/** Saves this account's app data on the local server. Failures are ignored (the next change saves again). */
export async function saveAccountState(state: unknown): Promise<void> {
  await fetch('/api/state', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) }).catch(() => {});
}
