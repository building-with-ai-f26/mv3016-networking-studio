// Keeps contacts up to date with Gmail in the background (no need to open Contacts): each time the app opens, and when
// you come back to it after 30+ minutes away. It only reads Gmail (no AI, no tokens). New replies update the contact's
// stage, history and the calendar tasks.
import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { syncGmail } from './ContactDrawer';
import { useToast } from './Toast';

/** Coming back to the app after this long away syncs again. */
export const GMAIL_RESYNC_AFTER_MS = 30 * 60_000;

export function GmailSync() {
  const { state, upsertContact, google, accountReady } = useStore();
  const [toast, showToast] = useToast();
  const contactsRef = useRef(state.contacts);
  contactsRef.current = state.contacts;
  const busy = useRef(false);

  useEffect(() => {
    if (!google.gmailConnected || !accountReady) return;
    const run = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const n = await syncGmail(contactsRef.current, upsertContact);
        if (n) showToast(n === 1 ? 'A contact replied to your email' : `${n} contacts replied to your emails`);
      } catch {
        // Gmail unavailable for now: try again on the next round.
      } finally {
        busy.current = false;
      }
    };
    let last = Date.now();
    void run();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - last >= GMAIL_RESYNC_AFTER_MS) {
        last = Date.now();
        void run();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [google.gmailConnected, accountReady]);

  return toast;
}
