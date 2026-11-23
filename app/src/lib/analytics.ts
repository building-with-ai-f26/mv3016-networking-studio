// PostHog analytics for the local app.
// - Reads the PUBLIC project token from app/.env (VITE_POSTHOG_KEY, VITE_POSTHOG_HOST).
// - Does nothing when the token is missing or during tests, so the app works without it.
// - Session replay masks ALL text and inputs (no names, notes or calendar details are recorded).
// - Event properties never include names, titles or free text: only ids and counts.
import posthog from 'posthog-js';

let enabled = false;

export function initAnalytics(): void {
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  const host = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://us.i.posthog.com';
  if (!key || import.meta.env.MODE === 'test') return;
  posthog.init(key, {
    api_host: host,
    capture_pageview: false, // we send $pageview ourselves on every route change
    capture_pageleave: true,
    autocapture: true, // clicks
    mask_all_text: true,
    mask_all_element_attributes: true,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '*',
    },
  });
  posthog.register({ app: 'networking-studio-local' });
  enabled = true;
}

export type AppEvent =
  | 'event_opened'
  | 'brief_generated'
  | 'question_saved'
  | 'chat_message_sent'
  | 'contact_added'
  | 'article_saved'
  | 'signed_in'
  | 'calendar_connected'
  | 'event_classified_override'
  | 'onboarding_completed'
  | 'event_removed'
  | 'event_added_from_calendar'
  | 'questions_generated'
  | 'brief_downloaded'
  | 'gmail_searched'
  | 'gmail_used_in_brief'
  | 'email_draft_written'
  | 'email_draft_saved'
  | 'email_sent'
  | 'email_replies_found'
  | 'linkedin_note_written'
  | 'linkedin_opened'
  | 'linkedin_marked_sent'
  | 'coffee_chat_done'
  | 'contact_suggestion_added'
  | 'contact_suggestion_dismissed'
  | 'discover_refreshed'
  | 'discover_register_clicked'
  | 'discover_added_to_calendar'
  | 'discover_google_calendar_clicked'
  | 'discover_dismissed'
  | 'campusgroups_connected'
  | 'contacts_auto_added'
  | 'contact_dismissed';

export function track(event: AppEvent, props?: Record<string, string | number | boolean>): void {
  if (enabled) posthog.capture(event, props);
}

export function trackPageview(path: string): void {
  if (enabled) posthog.capture('$pageview', { $current_url: window.location.origin + path });
}
