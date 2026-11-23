// People from networking events that already happened go straight into Contacts (stage "New"), so the follow-up
// flow starts on its own. You can Dismiss them (they never come back) or connect on LinkedIn / by email.
// Runs in the background whenever the app is open (calendar events, the AI reading of events and contacts change).
import { useEffect, useMemo } from 'react';
import { contactFromSuggestion, contactSuggestions } from '../lib/followups';
import { track } from '../lib/analytics';
import { useStore } from '../state/store';
import { useToast } from './Toast';

export function ContactsAutoImport() {
  const { state, upsertContact, googleEvents, classified, google, accountReady } = useStore();
  const [toast, showToast] = useToast();
  const suggestions = useMemo(
    () =>
      contactSuggestions({
        events: [...state.userEvents, ...googleEvents],
        extractions: state.aiExtractions,
        contacts: state.contacts,
        dismissed: state.dismissedSuggestions ?? [],
        studentNames: [state.profile.name, google.name ?? ''],
        isHidden: (id) => Boolean(classified[id]?.hidden),
      }),
    [state.userEvents, googleEvents, state.aiExtractions, state.contacts, state.dismissedSuggestions, state.profile.name, google.name, classified],
  );
  useEffect(() => {
    // Only for a real account, once its data is loaded (never on demo data).
    if (!google.signedIn || !accountReady || !suggestions.length) return;
    for (const s of suggestions) upsertContact(contactFromSuggestion(s));
    track('contacts_auto_added', { count: suggestions.length });
    showToast(suggestions.length === 1 ? `${suggestions[0].name} from your events was added to Contacts` : `${suggestions.length} people from your events were added to Contacts`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions, google.signedIn, accountReady]);
  return toast;
}
