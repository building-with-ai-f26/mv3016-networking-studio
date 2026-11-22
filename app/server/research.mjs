// "Latest public info": one Gemini call with Grounding with Google Search, run only when the user clicks.
// Google's terms for grounded results (aistudio.google.com/docs/terms#grounding-with-google-search), which shape the design:
// - show the grounded text with its Search Suggestions to the user who asked, without modifying it or mixing other content in;
// - don't track clicks on the links or suggestions (the UI section is excluded from analytics);
// - don't reuse grounded text to train or feed other AI steps (it is NOT passed into the brief or the chat).
// Privacy: only the company, the person's name/role and the topic are searched. Never emails, links or notes.

const LIMITS = { title: 200, company: 120, person: 120, role: 120, topic: 300, datetime: 200 };
/** Conservative cost per Google search: billed at $14 per 1,000 after the monthly free 5,000. */
export const SEARCH_PRICE_USD = 0.014;

export function validateResearchInput(body) {
  if (!body || typeof body !== 'object') return { error: 'Invalid request.' };
  const input = {};
  for (const [k, max] of Object.entries(LIMITS)) {
    const v = body[k];
    if (v !== undefined && v !== null && typeof v !== 'string') return { error: `${k} must be text.` };
    // Defense in depth: no emails or links ever go to the search.
    input[k] = String(v ?? '')
      .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, ' ')
      .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
      .trim()
      .slice(0, max);
  }
  if (!input.company && !input.person) return { error: 'Add the company or the person first, so there is something to search.' };
  return { input };
}

export function buildResearchRequest(input) {
  const who = [input.person && `Person: ${input.person}${input.role ? ` (${input.role})` : ''}`, input.company && `Company: ${input.company}`, input.topic && `Event topic: ${input.topic}`, input.title && `Event: ${input.title}`]
    .filter(Boolean)
    .join('\n');
  const text = `A business-school student is preparing for a networking event and needs current public information.
${who}

Search the web and write a short update (max 220 words) with exactly these headings, each followed by 2-4 bullet points starting with "- ":
Company news (last 12 months)
Financials (latest reported, with the period or date)
${input.person ? 'About the person (public professional info only)' : 'People and leadership (public professional info only)'}

Rules: only facts supported by reputable sources found in the search; include dates; no guesses. If nothing reliable is found for a heading, write "- Not found in public sources." For people, only professional information (current role, career, public talks or articles). Never personal details (family, address, health, contact details).`;
  return {
    contents: [{ role: 'user', parts: [{ text }] }],
    tools: [{ google_search: {} }],
    generationConfig: { maxOutputTokens: 900, thinkingConfig: { thinkingLevel: 'minimal' } },
  };
}

/** Keeps the grounded text exactly as returned, plus sources, the queries run and Google's Search Suggestions HTML. */
export function parseResearchResponse(data) {
  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts ?? [])
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim();
  if (!text) throw new Error('The web search returned no answer. Try again.');
  const gm = cand.groundingMetadata ?? {};
  const seen = new Set();
  const sources = (gm.groundingChunks ?? [])
    .map((c) => ({ uri: String(c?.web?.uri ?? ''), title: String(c?.web?.title ?? '').slice(0, 200) }))
    .filter((s) => /^https:\/\//.test(s.uri) && !seen.has(s.uri) && seen.add(s.uri))
    .slice(0, 12);
  const queries = (gm.webSearchQueries ?? []).filter((q) => typeof q === 'string' && q.trim());
  const suggestionsHtml = sanitizeSuggestions(String(gm.searchEntryPoint?.renderedContent ?? ''));
  const u = data.usageMetadata ?? {};
  const usage = { inputTokens: u.promptTokenCount ?? 0, outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), searches: queries.length };
  return { text, sources, queries, suggestionsHtml, usage };
}

/**
 * Google's Search Suggestions come as HTML+CSS. Shown as is, but defensively stripped of anything executable
 * (scripts, event handlers, javascript: links, frames, forms). The page's CSP also blocks inline scripts.
 */
export function sanitizeSuggestions(html) {
  return html
    .slice(0, 30_000)
    .replace(/<\s*(script|iframe|object|embed|form|link|meta|base)\b[\s\S]*?(<\s*\/\s*\1\s*>|\/?>)/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
}

export function researchCostUsd(usage, prices) {
  return (usage.inputTokens / 1e6) * prices.inputPerMillion + (usage.outputTokens / 1e6) * prices.outputPerMillion + usage.searches * SEARCH_PRICE_USD;
}
