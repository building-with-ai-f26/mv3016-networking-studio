import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGeminiRequest, estimateCostUsd, parseGeminiResponse, validateEventInput } from '../../server/brief.mjs';
import { buildFactsRequest, canResearch, parseFacts, sanitizeSuggestions } from '../../server/research.mjs';
import { stripActive } from '../components/brief/AiBriefDocument';
import { onboardedAccountState, renderApp } from './renderApp';

const briefJson = {
  essentials: { summary: 'Info session with Acme.', goal: 'Learn about the PM role.', prepareFor: ['Product questions'] },
  people: [{ name: 'Jordan Lee', role: 'PM', company: 'Acme', foundIn: 'Event title', howToConnect: 'Ask about launches.' }],
  companies: [],
  financialsToCheck: [],
  companyNewsToCheck: [],
  industryThemes: [],
  questionThemes: [{ theme: 'Product', questions: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9', 'Q10'] }],
  verifyBeforeEvent: [],
};
const factsText = `**Financials**
- Revenue grew 12% year over year to $4 billion (Q3 2026)
**News**
- Acme launched a new app (October 2026): Shows product focus.
**People**
- Jordan Lee: Product Manager at Acme since 2024.`;
const grounded = {
  candidates: [
    {
      content: { parts: [{ text: factsText }] },
      groundingMetadata: {
        webSearchQueries: ['Acme Q3 2026 results', 'Acme news', ''],
        groundingChunks: [{ web: { uri: 'https://example.com/a', title: 'example.com' } }, { web: { uri: 'https://example.com/a', title: 'dup' } }, { web: { uri: 'javascript:alert(1)', title: 'bad' } }, { web: { uri: 'https://news.example/b', title: 'news.example' } }],
        groundingSupports: [
          { segment: { text: 'Revenue grew 12% year over year to $4 billion (Q3 2026)' }, groundingChunkIndices: [0, 1] },
          { segment: { text: 'Acme launched a new app (October 2026): Shows product focus.' }, groundingChunkIndices: [3] },
        ],
        searchEntryPoint: { renderedContent: '<style>.x{color:red}</style><div class="x" onclick="steal()"><a href="https://www.google.com/search?q=acme">acme</a></div><script>steal()</script>' },
      },
    },
  ],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 200, totalTokenCount: 300 },
};

describe('AI brief + web search (server)', () => {
  it('the brief itself stays in JSON mode without tools; the web search is a separate plain-text call with no emails', () => {
    const { event } = validateEventInput({ title: 'Info session', company: 'Acme', person: 'Jordan Lee jordan@acme.com' });
    const brief = buildGeminiRequest(event!, { model: 'gemini-3.5-flash-lite', maxOutputTokens: 4000 });
    expect((brief as { tools?: unknown }).tools).toBeUndefined();
    expect(brief.generationConfig.responseSchema).toBeDefined();
    const facts = buildFactsRequest(event!);
    expect(facts.tools).toEqual([{ google_search: {} }]);
    expect(facts.generationConfig.responseSchema).toBeUndefined();
    expect(JSON.stringify(facts)).not.toMatch(/jordan@/);
    expect(canResearch({ company: '', person: '' })).toBe(false);
  });

  it('reads each bullet with the sources that back it; dedupes https sources; strips scripts; counts searches', () => {
    const out = parseFacts(grounded);
    expect(out.financialHighlights[0]).toMatchObject({ fact: 'Revenue grew 12% year over year to $4 billion', period: 'Q3 2026', refs: [0] });
    expect(out.companyNews[0]).toMatchObject({ headline: 'Acme launched a new app', date: 'October 2026', whyItMatters: 'Shows product focus.', refs: [1] });
    expect(out.peopleWeb[0]).toMatchObject({ name: 'Jordan Lee', info: 'Product Manager at Acme since 2024.' });
    expect(out.web?.sources).toEqual([{ uri: 'https://example.com/a', title: 'example.com' }, { uri: 'https://news.example/b', title: 'news.example' }]);
    expect(out.web?.suggestionsHtml).not.toMatch(/<script|onclick/);
    expect(out.usage.searches).toBe(2);
    expect(estimateCostUsd(out.usage, { inputPerMillion: 0.3, outputPerMillion: 2.5 })).toBeCloseTo(0.00003 + 0.0005 + 0.028, 6);
  });

  it('never keeps figures or news that did not come from a real search with sources', () => {
    const out = parseFacts({ candidates: [{ content: { parts: [{ text: factsText }] } }], usageMetadata: {} });
    expect(out.financialHighlights).toEqual([]);
    expect(out.companyNews).toEqual([]);
    expect(out.web).toBeNull();
  });

  it('sanitizers drop executable HTML (server and browser)', () => {
    const evil = '<img src=x onerror="alert(1)"><a href="javascript:alert(2)">x</a><iframe src="https://evil"></iframe>';
    for (const clean of [sanitizeSuggestions(evil), stripActive(evil)]) expect(clean).not.toMatch(/onerror|javascript:|<iframe/);
  });
});

describe('AI brief with Google Search (in the app)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the figures and news in sections 4-5 and the web sources (not tracked) in section 8', async () => {
    const { brief: base, usage } = parseGeminiResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(briefJson) }] } }], usageMetadata: {} });
    const f = parseFacts(grounded);
    const brief = { ...base, financialHighlights: f.financialHighlights, companyNews: f.companyNews, peopleWeb: f.peopleWeb, web: f.web! };
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
    expect(await screen.findByText('Revenue grew 12% year over year to $4 billion')).toBeInTheDocument();
    expect(screen.getByText('Acme launched a new app')).toBeInTheDocument();
    expect(screen.getByText(/Product Manager at Acme since 2024/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Source 2: news.example' })[0]).toHaveAttribute('href', 'https://news.example/b');
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
