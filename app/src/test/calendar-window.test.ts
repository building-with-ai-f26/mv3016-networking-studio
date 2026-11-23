import { describe, expect, it } from 'vitest';
import { calendarWindow } from '../../server/google.mjs';
import { mergeCalendarCache, parseState } from '../services/storage';
import type { GoogleCalendarEvent } from '../types';

const ev = (id: string, start: string): GoogleCalendarEvent => ({ id, title: id, start, end: start, location: '', status: 'confirmed', description: '', allDay: false, eventType: 'default', recurringEventId: null, selfResponse: null, attendees: [] });

describe('Calendar range and saved month', () => {
  it('reads the last 4 weeks, this week and the next 2 weeks (New York weeks, Monday to Sunday)', () => {
    // Wednesday Nov 25, 2026 → this week starts Mon Nov 23.
    expect(calendarWindow(new Date('2026-11-25T15:00:00Z'))).toEqual({ timeMin: '2026-10-26T00:00:00-04:00', timeMax: '2026-12-14T00:00:00-05:00' });
    // Sunday evening in New York (already Monday in UTC) still counts as the same week.
    expect(calendarWindow(new Date('2026-11-23T03:00:00Z')).timeMax).toBe('2026-12-07T00:00:00-05:00');
  });

  it('keeps past events of the last month even when Google stops returning them; cancelled future ones go away', () => {
    const now = Date.parse('2026-11-25T15:00:00Z');
    const cache = [ev('old-panel', '2026-11-03T18:00:00-05:00'), ev('too-old', '2026-10-01T18:00:00-04:00'), ev('cancelled-future', '2026-11-30T18:00:00-05:00')];
    const out = mergeCalendarCache([ev('chat', '2026-11-20T10:00:00-05:00'), ev('next', '2026-12-01T10:00:00-05:00')], cache, now);
    expect(out.events.map((e) => e.id)).toEqual(['too-old', 'old-panel', 'chat', 'next']);
    expect(out.cache.map((e) => e.id)).toEqual(['old-panel', 'chat']); // only the last month, only past events
  });

  it('the saved month never keeps attendee emails or unknown fields', () => {
    const s = parseState({ version: 1, calendarCache: [{ ...ev('a', '2026-11-20T10:00:00-05:00'), attendees: [{ name: 'Ana', domain: 'x.com', email: 'ana@x.com', self: false, organizer: false, responseStatus: 'accepted' }], secret: 'x' }] });
    expect(JSON.stringify(s?.calendarCache)).not.toContain('ana@x.com');
    expect(JSON.stringify(s?.calendarCache)).not.toContain('secret');
  });
});
