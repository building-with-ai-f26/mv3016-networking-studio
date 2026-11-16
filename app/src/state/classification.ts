// Classifies Google Calendar events: your overrides first, then rules, then (only for ambiguous events) the AI.
// AI answers are cached in this browser so each event is classified at most once.
import { useEffect, useMemo, useRef, useState } from 'react';
import { track } from '../lib/analytics';
import { aiClassifyInput, classifyByRules, fallbackForAmbiguous, TYPE_LABELS, type Classification, type NetworkingType } from '../lib/classifier';
import type { UserEvent } from '../types';

const CACHE_KEY = 'networking-studio:class-cache:v1';
type Cache = Record<string, { title: string; c: Classification }>;

function readCache(): Cache {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
function writeCache(c: Cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

async function classifyWithAi(body: unknown): Promise<Classification | null> {
  try {
    const r = await fetch('/api/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) return null;
    const d = await r.json();
    if (!(d.type in TYPE_LABELS)) return null;
    return { type: d.type, confidence: d.confidence, reason: d.reason, company: d.company ?? '', person: d.person ?? '', role: d.role ?? '', source: 'ai' };
  } catch {
    return null;
  }
}

export interface ClassifierInputs {
  events: UserEvent[];
  targetCompanies: string[];
  overrides: Record<string, NetworkingType>;
  ignoredSeries: string[];
}

export interface ClassifiedEvent {
  classification: Classification;
  /** True while the AI is still deciding (the fallback is shown meanwhile). */
  pending: boolean;
  /** Hidden because it is not networking, or its recurring series was ignored. */
  hidden: boolean;
  ignoredSeries: boolean;
}

export function useClassifications({ events, targetCompanies, overrides, ignoredSeries }: ClassifierInputs): Record<string, ClassifiedEvent> {
  const [cache, setCache] = useState<Cache>(readCache);
  const inFlight = useRef(new Set<string>());
  const ctx = useMemo(() => ({ targetCompanies }), [targetCompanies]);

  // Rules for every event; list the ambiguous ones the AI has not answered yet.
  const byRules = useMemo(() => {
    const out: Record<string, Classification | null> = {};
    for (const ev of events) out[ev.id] = classifyByRules(ev, ctx);
    return out;
  }, [events, ctx]);

  useEffect(() => {
    const todo = events.filter((ev) => byRules[ev.id] === null && cache[ev.id]?.title !== ev.title && !inFlight.current.has(ev.id));
    if (todo.length === 0) return;
    let alive = true;
    void (async () => {
      for (const ev of todo.slice(0, 25)) {
        inFlight.current.add(ev.id);
        const c = await classifyWithAi(aiClassifyInput(ev, ctx));
        inFlight.current.delete(ev.id);
        if (!c || !alive) continue;
        setCache((prev) => {
          const next = { ...prev, [ev.id]: { title: ev.title, c } };
          writeCache(next);
          return next;
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [events, byRules, cache, ctx]);

  return useMemo(() => {
    const out: Record<string, ClassifiedEvent> = {};
    for (const ev of events) {
      const series = ev.google?.recurringEventId ?? null;
      const seriesIgnored = !!series && ignoredSeries.includes(series);
      const rules = byRules[ev.id];
      const cached = cache[ev.id]?.title === ev.title ? cache[ev.id].c : null;
      const auto = rules ?? cached ?? fallbackForAmbiguous(ev, ctx);
      const override = overrides[ev.id];
      const classification: Classification = override
        ? { ...auto, type: override, confidence: 1, reason: `You marked this as ${TYPE_LABELS[override].toLowerCase()}`, source: 'you' }
        : auto;
      out[ev.id] = {
        classification,
        pending: !override && !rules && !cached,
        hidden: seriesIgnored || classification.type === 'not_networking',
        ignoredSeries: seriesIgnored,
      };
    }
    return out;
  }, [events, byRules, cache, ctx, overrides, ignoredSeries]);
}

export function trackOverride(eventId: string, from: NetworkingType, to: NetworkingType | 'ignore_series') {
  track('event_classified_override', { event_id: eventId, from, to });
}
