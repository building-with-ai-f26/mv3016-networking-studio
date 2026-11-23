import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentCostUsd, dedupeBrief, newestFirst, notesFromGrounded, parseWriter, plan, researchRequest, runAgent, sameFact, writerRequest } from '../../server/agent.mjs';
import { onboardedAccountState, renderApp } from './renderApp';

const student = { name: 'Alex', program: 'MBA', careerGoal: 'PM in tech', roles: ['Product Manager'], industries: ['Media'], companies: ['Streamly', 'Payco'] };

const grounded = (text: string, chunks: string[], supports: Array<[string, number[]]> = []) => ({
  candidates: [
    {
      content: { parts: [{ text }] },
      groundingMetadata: {
        webSearchQueries: ['q1', 'q2'],
        groundingChunks: chunks.map((u) => ({ web: { uri: u, title: new URL(u).hostname } })),
        groundingSupports: supports.map(([t, idx]) => ({ segment: { text: t }, groundingChunkIndices: idx })),
        searchEntryPoint: { renderedContent: '<div onclick="x()">suggestions</div><script>x()</script>' },
      },
    },
  ],
  usageMetadata: { promptTokenCount: 100, totalTokenCount: 300 },
});

const writerJson = (refs: string) => ({
  candidates: [
    {
      content: {
        parts: [
          {
            text: JSON.stringify({
              headline: `Info session with Streamly ${refs}`,
              event: { title: 'Info session', when: 'Dec 3', where: '', format: 'Panel', topic: 'Ads' },
              angle: 'Streamly is your top company.',
              angleBullets: [],
              people: [{ name: 'Jordan Lee', roleNow: 'Head of Ads [1]', affiliation: '', summary: 'Leads ads.', timeline: [{ years: '2024–now', company: 'Streamly', role: 'Head of Ads' }], education: '', highlights: ['Spoke at AdWeek [2] [9]'], whyItMatters: 'Ads PM.', caveat: '' }],
              peopleNote: '',
              companies: [{ name: 'Streamly', summary: 'Streaming.', businessLines: [{ name: 'Ads', what: 'Ad tier', keyFact: '$1B [2]' }], modelInsight: 'Investing in ads; cutting games.', watchOut: '' }],
              financials: { company: 'Streamly', period: 'Q3 2026', takeaway: 'Strong quarter [1].', metrics: [{ metric: 'Revenue', value: '$5B [1]', change: '+10%' }], highlights: [] },
              companyNews: { lead: '', items: [{ date: 'Nov 1', headline: 'Launched X [2]', whyItMatters: 'Ads.' }] },
              industryNews: { lead: '', items: [] },
              questionThemes: [{ theme: 'Ads', context: 'Ads grew [1].', questions: ['How do you price ads? [1]', 'What would you build next?'] }],
              verify: ['Room not in the invitation.'],
            }),
          },
        ],
      },
    },
  ],
  usageMetadata: { promptTokenCount: 1000, totalTokenCount: 4000 },
});

describe('Research agent (server)', () => {
  it('plans light people checks and deep company research, skipping "people" that are teams or companies', () => {
    const p = plan({ title: 'Info session', person: 'Streamly Ads', company: 'Streamly', role: 'Advertising' }, student);
    expect(p.people).toEqual([]);
    expect(p.shape).toBe('company');
    expect(p.tasks.map((t: { kind: string }) => t.kind)).toEqual(['company', 'news', 'trends', 'competition']);
    // With a lens (the event's business area), the main company also gets a deep dive on that area.
    const withLens = plan({ title: 'Info session', company: 'Streamly', role: 'Advertising' }, student, { focusArea: "Streamly's ads business", industry: 'CTV advertising', competitors: ['Vidco'] });
    expect(withLens.tasks.map((t: { kind: string }) => t.kind)).toEqual(['company', 'area', 'news', 'trends', 'competition']);
  });

  it('keeps at most 4 people and 4 companies, the most relevant to the profile first', () => {
    const p = plan(
      {
        title: 'Panel',
        person: 'Ana Ruiz, Ben Cho, Carla Diaz, Dan Ito, Eva Lee',
        attendees: 'Ana Ruiz · PM, Acme; Ben Cho · Strategy, Streamly; Carla Diaz · CTO, Moveo; Dan Ito · Engineer, Bankco; Eva Lee · Ads, Payco',
      },
      student,
    );
    expect(p.shape).toBe('panel');
    expect(p.people).toHaveLength(4);
    expect(p.people.map((x: { name: string }) => x.name)).not.toContain('Dan Ito');
    const deep = p.tasks.filter((t: { kind: string; deep?: boolean }) => t.kind === 'company' && t.deep).map((t: { company: string }) => t.company);
    expect(deep.sort()).toEqual(['Payco', 'Streamly']);
    expect(p.tasks.filter((t: { kind: string }) => t.kind === 'news').map((t: { company: string }) => t.company).sort()).toEqual(['Payco', 'Streamly']);
  });

  it('numbers sources across research tasks and puts them next to each bullet', () => {
    const registry = { sources: [] as Array<{ uri: string; title: string }>, queries: [] as string[], suggestionsHtml: '' };
    const a = notesFromGrounded(grounded('## News\n- Streamly launched X in Nov 2026', ['https://a.com/1'], [['Streamly launched X in Nov 2026', [0]]]), registry);
    const b = notesFromGrounded(grounded('- Revenue grew 10% in Q3 2026', ['https://a.com/1', 'https://b.com/2'], [['Revenue grew 10% in Q3 2026', [1]]]), registry);
    expect(a.notes).toContain('Streamly launched X in Nov 2026 [1]');
    expect(b.notes).toContain('Revenue grew 10% in Q3 2026 [2]');
    expect(registry.sources.map((s) => s.uri)).toEqual(['https://a.com/1', 'https://b.com/2']);
    expect(registry.suggestionsHtml).not.toMatch(/onclick|<script/);
  });

  it('removes source numbers that do not exist and keeps questions clean', () => {
    const { brief } = parseWriter(writerJson('[1]'), 2);
    expect(brief.version).toBe(3);
    expect(brief.people[0].highlights[0]).toBe('Spoke at AdWeek [2]');
    expect(brief.questionThemes[0].questions[0]).toBe('How do you price ads?');
  });

  it('runs: research in parallel, ignores answers without a real search, writes with the profile and numbered notes', async () => {
    const calls: Array<{ model: string; body: { tools?: unknown; contents: Array<{ parts: Array<{ text?: string }> }> } }> = [];
    const call = vi.fn(async (body, model) => {
      calls.push({ model, body });
      if (body.generationConfig?.responseSchema?.properties?.focusArea)
        return { ok: true, status: 200, data: { candidates: [{ content: { parts: [{ text: JSON.stringify({ focusArea: "Streamly's ads business", industry: 'CTV advertising', competitors: ['Vidco'] }) }] } }] } };
      if (!body.tools) return { ok: true, status: 200, data: writerJson('[1]') };
      const prompt = body.contents[0].parts[0].text as string;
      if (prompt.includes('big shifts')) return { ok: true, status: 200, data: { candidates: [{ content: { parts: [{ text: '- from memory' }] } }] } };
      return { ok: true, status: 200, data: grounded('- Streamly revenue $5B in Q3 2026', ['https://a.com/1']) };
    });
    const out = await runAgent({ title: 'Info session', company: 'Streamly', person: 'Jordan Lee', role: 'Head of Ads' }, { student, language: 'es', call });
    const writer = calls.filter((c) => !c.body.tools).at(-1)!;
    // person, company, area, news, competition + trends twice (its first answer had no sources, so it is retried once)
    expect(calls.filter((c) => c.body.tools).length).toBe(7);
    const text = writer.body.contents[0].parts.map((p) => p.text ?? '').join('');
    expect(text).toContain('Priority companies: Streamly, Payco');
    expect(text).toContain('Streamly revenue $5B in Q3 2026');
    expect(text).toContain("Focus area of this event: Streamly's ads business");
    expect(text).not.toContain('from memory');
    expect(out.brief.language).toBe('es');
    expect(out.brief.web.sources).toHaveLength(1);
    expect(writerRequest({ title: 'x' }, student, '', 'company', 'es').systemInstruction.parts[0].text).toMatch(/Spanish/);
  });

  it('a talk with no company and no person becomes a topic brief (no company research)', () => {
    const p = plan({ title: 'AI in healthcare: careers panel', topic: 'AI in healthcare' }, student, { focusArea: 'AI in healthcare', industry: 'Healthcare AI', competitors: [] });
    expect(p.shape).toBe('topic');
    expect(p.tasks.map((t: { kind: string }) => t.kind)).toEqual(['trends', 'landscape']);
  });

  it('removes repeated facts across sections', () => {
    expect(sameFact('Streamly cuts its 2026 ads target to $2.7B [3]', 'Streamly cut its 2026 ads revenue target to $2.7B')).toBe(true);
    expect(sameFact('Streamly launched a new app', 'Payco raised $50M')).toBe(false);
    const b = {
      bigPicture: { company: ['Streamly cut its 2026 ads revenue target to $2.7B', 'Growth is strong but ads lag the plan'], industry: [], competition: [], challenges: [] },
      companyNews: { lead: '', items: [{ date: 'Oct 20', headline: 'Streamly cuts its 2026 ads revenue target to $2.7B [3]', whyItMatters: '' }, { date: 'Oct 21', headline: 'Streamly cuts 2026 ads revenue target to $2.7B', whyItMatters: '' }] },
      industryNews: { lead: '', items: [{ date: 'Oct', headline: 'Streamly cuts its 2026 ads revenue target to $2.7B', whyItMatters: '' }, { date: 'Sep', headline: 'Streaming passes linear TV in upfront dollars', whyItMatters: '' }] },
      financials: { company: '', period: '', takeaway: '', metrics: [], highlights: [] },
      people: [],
    };
    dedupeBrief(b);
    expect(b.companyNews.items).toHaveLength(1);
    expect(b.industryNews.items.map((n) => n.headline)).toEqual(['Streaming passes linear TV in upfront dollars']);
    expect(b.bigPicture.company).toEqual(['Growth is strong but ads lag the plan']);
  });

  it('searches like a research assistant: short searches, primary sources, dates checked', () => {
    const text = researchRequest('Research Streamly.').contents[0].parts[0].text;
    expect(text).toMatch(/short searches/);
    expect(text).toMatch(/primary sources/);
    expect(text).toMatch(/job postings/);
  });

  it('orders news most recent first, undated last', () => {
    expect(newestFirst([{ date: 'Aug 2026' }, { date: 'October 20, 2026' }, { date: 'no date' }, { date: '2026-11-02' }]).map((x) => x.date)).toEqual(['2026-11-02', 'October 20, 2026', 'Aug 2026', 'no date']);
  });

  it('prices only searches beyond the free monthly searches', () => {
    expect(agentCostUsd({ inputTokens: 1_000_000, outputTokens: 0, searches: 10 }, 0)).toBeCloseTo(0.75, 5);
    expect(agentCostUsd({ inputTokens: 0, outputTokens: 0, searches: 10 }, 10)).toBeCloseTo(0.14, 5);
  });
});

describe('Research agent brief (in the app)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the angle, career table, results table, news with why it matters, question context and clickable sources', async () => {
    const { brief } = parseWriter(writerJson('[1]'), 2);
    const b = { ...brief, web: { sources: [{ uri: 'https://a.com/1', title: 'a.com' }, { uri: 'https://b.com/2', title: 'b.com' }], queries: ['q'], suggestionsHtml: '' } };
    const start = new Date(Date.now() + 26 * 3600_000).toISOString();
    const state = {
      ...onboardedAccountState(),
      userEvents: [{ id: 'u1', source: 'manual', title: 'Streamly info session', start, end: start, company: 'Streamly', person: 'Jordan Lee', role: 'Head of Ads', notes: '', location: '' }],
      aiBriefs: { u1: { id: 'r', event: { title: 'Streamly info session', datetime: '', company: 'Streamly', person: 'Jordan Lee', role: '', notes: '' }, brief: b, usage: { inputTokens: 1, outputTokens: 1, searches: 3 }, costUsd: 0.03, model: 'gemini-3.8-flash', generatedAt: start } },
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
    expect(await screen.findByText(/Streamly is your top company/)).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Years' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /vs\. a year before/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Why it matters today' })).toBeInTheDocument();
    expect(screen.getByText(/Ads grew/)).toBeInTheDocument();
    // Each number opens a small pop-up with the source and a link (new tab); no long source list on screen.
    const cite = screen.getAllByRole('button', { name: 'Source 1: a.com' })[0];
    expect(cite.closest('.ph-no-capture')).not.toBeNull();
    await userEvent.setup().click(cite);
    const pop = screen.getByRole('dialog', { name: 'Source 1' });
    expect(within(pop).getByRole('link', { name: /Open source/ })).toHaveAttribute('href', 'https://a.com/1');
    expect(within(pop).getByRole('link', { name: /Open source/ })).toHaveAttribute('target', '_blank');
    expect(document.querySelector('ol.research-sources')).toHaveClass('print-only');
    expect(screen.getByText('How do you price ads?')).toBeInTheDocument();
  });
});

describe('Citations above 99', () => {
  it('a brief with 100+ sources shows [105] as a clickable source, not plain text', async () => {
    const { render, screen } = await import('@testing-library/react');
    const { Cited } = await import('../components/brief/AiBriefV3');
    const sources = Array.from({ length: 120 }, (_, i) => ({ title: `site${i + 1}.com`, uri: `https://example.com/${i + 1}` }));
    render(<Cited text="Ads grew [7][105]." web={{ sources, queries: [], suggestionsHtml: '' } as never} />);
    expect(screen.getByRole('button', { name: /105/ })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('[105]');
  });
});
