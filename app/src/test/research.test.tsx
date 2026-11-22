import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildResearchRequest, parseResearchResponse, researchCostUsd, sanitizeSuggestions, validateResearchInput } from '../../server/research.mjs';
import { stripActive } from '../components/brief/ResearchPanel';

const grounded = {
  candidates: [
    {
      content: { parts: [{ text: 'Company news (last 12 months)\n- Acme launched a new product in March 2026.' }] },
      groundingMetadata: {
        webSearchQueries: ['Acme news 2026', 'Acme revenue 2025', ''],
        groundingChunks: [{ web: { uri: 'https://example.com/a', title: 'example.com' } }, { web: { uri: 'https://example.com/a', title: 'dup' } }, { web: { uri: 'javascript:alert(1)', title: 'bad' } }],
        searchEntryPoint: { renderedContent: '<style>.x{color:red}</style><div class="x" onclick="steal()"><a href="https://www.google.com/search?q=acme">acme</a></div><script>steal()</script>' },
      },
    },
  ],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 200 },
};

describe('Web search (Google Search grounding) — server helpers', () => {
  it('never sends emails or links to the search, and needs a company or a person', () => {
    const { input } = validateResearchInput({ company: 'Acme', person: 'Jordan Lee jordan@acme.com', topic: 'see https://acme.com/event' });
    const text = JSON.stringify(buildResearchRequest(input!));
    expect(text).not.toMatch(/jordan@|https:\/\/acme/);
    expect(text).toContain('"google_search":{}');
    expect(validateResearchInput({ title: 'Lunch' }).error).toMatch(/company or the person/);
  });

  it('keeps the grounded text as returned, dedupes https sources, counts real searches and strips scripts', () => {
    const out = parseResearchResponse(grounded);
    expect(out.text).toBe('Company news (last 12 months)\n- Acme launched a new product in March 2026.');
    expect(out.sources).toEqual([{ uri: 'https://example.com/a', title: 'example.com' }]);
    expect(out.usage.searches).toBe(2);
    expect(out.suggestionsHtml).toContain('google.com/search');
    expect(out.suggestionsHtml).not.toMatch(/<script|onclick/);
    expect(researchCostUsd(out.usage, { inputPerMillion: 0.3, outputPerMillion: 2.5 })).toBeCloseTo(0.028 + 0.00003 + 0.0005, 5);
  });

  it('sanitizers drop executable HTML (server and browser)', () => {
    const evil = '<img src=x onerror="alert(1)"><a href="javascript:alert(2)">x</a><iframe src="https://evil"></iframe>';
    for (const clean of [sanitizeSuggestions(evil), stripActive(evil)]) expect(clean).not.toMatch(/onerror|javascript:|<iframe/);
  });
});

describe('Web search — in the brief', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('runs only on click, shows text, sources and Google suggestions, and is excluded from analytics', async () => {
    const { ResearchPanel } = await import('../components/brief/ResearchPanel');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ...parseResearchResponse(grounded), costUsd: 0.03, searchedAt: '2026-11-22T10:00:00Z' })));
    vi.stubGlobal('fetch', fetchMock);
    const { StoreProvider } = await import('../state/store');
    const run = {
      id: 'r',
      event: { title: 'Coffee chat', datetime: '', company: 'Acme', person: 'Jordan Lee', role: 'PM', notes: '' },
      brief: { version: 2, essentials: { summary: '', goal: '', prepareFor: [] }, people: [], companies: [], financialsToCheck: [], companyNewsToCheck: [], industryThemes: [], questionThemes: [], verifyBeforeEvent: [] },
      usage: { inputTokens: 1, outputTokens: 1 },
      costUsd: 0,
      model: 'm',
      generatedAt: '2026-11-22T09:00:00Z',
    };
    const { MemoryRouter } = await import('react-router-dom');
    const { container } = render(
      <MemoryRouter>
        <StoreProvider>
          <ResearchPanel run={run as never} eventId="none" />
        </StoreProvider>
      </MemoryRouter>,
    );
    expect(fetchMock).not.toHaveBeenCalledWith('/api/research', expect.anything());
    expect(container.querySelector('.research')?.classList.contains('ph-no-capture')).toBe(true);
    await userEvent.setup().click(screen.getByRole('button', { name: /Search the web/ }));
    expect(fetchMock).toHaveBeenCalledWith('/api/research', expect.anything());
    const body = JSON.parse((fetchMock.mock.calls.find((c) => (c as unknown[])[0] === '/api/research') as unknown as [string, RequestInit])[1].body as string);
    expect(Object.keys(body).sort()).toEqual(['company', 'datetime', 'person', 'role', 'title', 'topic']);
  });
});
