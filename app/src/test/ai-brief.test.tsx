import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildChatRequest, buildGeminiRequest, estimateCostUsd, parseGeminiResponse, parseMoreQuestions, validateEventInput, validateFollowUp } from '../../server/brief.mjs';
import { briefFileName, briefSections } from '../lib/briefExport';
import { renderApp } from './renderApp';

const brief = {
  essentials: { summary: 'A coffee chat about product roles.', goal: 'Learn about the team.', prepareFor: ['Arrive early'] },
  people: [{ name: 'Sam Rivera', role: 'Product Manager', company: 'Acme', foundIn: 'Event title', howToConnect: 'Ask about their path into PM.' }],
  companies: [{ name: 'Acme', foundIn: 'Company field', overview: 'Software company. Exact team size: Not verified.', businessModel: 'Subscriptions.', products: [{ name: 'Mobile app', whyItMatters: 'Main product.' }] }],
  financialsToCheck: ['Latest annual report on the investor relations site'],
  companyNewsToCheck: ['Product announcements from the last 3 months'],
  industryThemes: [{ theme: 'AI in product', whyItMatters: 'Likely topic of the chat.' }],
  questionThemes: [
    { theme: 'Role', questions: ['Q1', 'Q2', 'Q3', 'Q4'] },
    { theme: 'Team', questions: ['Q5', 'Q6', 'Q7'] },
    { theme: 'Career', questions: ['Q8', 'Q9', 'Q10'] },
  ],
  verifyBeforeEvent: ['Confirm the person’s current role'],
};
const gemini = (b: unknown, extra: Record<string, unknown> = {}) => ({
  candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(b) }] } }],
  usageMetadata: { promptTokenCount: 400, candidatesTokenCount: 900, totalTokenCount: 1300 },
  ...extra,
});

describe('AI brief server helpers', () => {
  it('requires a title and limits field length', () => {
    expect(validateEventInput({ company: 'Acme' }).error).toMatch(/title/i);
    expect(validateEventInput({ title: 'Chat' }).error).toBeUndefined(); // calendar events may only have a title
    expect(validateEventInput({ title: 'Chat', person: 'Sam', notes: 'x'.repeat(2001) }).error).toMatch(/too long/);
    expect(validateEventInput({ title: ' Chat ', company: 'Acme' }).event?.title).toBe('Chat');
  });

  it('asks for JSON with a token limit and honesty rules', () => {
    const req = buildGeminiRequest(validateEventInput({ title: 'Chat', company: 'Acme' }).event!, { model: 'gemini-2.5-flash-lite', maxOutputTokens: 4000 });
    expect(req.generationConfig).toMatchObject({ maxOutputTokens: 4000, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } });
    expect(req.systemInstruction.parts[0].text).toMatch(/Never invent news/);
    expect(req.systemInstruction.parts[0].text).toMatch(/Not verified/);
  });

  it('parses the answer, counts tokens and computes cost', () => {
    const { brief: b, usage } = parseGeminiResponse(gemini(brief));
    expect(b.questionThemes.flatMap((t) => t.questions)).toHaveLength(10);
    expect(b.version).toBe(2);
    expect(b.people[0].name).toBe('Sam Rivera');
    expect(b.financialsToCheck).toHaveLength(1);
    expect(usage).toEqual({ inputTokens: 400, outputTokens: 900 });
    expect(estimateCostUsd(usage, { inputPerMillion: 0.1, outputPerMillion: 0.4 })).toBeCloseTo(0.0004, 6);
  });

  it('accepts an optional PDF for one brief and sends it to the AI as a document', () => {
    const ok = validateEventInput({ title: 'Panel', attachment: { name: 'agenda.pdf', mimeType: 'application/pdf', data: 'JVBERi0xLjQK' } });
    expect(ok.attachment).toMatchObject({ mimeType: 'application/pdf', name: 'agenda.pdf' });
    const req = buildGeminiRequest(ok.event!, { model: 'gemini-3.5-flash-lite', maxOutputTokens: 4000, attachment: ok.attachment });
    expect(req.contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'application/pdf', data: 'JVBERi0xLjQK' } });
    expect(validateEventInput({ title: 'Panel', attachment: { name: 'x.exe', mimeType: 'application/x-msdownload', data: 'AAAA' } }).error).toMatch(/PDF/);
  });

  it('rejects cut-off or broken answers', () => {
    expect(() => parseGeminiResponse({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{' }] } }] })).toThrow(/cut off/);
    expect(() => parseGeminiResponse({ candidates: [{ content: { parts: [{ text: 'hello' }] } }] })).toThrow(/JSON/);
    expect(() => parseGeminiResponse({})).toThrow(/no answer/);
  });
});

describe('Add event + AI brief from Calendar', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function addEvent(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Add event' }));
    await user.click(screen.getByRole('tab', { name: 'Manually' }));
    await user.type(screen.getByLabelText(/Event title/), 'Coffee chat with Sam');
    await user.type(screen.getByLabelText('Company'), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Add to calendar' }));
  }

  it('adds an event by hand, generates a real AI brief from the calendar and shows it on the event page', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      url === '/api/brief'
        ? new Response(JSON.stringify({ brief, usage: { inputTokens: 400, outputTokens: 900 }, costUsd: 0.0004, model: 'test-model', generatedAt: '2026-11-16T10:00:00-05:00' }), { status: 200 })
        : new Response('{}', { status: 404 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderApp('/calendar');
    await addEvent(user);

    const card = await screen.findByRole('link', { name: 'Coffee chat with Sam' });
    expect(card).toBeInTheDocument();
    // The card says what is missing; Generate opens "Confirm details" asking only for it.
    expect(card.closest('article')).toHaveTextContent('Missing: person, topic');
    await user.click(screen.getByRole('button', { name: 'Generate brief with AI' }));
    const dialog = screen.getByRole('dialog', { name: 'Confirm details' });
    expect(dialog).toHaveTextContent('is missing: person, topic');
    expect(within(dialog).getByLabelText(/Company/)).toHaveValue('Acme');
    await user.type(within(dialog).getByLabelText(/Person/), 'Sam Rivera');
    await user.type(within(dialog).getByLabelText(/What is it about/), 'PM recruiting');
    await user.type(within(dialog).getByLabelText('Paste anything useful'), 'Sam leads the checkout team.');
    await user.click(within(dialog).getByRole('button', { name: /Generate brief/ }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open brief: Coffee chat with Sam' }).closest('article')).toHaveTextContent('Brief ready'));
    expect(fetchMock).toHaveBeenCalledWith('/api/brief', expect.objectContaining({ method: 'POST' }));
    const sent = JSON.parse(String(fetchMock.mock.calls.find((c) => c[0] === '/api/brief')![1]!.body));
    expect(sent).toMatchObject({ title: 'Coffee chat with Sam', company: 'Acme', person: 'Sam Rivera', topic: 'PM recruiting', extraContext: 'Sam leads the checkout team.' });
    expect(sent.datetime).toMatch(/Monday, November 9, 2026, 4:00 PM/);

    await user.click(screen.getByRole('link', { name: 'Open brief: Coffee chat with Sam' }));
    expect(await screen.findByText('AI-generated draft')).toBeInTheDocument();
    for (const h of ['Event essentials & what to prepare', 'People & roles', 'Companies', 'Latest financial-report highlights', 'Company news (last 3 months)', 'Industry themes & why they matter', 'Suggested questions', 'Sources & what to verify'])
      expect(screen.getByRole('heading', { name: new RegExp(h.replace(/[()&]/g, '.')) })).toBeInTheDocument();
    expect(screen.getByText('What to verify before the event')).toBeInTheDocument();
    expect(screen.getAllByText('Not verified').length).toBeGreaterThanOrEqual(3); // company size + financials + news
    expect(screen.getByText(/400 input \+ 900 output tokens/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.00040/)).toBeInTheDocument();
  });

  it('shows a clear error on the calendar when the server fails, and keeps the sample events', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/api/brief' ? new Response(JSON.stringify({ error: 'GEMINI_API_KEY is missing in app/.env.' }), { status: 503 }) : new Response('{}', { status: 404 }))));
    const user = userEvent.setup();
    renderApp('/calendar');
    await addEvent(user);
    await user.click(screen.getByRole('button', { name: 'Generate brief with AI' }));
    await user.click(screen.getByRole('button', { name: 'Skip and generate anyway' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('GEMINI_API_KEY is missing'));
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('Siemens Info Session: Careers in Industrial Tech')).toBeInTheDocument();
  });

  it('requires a title and a company or person', async () => {
    const user = userEvent.setup();
    renderApp('/calendar');
    await user.click(screen.getByRole('button', { name: 'Add event' }));
    await user.click(screen.getByRole('tab', { name: 'Manually' }));
    await user.click(screen.getByRole('button', { name: 'Add to calendar' }));
    expect(screen.getByText('Add a title.')).toBeInTheDocument();
    expect(screen.getByText(/Add a company or a person/)).toBeInTheDocument();
  });
});

describe('AI brief: interactive questions, AI chat and downloads', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('server helpers: new questions never repeat; chat sends the brief as context and maps roles', () => {
    const out = parseMoreQuestions(
      { candidates: [{ content: { parts: [{ text: JSON.stringify({ questions: [{ theme: 'Role', question: 'Q1' }, { theme: 'Team', question: 'A brand new one?' }] }) }] } }] },
      ['Q1'],
    );
    expect(out.questions).toEqual([{ theme: 'Team', question: 'A brand new one?' }]);
    const input = validateFollowUp({ event: { title: 'Chat', company: 'Acme' }, brief, messages: [{ role: 'user', text: 'Recap?' }, { role: 'assistant', text: 'Sure' }, { role: 'system', text: 'x' }] }).input!;
    const req = buildChatRequest(input, { model: 'gemini-3.5-flash-lite' });
    expect(req.contents.map((c) => c.role)).toEqual(['user', 'model']);
    expect(req.systemInstruction.parts[0].text).toMatch(/Never invent news/);
    expect(req.systemInstruction.parts[0].text).toContain('A coffee chat about product roles.');
  });

  it('save/copy questions, Saved only, Generate more questions and the AI chat; Word export has the 8 sections', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url === '/api/brief') return new Response(JSON.stringify({ brief: { ...brief, version: 2 }, usage: { inputTokens: 400, outputTokens: 900 }, costUsd: 0.0004, model: 'test-model', generatedAt: '2026-11-16T10:00:00-05:00' }));
        if (url === '/api/brief/questions') return new Response(JSON.stringify({ questions: [{ theme: 'Team', question: 'What would surprise a new PM on your team?' }], costUsd: 0.0001 }));
        if (url === '/api/brief/chat') return new Response(JSON.stringify({ reply: 'Lead with your interest in personalization.', costUsd: 0.0001 }));
        return new Response('{}', { status: 404 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/calendar');
    await user.click(screen.getByRole('button', { name: 'Add event' }));
    await user.click(screen.getByRole('tab', { name: 'Manually' }));
    await user.type(screen.getByLabelText(/Event title/), 'Coffee chat with Sam');
    await user.type(screen.getByLabelText('Company'), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Add to calendar' }));
    await user.click(await screen.findByRole('button', { name: 'Generate brief with AI' }));
    await user.click(screen.getByRole('button', { name: 'Skip and generate anyway' }));
    await user.click(await screen.findByRole('link', { name: 'Open brief: Coffee chat with Sam' }));
    await screen.findByText('AI-generated draft');

    // Save one question, then filter to saved ones.
    await user.click(screen.getByRole('button', { name: 'Save question: Q3' }));
    await user.click(screen.getByRole('button', { name: /Saved only \(1\)/ }));
    expect(screen.getByText('Q3')).toBeInTheDocument();
    expect(screen.queryByText('Q1')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Saved only/ }));

    // Generate more questions (real AI through the server).
    await user.click(screen.getByRole('button', { name: /Generate more questions/ }));
    expect(await screen.findByText('What would surprise a new PM on your team?')).toBeInTheDocument();

    // AI chat.
    await user.click(screen.getByRole('button', { name: 'Give me a 60-second recap' }));
    expect(await screen.findByText('Lead with your interest in personalization.')).toBeInTheDocument();
    expect(calls).toContain('/api/brief/chat');

    // Download buttons are there.
    expect(screen.getByRole('button', { name: /PDF/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Word/ })).toBeInTheDocument();
  });

  it('the Word file content has the 8 sections, extra and saved questions, and a safe file name', () => {
    const run = {
      id: 'r', event: { title: 'x', datetime: '', company: '', person: '', role: '', notes: '' }, brief: { ...brief, version: 2 as const },
      usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0, model: 'm', generatedAt: '2026-11-16T10:00:00-05:00',
      extraQuestions: [{ theme: 'Team', question: 'Extra?' }], savedQuestions: ['Q2'],
    };
    const ev = { id: 'e', title: 'Coffee chat: Sam / Acme!', start: '2026-11-18T16:00:00-05:00', end: '2026-11-18T17:00:00-05:00', location: '', type: 'Coffee chat' as const, company: 'Acme', person: 'Sam', role: '', notes: '', source: 'manual' as const };
    const sections = briefSections(run, ev);
    expect(sections.map((s) => s.heading)).toHaveLength(8);
    const qs = sections[6].numbered!.flatMap((g) => g.items);
    expect(qs).toHaveLength(11);
    expect(qs).toContain('Q2 (saved)');
    expect(qs).toContain('Extra?');
    expect(briefFileName(ev, 'docx')).toBe('brief-coffee-chat-sam-acme-2026-11-18.docx');
  });
});

describe('Event details: attendees, contacts and what is missing', () => {
  it('uses attendee names + company from the email domain (never emails), and your matching contacts with notes', async () => {
    const { attendeeLines, contactsText, knownDetails, matchingContacts, missingDetails } = await import('../lib/eventDetails');
    const ev = {
      id: 'g-1', title: 'Catch up', start: '2026-11-18T16:00:00-05:00', end: '2026-11-18T16:30:00-05:00', location: 'Zoom', type: 'Other' as const,
      company: '', person: '', role: '', notes: '', source: 'google' as const,
      google: {
        description: '', allDay: false, eventType: 'default', recurringEventId: null, selfResponse: 'accepted', online: true,
        attendees: [
          { name: 'Me', domain: 'school.edu', self: true, organizer: false, responseStatus: 'accepted' },
          { name: 'Daniel Ortiz', domain: 'stripe.com', self: false, organizer: true, responseStatus: 'accepted' },
          { name: '', domain: 'gmail.com', self: false, organizer: false, responseStatus: '' },
        ],
      },
    };
    expect(attendeeLines(ev)).toEqual(['Daniel Ortiz · Stripe']);
    const k = knownDetails(ev);
    expect(k).toMatchObject({ company: 'Stripe', person: 'Daniel Ortiz' });
    expect(missingDetails(ev)).toEqual(['topic']);
    const contacts = [
      { id: 'c1', name: 'Daniel Ortiz', role: 'Partnerships', company: 'Stripe', lastContact: '2026-10-02', referral: 'yes' as const, notes: 'Talked about the Atlas team', isSample: false },
      { id: 'c2', name: 'Someone Else', role: '', company: '', lastContact: '' as const, referral: 'unknown' as const, notes: '', isSample: false },
    ];
    const m = matchingContacts(contacts, ev, k);
    expect(m.map((c) => c.id)).toEqual(['c1']);
    expect(contactsText(m)).toContain('your notes: Talked about the Atlas team');
  });
});
