// Fictional "Google Calendar" for demo mode (no sign-in). It mirrors what a real student calendar looks like
// (classes, club coordination, fellowship meetings, coffee chats, info sessions) so the demo shows the same
// classifier and AI brief flow as a signed-in account. All people and emails are invented.
import type { GoogleAttendee, GoogleCalendarEvent } from '../types';

const me: GoogleAttendee = { email: 'student@school.edu', name: 'You', self: true, organizer: false, responseStatus: 'accepted' };
const person = (email: string, name: string, organizer = true): GoogleAttendee => ({ email, name, self: false, organizer, responseStatus: 'accepted' });

function ev(
  id: string,
  title: string,
  day: string,
  start: string,
  end: string,
  extra: Partial<GoogleCalendarEvent> = {},
): GoogleCalendarEvent {
  return {
    id: `demo-${id}`,
    title,
    start: `${day}T${start}:00-05:00`,
    end: `${day}T${end}:00-05:00`,
    allDay: false,
    location: '',
    description: '',
    eventType: 'default',
    recurringEventId: null,
    selfResponse: 'accepted',
    status: 'confirmed',
    attendees: [me, person('host@school.edu', 'Club host')],
    ...extra,
  };
}

/** Week of Nov 16–22, 2026 (the week after the sample week). */
export const DEMO_GOOGLE_EVENTS: GoogleCalendarEvent[] = [
  // ---- Networking (shown) ----
  ev('lunch-learn', 'STA: Lunch and Learn with Priya Nair', '2026-11-16', '12:30', '13:30', {
    location: 'Room 2-60, Graduate Center',
    description:
      'The Technology Association invites you to a Lunch and Learn with Priya Nair, Senior Product Manager at Spotify. Priya will share how her team builds personalization features and what MBA students should know about PM recruiting. Lunch provided.',
  }),
  ev('coffee-daniel', 'Coffee chat with Daniel Ortiz', '2026-11-17', '09:30', '10:00', {
    location: 'Zoom',
    attendees: [me, person('daniel.ortiz@stripe.com', 'Daniel Ortiz')],
    description: 'Intro from a classmate. Daniel works on the payments partnerships team.',
  }),
  ev('info-session', 'Siemens Info Session: Digital Industries Rotational Program', '2026-11-18', '17:00', '18:00', {
    location: 'Hall B, Graduate Center',
    description: 'Learn about the rotational program, meet recent hires and alumni. Business casual.',
  }),
  ev('intro', 'Maya <> Chris (alumni intro)', '2026-11-19', '15:00', '15:30', {
    location: 'Google Meet',
    attendees: [me, person('chris.wong@deloitte.com', 'Chris Wong')],
    description: 'Alumni intro arranged by the career center. Chris is a manager in strategy consulting.',
  }),
  ev('panel', 'Alumni Panel: Careers in Fintech', '2026-11-20', '18:00', '19:30', {
    location: 'Auditorium, Graduate Center',
    description: 'Three alumni from fintech companies discuss their paths after the MBA. Q&A and networking reception to follow.',
  }),
  // ---- Not networking (hidden by the rules) ----
  ev('class-1', 'TECH-GB 2160 Lecture', '2026-11-16', '09:00', '10:20', { recurringEventId: 'demo-series-class', attendees: [me] }),
  ev('class-2', 'Corporate Finance Recitation', '2026-11-17', '13:00', '14:00', { attendees: [me] }),
  ev('techcon', 'DevSummit [Corp Rel - Sponsors]', '2026-11-17', '13:30', '14:00', { attendees: [me, person('board@school.edu', 'Club board')] }),
  ev('fellows', 'Civic Board Fellows Interview', '2026-11-18', '15:00', '15:30', { location: 'Zoom' }),
  ev('weekly', 'Sam / Maya - Weekly Connect', '2026-11-18', '15:00', '15:30', { recurringEventId: 'demo-series-weekly' }),
  ev('sta-board', 'STA Board Meeting', '2026-11-19', '12:00', '13:00'),
  ev('gym', 'Gym', '2026-11-19', '07:30', '08:30', { attendees: [] }),
  ev('break', 'Thanksgiving break', '2026-11-21', '00:00', '00:00', { allDay: true, start: '2026-11-21', end: '2026-11-22', attendees: [] }),
];
