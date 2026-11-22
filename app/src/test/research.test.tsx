import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGeminiRequest, estimateCostUsd, parseGeminiResponse, validateEventInput } from '../../server/brief.mjs';
import { sanitizeSuggestions } from '../../server/research.mjs';
import { stripActive } from '../components/brief/AiBriefDocument';
import { onboardedAccountState, renderApp } from './renderApp';

const briefJson = {
  essentials: { summary: 'Info session with Acme.', goal: 'Learn about the PM role.', prepareFor: ['Product questions'] },
  people: [{ name: 'Jordan Lee', role: 'PM', company: 'Acme', foundIn: 'Web search', howToConnect: 'Ask about launches.' }],
  companies: [],
  financialHighlights: [{ fact: 'Revenue grew 12% year over year.', period: 'Q3 2026', source: 'Acme investor relations' }],
  companyNews: [{ headline: 'Acme launched a new app', date: 'Oct 2026', source: 'Example News', whyItMatters: 'Shows product focus.' }],
  financialsToCheck: [],
  companyNewsToCheck: [],
  industryThemes: [],
  questionThemes: [{ theme: 'Product', questions: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9', 'Q10'] }],
  verifyBeforeEvent: [],
};
const grounded = {
  candidates: [
    {
      content: { parts: [{ text: '```json\n' + JSON.stringify(briefJson) + '\n```' }] },
      groundingMetadata: {
        webSearchQueries: ['Acme Q3 2026 results', 'Acme news', ''],
        groundingChunks: [{ web: { uri: 'https://example.com/a', title: 'example.com' } }, { web: { uri: 'https://example.com/a', title: 'dup' } }, { web: { uri: 'javascript:alert(1)', title: 'bad' } }],
        groundingSupports: [{ segment: { text: 'Revenue grew 12% year over year.' }, groundingChunkIndices: [0, 1] }],
        searchEntryPoint: { renderedContent: '<style>.x{color:red}</style><div class="x" onclick="steal()"><a href="https://www.google.com/search?q=acme">acme</a></div><script>steal()</script>' },
      },
    },
  ],
  usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 2000, totalTokenCount: 3000 },
};

describe('AI brief with Google Search (server)', () => {
  it('turns web search on in the request and keeps emails out', () => {
    const { event } = validateEventInput({ title: 'Info session', company: 'Acme', person: 'Jordan Lee' });
    const on = buildGeminiRequest(event!, { model: 'gemini-3.5-flash-lite', maxOutputTokens: 4000, webSearch: true });
    expect(on.tools).toEqual([{ google_search: {} }]);
    expect(on.systemInstruction.parts[0].text).toMatch(/Google Search/);
    const off = buildGeminiRequest(event!, { model: 'gemini-3.5-flash-lite', maxOutputTokens: 4000 });
    expect(off.tools).toBeUndefined();
    expect(off.systemInstruction.parts[0].text).toMatch(/no web access/);
  });

  it('reads figures, news, sources and searches; strips scripts; counts searches in the cost', () => {
    const { brief, usage } = parseGeminiResponse(grounded);
    expect(brief.financialHighlights?.[0]).toMatchObject({ period: 'Q3 2026' });
    expect(brief.companyNews?.[0].headline).toBe('Acme launched a new app');
    expect(brief.web?.sources).toEqual([{ uri: 'https://example.com/a', title: 'example.com' }]);
    expect(brief.web?.queries).toHaveLength(2);
    expect(brief.web?.suggestionsHtml).not.toMatch(/<script|onclick/);
    expect(usage.searches).toBe(2);
    // Each fact points to its source: from Google's supports, or by matching the named source to the source title.
    expect(brief.financialHighlights?.[0].refs).toEqual([0]);
    expect(brief.companyNews?.[0].refs).toEqual([0]);
    expect(estimateCostUsd(usage, { inputPerMillion: 0.3, outputPerMillion: 2.5 })).toBeCloseTo(0.0003 + 0.005 + 0.028, 6);
  });

  it('sanitizers drop executable HTML (server and browser)', () => {
    const evil = '<img src=x onerror="alert(1)"><a href="javascript:alert(2)">x</a><iframe src="https://evil"></iframe>';
    for (const clean of [sanitizeSuggestions(evil), stripActive(evil)]) expect(clean).not.toMatch(/onerror|javascript:|<iframe/);
  });
});

describe('AI brief with Google Search (in the app)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the figures and news in sections 4-5 and the web sources (not tracked) in section 8', async () => {
    const { brief, usage } = parseGeminiResponse(grounded);
    const start = new Date(Date.now() + 26 * 3600_000).toISOString();
    const state = {
      ...onboardedAccountState(),
      userEvents: [{ id: 'u1', source: 'manual', title: 'Acme info session', start, end: start, company: 'Acme', person: 'Jordan Lee', role: 'PM', notes: '', location: '' }],
      aiBriefs: { u1: { id: 'r', event: { title: 'Acme info session', datetime: '', company: 'Acme', person: 'Jordan Lee', role: 'PM', notes: '' }, brief, usage, costUsd: 0.03, model: 'm', generatedAt: start } },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/state') return new Response(JSON.stringify({ state }));
        if (url === '/api/me') return new Response(JSON.stringify({ configured: true, signedIn: true, email: 'student@example.com', calendarConnected: false }));
        return new Response('{}', { status: 404 });
      }),
    );
    renderApp('/events/u1');
    expect(await screen.findByText('Revenue grew 12% year over year.')).toBeInTheDocument();
    expect(screen.getByText('Acme launched a new app')).toBeInTheDocument();
    const cite = screen.getAllByRole('link', { name: 'Source 1: example.com' })[0];
    expect(cite).toHaveTextContent('1');
    expect(cite).toHaveAttribute('href', 'https://example.com/a');
    expect(cite).toHaveClass('ph-no-capture');
    const link = screen.getAllByRole('link', { name: /example\.com/ }).find((a) => !a.classList.contains('cite'))!;
    expect(link).toHaveAttribute('href', 'https://example.com/a');
    expect(link.closest('.ph-no-capture')).not.toBeNull();
    expect(within(document.body).queryByText(/no web search, so no figures/)).toBeNull();
  });
});
