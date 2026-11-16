import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGeminiRequest, estimateCostUsd, parseGeminiResponse, validateEventInput } from '../../server/brief.mjs';
import { renderApp } from './renderApp';

const brief = {
  essentials: { summary: 'A coffee chat about product roles.', whoYouWillMeet: 'A product manager.', goalForTheConversation: 'Learn about the team.', prepTips: ['Arrive early'] },
  companyOverview: 'Music streaming company. Exact team size: Not verified.',
  relevantProducts: [{ name: 'Mobile app', whyItMatters: 'Main product.' }],
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
  it('requires a title and a company or person', () => {
    expect(validateEventInput({ company: 'Acme' }).error).toMatch(/title/i);
    expect(validateEventInput({ title: 'Chat' }).error).toMatch(/company or a person/i);
    expect(validateEventInput({ title: 'Chat', person: 'Sam', notes: 'x'.repeat(2001) }).error).toMatch(/too long/);
    expect(validateEventInput({ title: ' Chat ', company: 'Acme' }).event?.title).toBe('Chat');
  });

  it('asks for JSON with a token limit and honesty rules', () => {
    const req = buildGeminiRequest(validateEventInput({ title: 'Chat', company: 'Acme' }).event!, { model: 'gemini-2.5-flash-lite', maxOutputTokens: 2500 });
    expect(req.generationConfig).toMatchObject({ maxOutputTokens: 2500, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } });
    expect(req.systemInstruction.parts[0].text).toMatch(/Never invent news/);
    expect(req.systemInstruction.parts[0].text).toMatch(/Not verified/);
  });

  it('parses the answer, counts tokens and computes cost', () => {
    const { brief: b, usage } = parseGeminiResponse(gemini(brief));
    expect(b.questionThemes.flatMap((t) => t.questions)).toHaveLength(10);
    expect(usage).toEqual({ inputTokens: 400, outputTokens: 900 });
    expect(estimateCostUsd(usage, { inputPerMillion: 0.1, outputPerMillion: 0.4 })).toBeCloseTo(0.0004, 6);
  });

  it('rejects cut-off or broken answers', () => {
    expect(() => parseGeminiResponse({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{' }] } }] })).toThrow(/cut off/);
    expect(() => parseGeminiResponse({ candidates: [{ content: { parts: [{ text: 'hello' }] } }] })).toThrow(/JSON/);
    expect(() => parseGeminiResponse({})).toThrow(/no answer/);
  });
});

describe('AI Brief page', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('generates a brief through the local server and shows draft label, flags and cost', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ brief, usage: { inputTokens: 400, outputTokens: 900 }, costUsd: 0.0004, model: 'test-model', generatedAt: '2026-11-16T10:00:00-05:00' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderApp('/ai-brief');
    await user.type(screen.getByLabelText(/Event title/), 'Coffee chat with Sam');
    await user.type(screen.getByLabelText('Company'), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Generate brief with AI' }));

    expect(await screen.findByText('AI-generated draft')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/brief', expect.objectContaining({ method: 'POST' }));
    expect(screen.getByText('What to verify before the event')).toBeInTheDocument();
    expect(screen.getByText('Not verified')).toBeInTheDocument();
    expect(screen.getByText(/400 input \+ 900 output tokens/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.00040/)).toBeInTheDocument();
  });

  it('shows a clear error when the server fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'GEMINI_API_KEY is missing in app/.env.' }), { status: 503 })));
    const user = userEvent.setup();
    renderApp('/ai-brief');
    await user.type(screen.getByLabelText(/Event title/), 'Panel');
    await user.type(screen.getByLabelText('Person'), 'Sam');
    await user.click(screen.getByRole('button', { name: 'Generate brief with AI' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('GEMINI_API_KEY is missing'));
  });
});
