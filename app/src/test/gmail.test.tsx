import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { _appDrafts, buildRawEmail, buildSearchQuery, composeRequest, parseCompose, parseFrom, sendDraft, validRecipients } from '../../server/gmail.mjs';
import { onboardedAccountState, renderApp } from './renderApp';

const decode = (raw: string) => Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

describe('Gmail (server helpers)', () => {
  it('searches only for names and companies, recent mail, without search operators from the input', () => {
    expect(buildSearchQuery({ person: 'Jordan Lee', company: 'Streamly' })).toBe('("Jordan Lee" OR "Streamly") newer_than:180d -in:chats');
    expect(buildSearchQuery({ person: 'x" OR from:boss', company: '' })).not.toMatch(/from:|"x"/);
    expect(buildSearchQuery({ person: '', company: '', title: '' })).toBe('');
  });

  it('reads the sender as name, email and domain', () => {
    expect(parseFrom('"Jordan Lee" <jordan@streamly.com>')).toEqual({ name: 'Jordan Lee', email: 'jordan@streamly.com', domain: 'streamly.com' });
  });

  it('blocks header injection and bad recipients', () => {
    expect(validRecipients('a@b.com, c@d.org')).toEqual(['a@b.com', 'c@d.org']);
    expect(validRecipients('a@b.com\nBcc: evil@x.com')).toBeNull();
    expect(validRecipients('not-an-email')).toBeNull();
    const raw = decode(buildRawEmail({ to: 'jordan@streamly.com', subject: 'Thanks\r\nBcc: evil@x.com', body: 'Hi Jordan' }));
    expect(raw).not.toMatch(/^Bcc:/m);
    expect(raw).toMatch(/^To: jordan@streamly.com$/m);
    expect(() => buildRawEmail({ to: 'x', subject: 's', body: 'b' })).toThrow(/recipient/);
  });

  it('only sends drafts created by the app for that user', async () => {
    await expect(sendDraft('token', 'student@example.com', 'someone-elses-draft')).rejects.toThrow(/Save this email as a draft first/);
    _appDrafts.set('student@example.com', new Set(['d1']));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'm1' })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(sendDraft('token', 'student@example.com', 'd1')).resolves.toEqual({ messageId: 'm1' });
    expect(_appDrafts.get('student@example.com')?.has('d1')).toBe(false);
    vi.unstubAllGlobals();
  });

  it('the AI writes without links or email addresses and never invents what was said', () => {
    const req = composeRequest({ kind: 'thanks', language: 'es', studentName: 'Alex', studentProgram: 'MBA', recipientName: 'Jordan', event: { title: 'Info session', company: 'Streamly', datetime: '' }, briefSummary: 'Streamly grows ads.', notes: '' });
    expect(req.contents[0].parts[0].text).toMatch(/never invent what was said/);
    expect(req.contents[0].parts[0].text).toMatch(/in Spanish/);
    const out = parseCompose({ candidates: [{ content: { parts: [{ text: JSON.stringify({ subject: 'Thanks!', body: 'Write me at a@b.com or https://x.com' }) }] } }] });
    expect(out.body).not.toMatch(/a@b\.com|https:/);
  });
});

describe('Emails panel (in the app)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const setup = (gmailConnected: boolean) => {
    const start = new Date(Date.now() + 26 * 3600_000).toISOString();
    const brief = { version: 2, essentials: { summary: 'Info session.', goal: '', prepareFor: [] }, people: [], companies: [], financialsToCheck: [], companyNewsToCheck: [], industryThemes: [], questionThemes: [{ theme: 'General', questions: ['Q1'] }], verifyBeforeEvent: [] };
    const state = {
      ...onboardedAccountState(),
      userEvents: [{ id: 'u1', source: 'manual', title: 'Streamly info session', start, end: start, company: 'Streamly', person: 'Jordan Lee', role: 'PM', notes: '', location: '' }],
      aiBriefs: { u1: { id: 'r', event: { title: 'x', datetime: '', company: 'Streamly', person: 'Jordan Lee', role: '', notes: '' }, brief, usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0, model: 'm', generatedAt: start } },
    };
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url === '/api/state') return new Response(JSON.stringify({ state }));
        if (url === '/api/me') return new Response(JSON.stringify({ configured: true, signedIn: true, email: 'student@example.com', calendarConnected: false, gmailConnected }));
        if (url === '/api/gmail/compose') return new Response(JSON.stringify({ subject: 'Thank you', body: 'Hi Jordan, thanks!' }));
        if (url === '/api/gmail/drafts') return new Response(JSON.stringify({ draftId: 'd1' }));
        if (url === '/api/gmail/send') return new Response(JSON.stringify({ messageId: 'm1' }));
        return new Response('{}', { status: 404 });
      }),
    );
    renderApp('/events/u1');
    return calls;
  };

  it('asks to connect Gmail first', async () => {
    setup(false);
    expect(await screen.findByRole('link', { name: 'Connect Gmail' })).toHaveAttribute('href', '/auth/google/start?step=gmail');
  });

  it('writes with AI, lets you edit, and sends only after you confirm', async () => {
    const calls = setup(true);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Write with AI/ }));
    expect(await screen.findByDisplayValue('Thank you')).toBeInTheDocument();
    await user.type(screen.getByLabelText('To'), 'jordan@streamly.com');
    await user.click(screen.getByRole('button', { name: /Send…/ }));
    expect(calls).not.toContain('/api/gmail/send');
    const dialog = await screen.findByRole('dialog', { name: 'Send this email?' });
    expect(dialog).toHaveTextContent('jordan@streamly.com');
    await user.click(within(dialog).getByRole('button', { name: /Send now/ }));
    expect(await screen.findByText(/Email sent to jordan@streamly.com/)).toBeInTheDocument();
    expect(calls.filter((c) => c.startsWith('/api/gmail/'))).toEqual(['/api/gmail/compose', '/api/gmail/drafts', '/api/gmail/send']);
  });
});
