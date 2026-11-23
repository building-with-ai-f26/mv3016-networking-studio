// Keeps Discover fresh in the background, each time the app opens:
// - web search for NYC events: at most once every 24 hours;
// - newsletters / club emails (Gmail) and the CampusGroups calendar: at most every 3 hours, and only NEW emails are read.
// There is no manual refresh button (by design); the server also rate limits these calls.
import { useCallback, useEffect, useRef, useState } from 'react';
import { track } from '../lib/analytics';
import { MAIL_EVERY_MS, mergeEvents, WEB_EVERY_MS } from '../lib/discover';
import { studentContext } from '../services/aiBrief';
import { useStore } from '../state/store';
import type { DiscoverEvent } from '../types';
import { postJson } from './EmailComposer';

export function useDiscoverRefresh() {
  const { state, updateDiscover, google } = useStore();
  const stateRef = useRef(state);
  stateRef.current = state;
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const refresh = useCallback(
    async (force = false) => {
      if (busy.current || !google.signedIn) return;
      const s = stateRef.current;
      const d = s.discover;
      const now = Date.now();
      const due = (last: string | undefined, every: number) => force || !last || now - Date.parse(last) >= every;
      // Events saved before links were checked: search the web again now to get their real pages.
      const oldLinks = (d?.events ?? []).some((e) => /vertexaisearch\.cloud\.google\.com/.test(e.link));
      const doWeb = oldLinks || due(d?.lastWebAt, WEB_EVERY_MS);
      const doMail = due(d?.lastMailAt, MAIL_EVERY_MS);
      if (!doWeb && !doMail) return;
      busy.current = true;
      setRunning(true);
      setError(null);
      const student = studentContext(s.profile);
      const found: DiscoverEvent[] = [];
      let processed = d?.processed ?? [];
      const errors: string[] = [];
      let webOk = false;
      let mailOk = false;
      let mailStats: { newEmails: number; newsletters: number; withEvents: number } | null = null;
      let mailError = '';
      const stamp = (list: DiscoverEvent[]) => list.map((e) => ({ ...e, foundAt: new Date().toISOString() }));
      try {
        const jobs: Array<Promise<void>> = [];
        if (doWeb)
          jobs.push(
            postJson<{ events: DiscoverEvent[] }>('/api/discover/web', { student })
              .then((r) => {
                found.push(...stamp(r.events));
                webOk = true;
              })
              .catch((e) => void errors.push(e.message)),
          );
        if (doMail && google.gmailConnected)
          jobs.push(
            postJson<{ events: DiscoverEvent[]; processed: string[]; stats: { newEmails: number; newsletters: number; withEvents: number } }>('/api/discover/mail', { student, processed })
              .then((r) => {
                found.push(...stamp(r.events));
                processed = r.processed ?? processed;
                mailStats = r.stats ?? null;
                mailOk = true;
              })
              .catch((e) => {
                mailError = e.message;
                errors.push(e.message);
              }),
          );
        if (doMail && d?.icalUrl) jobs.push(postJson<{ events: DiscoverEvent[] }>('/api/discover/ical', { url: d.icalUrl }).then((r) => void found.push(...stamp(r.events))).catch((e) => void errors.push(e.message)));
        await Promise.all(jobs);
        const at = new Date().toISOString();
        updateDiscover((cur) => ({
          ...cur,
          events: mergeEvents(cur.events, found),
          processed,
          // Only a check that worked counts: a failed one is retried the next time the app opens.
          lastWebAt: webOk ? at : cur.lastWebAt,
          lastMailAt: mailOk ? at : cur.lastMailAt,
          ...(mailStats || mailError ? { mailStats: { at, ...(mailStats ?? cur.mailStats ?? { newEmails: 0, newsletters: 0, withEvents: 0 }), ...(mailError ? { error: mailError } : {}) } } : {}),
        }));
        track('discover_refreshed', { found: found.length, web: doWeb, mail: doMail, forced: force });
        if (errors.length) setError(errors[0]);
      } finally {
        busy.current = false;
        setRunning(false);
      }
    },
    [google.signedIn, google.gmailConnected, updateDiscover],
  );
  return { refresh, running, error };
}

/** Mounted once in the layout: refreshes what is due when the app opens. */
export function DiscoverSync() {
  const { accountReady, google } = useStore();
  const { refresh } = useDiscoverRefresh();
  useEffect(() => {
    if (accountReady && google.signedIn) void refresh(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountReady, google.signedIn, google.gmailConnected]);
  return null;
}
