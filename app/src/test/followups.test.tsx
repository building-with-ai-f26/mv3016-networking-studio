import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findReplies, parseLinkedinNote } from '../../server/gmail.mjs';
import { contactFromSuggestion, contactSuggestions, followUpTasks, linkedinSearchUrl, recordCoffee, recordEmail, recordLinkedin, recordReply, stageOf } from '../lib/followups';
import type { Contact, UserEvent } from '../types';
import { onboardedAccountState, renderApp } from './renderApp';

const DAY = 24 * 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const now = Date.parse('2026-11-20T15:00:00Z');
const pastEvent: UserEvent = { id: 'u1', source: 'manual', title: 'Streamly info session', start: iso(now - 2 * DAY), end: iso(now - 2 * DAY + 3600_000), location: '', type: 'Company presentation', company: 'Streamly', person: 'Jordan Lee', role: 'PM', notes: '' };

describe('Follow-up flow (logic)', () => {
  it('suggests people from events that already happened, not yet in contacts, not dismissed, never you', () => {
    const base = { events: [pastEvent], extractions: {}, contacts: [] as Contact[], dismissed: [] as string[], studentNames: ['Alex Student'], isHidden: () => false, now };
    expect(contactSuggestions(base).map((s) => s.name)).toEqual(['Jordan Lee']);
    expect(contactSuggestions({ ...base, dismissed: ['u1|jordan lee'] })).toEqual([]);
    expect(contactSuggestions({ ...base, events: [{ ...pastEvent, end: iso(now + DAY) }] })).toEqual([]);
    const ex = { u1: { people: [{ name: 'Alex Student', role: '', company: '', source: 'attendees' }, { name: 'Sam Rivera', role: 'Ads lead', company: 'Streamly', source: 'description' }], companies: [], topic: '', fingerprint: 'f', at: '' } };
    expect(contactSuggestions({ ...base, extractions: ex }).map((s) => `${s.name}|${s.role}`)).toEqual(['Sam Rivera|Ads lead']);
  });

  it('moves through the stages: New → LinkedIn → Emailed → Follow-up due → Replied → Coffee chat done', () => {
    let c = contactFromSuggestion({ key: 'k', name: 'Jordan Lee', role: 'PM', company: 'Streamly', eventId: 'u1', eventTitle: 'Streamly info session', eventDate: pastEvent.start });
    expect(stageOf(c, now)).toBe('new');
    expect(followUpTasks([c], now).map((t) => t.type).sort()).toEqual(['linkedin', 'thanks']);
    c = recordLinkedin(c);
    expect(stageOf(c, now)).toBe('linkedin');
    c = recordEmail(c, { threadId: 't1', sentAt: iso(now - 8 * DAY), kind: 'thanks', subject: 'Thank you', to: 'jordan@streamly.com' });
    expect(c.email).toBe('jordan@streamly.com');
    expect(stageOf(c, now)).toBe('followup');
    expect(followUpTasks([c], now)).toEqual([expect.objectContaining({ type: 'followup', name: 'Jordan Lee' })]);
    c = recordReply(c, { threadId: 't1', repliedAt: iso(now - DAY), snippet: 'Happy to chat!' });
    expect(stageOf(c, now)).toBe('replied');
    expect(followUpTasks([c], now)).toEqual([]);
    c = recordCoffee(c);
    expect(stageOf(c, now)).toBe('coffee');
    expect(c.history?.map((h) => h.type)).toEqual(['met', 'linkedin', 'email', 'reply', 'coffee']);
  });

  it('links to a LinkedIn search (the app never sends invitations)', () => {
    expect(linkedinSearchUrl('Jordan Lee', 'Streamly')).toBe('https://www.linkedin.com/search/results/people/?keywords=Jordan%20Lee%20Streamly');
  });
});

describe('Follow-up flow (server)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('finds replies from someone else after the email was sent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            messages: [
              { id: 'a', internalDate: String(now - 2 * DAY), payload: { headers: [{ name: 'From', value: 'Alex <student@example.com>' }] } },
              { id: 'b', internalDate: String(now - DAY), snippet: 'Happy to chat!', payload: { headers: [{ name: 'From', value: 'Jordan Lee <jordan@streamly.com>' }] } },
            ],
          }),
        ),
      ),
    );
    const { replies } = await findReplies('token', 'student@example.com', [{ threadId: 'thread123', sentAt: iso(now - 2 * DAY) }]);
    expect(replies).toEqual([expect.objectContaining({ threadId: 'thread123', fromName: 'Jordan Lee', snippet: 'Happy to chat!' })]);
  });

  it('keeps LinkedIn notes within 300 characters, without links or emails', () => {
    const long = `Hi Jordan, great meeting you at the info session. ${'x'.repeat(400)} write me at a@b.com https://x.com`;
    const { note } = parseLinkedinNote({ candidates: [{ content: { parts: [{ text: JSON.stringify({ note: long }) }] } }] });
    expect(note.length).toBeLessThanOrEqual(300);
    expect(note).not.toMatch(/a@b\.com|https:/);
  });
});

describe('Follow-up flow (in the app)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('suggests a person after the event; adding them opens their follow-up; the task shows on the calendar', async () => {
    const realNow = Date.now();
    const ev = { ...pastEvent, start: iso(realNow - 2 * DAY), end: iso(realNow - 2 * DAY + 3600_000) };
    const state = { ...onboardedAccountState(), userEvents: [ev] };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/state') return new Response(JSON.stringify({ state }));
        if (url === '/api/me') return new Response(JSON.stringify({ configured: true, signedIn: true, email: 'student@example.com', calendarConnected: false, gmailConnected: false }));
        return new Response('{}', { status: 404 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/contacts');
    const box = (await screen.findByRole('heading', { name: /From your events/ })).closest('section')!;
    expect(box).toHaveTextContent('Jordan Lee');
    await user.click(within(box as HTMLElement).getByRole('button', { name: 'Add to contacts' }));
    const drawer = await screen.findByRole('dialog', { name: 'Jordan Lee' });
    expect(drawer).toHaveTextContent('New');
    expect(within(drawer).getByRole('link', { name: /Find on LinkedIn/ })).toHaveAttribute('target', '_blank');
    expect(within(drawer).getAllByText(/Met at Streamly info session/).length).toBeGreaterThan(0); // header + history
    await user.click(within(drawer).getByRole('button', { name: /Mark invitation as sent/ }));
    expect(await within(drawer).findByText(/Invitation sent on/)).toBeInTheDocument();
    expect(drawer).toHaveTextContent('Added on LinkedIn');
    expect(screen.getByRole('heading', { name: /To do/ }).closest('section')).toHaveTextContent('Send a thank-you email to Jordan Lee');
  });
});
