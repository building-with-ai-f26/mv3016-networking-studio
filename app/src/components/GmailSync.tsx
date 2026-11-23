// Keeps contacts up to date with Gmail in the background (no need to open Contacts): right after the account loads,
// then every 15 minutes while the app is open. New replies update the contact's stage, history and the calendar tasks.
import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { syncGmail } from './ContactDrawer';
import { useToast } from './Toast';

export const GMAIL_SYNC_MS = 15 * 60_000;

export function GmailSync() {
  const { state, upsertContact, google, accountReady } = useStore();
  const [toast, showToast] = useToast();
  const contactsRef = useRef(state.contacts);
  contactsRef.current = state.contacts;
  const busy = useRef(false);

  useEffect(() => {
    if (!google.gmailConnected || !accountReady) return;
    const run = async () => {
      if (busy.current || document.visibilityState === 'hidden') return;
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
    void run();
    const timer = setInterval(() => void run(), GMAIL_SYNC_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [google.gmailConnected, accountReady]);

  return toast;
}
