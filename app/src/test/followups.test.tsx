import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findAddresses, findReplies, parseAddressList, parseLinkedinNote, sameName } from '../../server/gmail.mjs';
import { applyFoundAddress, contactFromSuggestion, contactSuggestions, followUpTasks, linkedinSearchUrl, mergeActivity, recordCoffee, recordEmail, recordLinkedin, recordReply, stageOf } from '../lib/followups';
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
    // After meeting: ONE task, connect on LinkedIn or by email (your choice), within 3 days. No automatic thank-you.
    const met = pastEvent.start;
    const day = (iso: string, n: number) => new Date(Date.parse(iso) + n * DAY).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    expect(followUpTasks([c], now).map((t) => [t.type, t.due])).toEqual([['connect', day(met, 3)]]);
    c = recordLinkedin(c);
    expect(stageOf(c, now)).toBe('linkedin');
    // A LinkedIn invitation needs no further action.
    expect(followUpTasks([c], now)).toEqual([]);
    c = recordEmail(c, { threadId: 't1', sentAt: iso(now - 8 * DAY), kind: 'thanks', subject: 'Thank you', to: 'jordan@streamly.com' });
    expect(c.email).toBe('jordan@streamly.com');
    expect(stageOf(c, now)).toBe('followup');
    expect(followUpTasks([c], now)).toEqual([expect.objectContaining({ type: 'followup', name: 'Jordan Lee' })]);
    c = recordReply(c, { threadId: 't1', repliedAt: iso(now - DAY), snippet: 'Happy to chat!' });
    expect(stageOf(c, now)).toBe('replied');
    // They replied: answer within 1 day.
    expect(followUpTasks([c], now)).toEqual([expect.objectContaining({ type: 'reply', due: day(iso(now - DAY), 1) })]);
    c = recordCoffee(c);
    expect(stageOf(c, now)).toBe('coffee');
    // After a coffee chat: thank-you by the next day.
    expect(followUpTasks([c], now)).toEqual([expect.objectContaining({ type: 'thanks', label: 'Thank Jordan Lee for the coffee chat' })]);
    expect(c.history?.map((h) => h.type)).toEqual(['met', 'linkedin', 'email', 'reply', 'coffee']);
  });

  it('merges everything exchanged in Gmail (sent from the app or from Gmail) into the history, once', () => {
    let c: Contact = { ...contactFromSuggestion({ key: 'k', name: 'Jordan Lee', role: 'PM', company: 'Streamly', eventId: 'u1', eventTitle: 'Info session', eventDate: pastEvent.start }), email: 'jordan@streamly.com' };
    const items = [
      { id: 'm1', threadId: 't9', date: iso(now - 1.5 * DAY), direction: 'sent' as const, subject: 'Great to meet you' },
      { id: 'm2', threadId: 't9', date: iso(now - DAY), direction: 'received' as const, subject: 'Re: Great to meet you' },
    ];
    c = mergeActivity(c, items);
    expect(c.emails?.[0]).toMatchObject({ threadId: 't9', kind: 'gmail', repliedAt: iso(now - DAY) });
    expect(c.history?.map((h) => h.type)).toEqual(['met', 'email', 'reply']);
    expect(stageOf(c, now)).toBe('replied');
    expect(mergeActivity(c, items)).toBe(c); // nothing new: unchanged
  });

  it('saves one clear email match, lets you choose when there are several', () => {
    const c = contactFromSuggestion({ key: 'k', name: 'Jordan Lee', role: '', company: '', eventId: 'u1', eventTitle: 'x', eventDate: pastEvent.start });
    expect(applyFoundAddress(c, ['jordan@streamly.com'])).toMatchObject({ email: 'jordan@streamly.com' });
    expect(applyFoundAddress(c, ['a@x.com', 'b@y.com'])).toMatchObject({ emailCandidates: ['a@x.com', 'b@y.com'] });
    expect(applyFoundAddress(c, [])).toBe(c);
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

  it('finds a contact met in person by their name in Gmail (accents and order ignored), never your own address', async () => {
    expect(sameName('José María Pérez', 'Jose Maria Perez')).toBe(true);
    expect(sameName('Lee, Jordan', 'Jordan Lee')).toBe(true);
    expect(sameName('Jordan Smith', 'Jordan Lee')).toBe(false);
    expect(parseAddressList('"Lee, Jordan" <jordan@streamly.com>, Sam <sam@x.com>').map((a) => a.email)).toEqual(['jordan@streamly.com', 'sam@x.com']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/messages?')
          ? new Response(JSON.stringify({ messages: [{ id: 'a' }, { id: 'b' }] }))
          : new Response(JSON.stringify({ payload: { headers: [{ name: 'From', value: 'Alex <student@example.com>' }, { name: 'To', value: 'Jordan Lee <jordan@streamly.com>, Team <team@streamly.com>' }] } })),
      ),
    );
    const { found } = await findAddresses('token', 'student@example.com', [{ id: 'c1', name: 'Jordan Lee' }]);
    expect(found.c1.exact).toEqual(['jordan@streamly.com']);
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

  const setup = () => {
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
    renderApp('/contacts');
  };

  it('people from past networking events are added to Contacts automatically; Connect opens their follow-up', async () => {
    setup();
    const user = userEvent.setup();
    const box = (await screen.findByRole('heading', { name: /New from your events/ })).closest('section')!;
    expect(box).toHaveTextContent('Jordan Lee');
    expect(screen.getAllByTestId('contact').some((r) => r.textContent?.includes('Jordan Lee'))).toBe(true);
    expect(screen.getByRole('heading', { name: /To do/ }).closest('section')).toHaveTextContent('Connect with Jordan Lee (LinkedIn or email)');
    await user.click(within(box as HTMLElement).getByRole('button', { name: 'Connect' }));
    const drawer = await screen.findByRole('dialog', { name: 'Jordan Lee' });
    expect(within(drawer).getByRole('link', { name: /Find on LinkedIn/ })).toHaveAttribute('target', '_blank');
    await user.click(within(drawer).getByRole('button', { name: /Mark invitation as sent/ }));
    expect(await within(drawer).findByText(/Invitation sent on/)).toBeInTheDocument();
    expect(drawer).toHaveTextContent('Added on LinkedIn');
    expect(screen.queryByRole('heading', { name: /New from your events/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: /To do/ })).toBeNull(); // LinkedIn needs nothing more
  });

  it('Dismiss removes the person and they never come back', async () => {
    setup();
    const user = userEvent.setup();
    const box = (await screen.findByRole('heading', { name: /New from your events/ })).closest('section')!;
    await user.click(within(box as HTMLElement).getByRole('button', { name: 'Dismiss Jordan Lee' }));
    expect(screen.queryByRole('heading', { name: /New from your events/ })).toBeNull();
    await new Promise((ok) => setTimeout(ok, 50));
    expect(screen.queryAllByTestId('contact').some((r) => r.textContent?.includes('Jordan Lee'))).toBe(false);
  });
});
