// Reads each upcoming networking event once with AI (/api/extract): people, companies and topic, with sources.
// Results are saved with the account and reused; an event is read again only if its title, description or
// attendees change. One event at a time, with a pause, so the free tier's per-minute limit is not hit.
import { useCallback, useEffect, useRef } from 'react';
import { nyDateKey } from '../lib/time';
import type { EventExtraction, UserEvent } from '../types';

export function extractionFingerprint(ev: UserEvent): string {
  const g = ev.google;
  return [ev.title, g?.description ?? '', ev.location, g?.organizerName ?? '', (g?.attendees ?? []).map((a) => `${a.name}|${a.domain}`).join(',')].join('§');
}

export async function requestExtraction(ev: UserEvent, studentNames: string[]): Promise<EventExtraction | null | 'rate-limited'> {
  const g = ev.google;
  const selfDomains = (g?.attendees ?? []).filter((a) => a.self).map((a) => a.domain);
  try {
    const r = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: ev.title,
        description: g?.description ?? ev.notes,
        location: ev.location,
        organizer: [g?.organizerName, g?.organizerDomain].filter(Boolean).join(' · '),
        studentNames,
        schoolDomains: selfDomains,
        attendees: (g?.attendees ?? []).map((a) => ({ name: a.self ? studentNames[0] ?? '' : a.name, domain: a.domain })),
      }),
    });
    if (r.status === 429) return 'rate-limited';
    if (!r.ok) return null;
    const d = await r.json();
    return { people: d.people ?? [], companies: d.companies ?? [], topic: d.topic ?? '', fingerprint: extractionFingerprint(ev), at: new Date().toISOString() };
  } catch {
    return null;
  }
}

interface Inputs {
  /** Google events to read (the visible networking ones). */
  events: UserEvent[];
  saved: Record<string, EventExtraction>;
  studentNames: string[];
  onSave: (eventId: string, ex: EventExtraction) => void;
}

/** Background reading of upcoming events; returns readNow() for "Generate" when an event was not read yet. */
export function useExtractions({ events, saved, studentNames, onSave }: Inputs) {
  const inFlight = useRef(new Map<string, Promise<EventExtraction | null>>());
  const namesRef = useRef(studentNames);
  namesRef.current = studentNames;

  const readNow = useCallback(
    (ev: UserEvent): Promise<EventExtraction | null> => {
      const running = inFlight.current.get(ev.id);
      if (running) return running;
      const p = requestExtraction(ev, namesRef.current).then((ex) => {
        inFlight.current.delete(ev.id);
        if (ex && ex !== 'rate-limited') {
          onSave(ev.id, ex);
          return ex;
        }
        return null;
      });
      inFlight.current.set(ev.id, p);
      return p;
    },
    [onSave],
  );

  useEffect(() => {
    const today = nyDateKey(new Date().toISOString());
    const todo = events.filter((ev) => nyDateKey(ev.start) >= today && saved[ev.id]?.fingerprint !== extractionFingerprint(ev) && !inFlight.current.has(ev.id));
    if (todo.length === 0) return;
    let alive = true;
    void (async () => {
      for (const [i, ev] of todo.slice(0, 15).entries()) {
        if (!alive) return;
        if (i > 0) await new Promise((r) => setTimeout(r, 1200));
        if (!alive) return;
        const ex = await readNow(ev);
        if (!ex && !alive) return;
      }
    })();
    return () => {
      alive = false;
    };
  }, [events, saved, readNow]);

  return { readNow };
}
