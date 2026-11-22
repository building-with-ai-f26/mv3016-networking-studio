// Web facts for the AI brief: one Gemini call with Grounding with Google Search, run in parallel with the brief.
// Why a separate call, in plain bullets: tested 2026-11-22 with gemini-3.5-flash-lite, Google only returns the sources
// (groundingMetadata) for natural-language answers. Asking for JSON or "A | B | C" lines gives no sources at all.
// With headings + bullets it searches and Google's "grounding supports" say which source backs each bullet.
// Google's terms (aistudio.google.com/docs/terms#grounding-with-google-search): the facts are shown as returned, with
// their sources and Google's Search Suggestions; clicks on them are not tracked (the UI marks them ph-no-capture).
// Privacy: only the event title, company, person name/role and topic are searched. Never emails, links or notes.

/** Conservative cost per Google search: $14 per 1,000 after the monthly free 5,000. */
export const SEARCH_PRICE_USD = 0.014;

const clean = (v, max) =>
  String(v ?? '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, ' ')
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .trim()
    .slice(0, max);

/** True when there is something to search for. */
export const canResearch = (event) => Boolean(clean(event.company, 120) || clean(event.person, 120));

export function buildFactsRequest(event) {
  const company = clean(event.company, 120);
  const person = clean(event.person, 120);
  const role = clean(event.role, 120);
  const topic = clean(event.topic, 300);
  const title = clean(event.title, 200);
  const subject = [company && `Company: ${company}`, person && `Person: ${person}${role ? ` (${role})` : ''}`, title && `Event: ${title}`, topic && `Topic: ${topic}`].filter(Boolean).join('\n');
  const text = `A business-school student is preparing for a networking event.
${subject}

Search the web${company ? ` for ${company}'s latest reported quarterly or annual results and ${company}'s news from the last 3 months` : ''}${person ? `${company ? ', and' : ''} for ${person}'s public professional background` : ''}.
Write the answer under these headings, one fact per bullet ("- "), each with its date:
Financials
- <one financial fact with its figure> (<period, e.g. Q3 2026>)
News
- <headline> (<date>): <why it matters for a networking conversation, max 20 words>
${person ? 'People\n- <name>: <public professional information: current role, past roles, talks or articles>\n' : ''}Give 2-4 Financials bullets and 2-4 News bullets${person ? ' and 1-3 People bullets' : ''}. Only facts from the search results. Never personal details (family, address, health, contact details). If nothing reliable is found for a heading, write "- Not found".`;
  return {
    contents: [{ role: 'user', parts: [{ text }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1500, thinkingConfig: { thinkingLevel: 'minimal' } },
  };
}

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'its', 'was', 'are']);
const words = (t) =>
  new Set(
    String(t ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9%$.]+/g, ' ')
      .split(' ')
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
/** True when two texts share most of their words (Google's segments can be a line or part of one). */
function overlaps(a, b) {
  const x = words(a);
  const y = words(b);
  if (x.size < 2 || y.size < 2) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / Math.min(x.size, y.size) >= 0.6;
}

/** Reads the grounded answer: facts by type, each with the numbers of the sources that back it. */
export function parseFacts(data) {
  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => (typeof p.text === 'string' ? p.text : '')).join('');
  const gm = cand?.groundingMetadata ?? {};
  const sources = [];
  const chunkToSource = new Map();
  (gm.groundingChunks ?? []).forEach((c, i) => {
    const uri = String(c?.web?.uri ?? '');
    if (!/^https:\/\//.test(uri)) return;
    let k = sources.findIndex((x) => x.uri === uri);
    if (k < 0 && sources.length < 15) {
      sources.push({ uri, title: String(c?.web?.title ?? '').slice(0, 200) });
      k = sources.length - 1;
    }
    if (k >= 0) chunkToSource.set(i, k);
  });
  const supports = (gm.groundingSupports ?? []).map((s) => ({
    text: String(s?.segment?.text ?? ''),
    refs: [...new Set((s?.groundingChunkIndices ?? []).map((i) => chunkToSource.get(i)).filter((k) => k !== undefined))],
  }));
  const refsFor = (line) => {
    const refs = new Set();
    for (const s of supports) if (s.refs.length && (line.includes(s.text.trim()) || overlaps(line, s.text))) s.refs.forEach((r) => refs.add(r));
    return [...refs].sort((a, b) => a - b).slice(0, 4);
  };
  const financialHighlights = [];
  const companyNews = [];
  const peopleWeb = [];
  let section = '';
  for (const raw of text.split('\n')) {
    const plain = raw.replace(/\*\*/g, '').replace(/^#+\s*/, '').trim();
    const heading = plain.replace(/:$/, '').toLowerCase();
    if (/^(financials?|financial results)$/.test(heading)) section = 'fin';
    else if (/^(news|company news|recent news)$/.test(heading)) section = 'news';
    else if (/^(people|person|about the person)$/.test(heading)) section = 'people';
    if (!/^[-*•]\s+/.test(plain) || !section) continue;
    const line = plain.replace(/^[-*•]\s+/, '').trim();
    if (!line || /^not found/i.test(line)) continue;
    const refs = refsFor(line);
    // "<text> (<date>)" or "<text> (<date>): <why>"
    const m = line.match(/^(.*?)\s*\(([^()]*\d{4}[^()]*)\)\s*[:\u2014-]?\s*(.*)$/);
    if (m) m[3] = /^[\s.,;:]*$/.test(m[3]) ? '' : m[3];
    const tidy = (t) => t.replace(/\s+([.,;:])/g, '$1').trim();
    if (section === 'fin') financialHighlights.push({ fact: tidy(m ? `${m[1]}${m[3] ? ` ${m[3]}` : ''}` : line).slice(0, 400), period: (m?.[2] ?? '').slice(0, 80), source: '', refs });
    else if (section === 'news') companyNews.push({ headline: tidy(m ? m[1] : line).slice(0, 300), date: (m?.[2] ?? '').slice(0, 80), source: '', whyItMatters: (m?.[3] ?? '').slice(0, 300), refs });
    else {
      const k = line.indexOf(':');
      if (k > 0) peopleWeb.push({ name: line.slice(0, k).trim().slice(0, 120), info: line.slice(k + 1).trim().slice(0, 500), refs });
    }
  }
  const queries = (gm.webSearchQueries ?? []).filter((q) => typeof q === 'string' && q.trim()).slice(0, 20);
  const u = data?.usageMetadata ?? {};
  const usage = { inputTokens: u.promptTokenCount ?? 0, outputTokens: Math.max((u.totalTokenCount ?? 0) - (u.promptTokenCount ?? 0), (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0)), searches: queries.length };
  const searched = sources.length > 0;
  return {
    // Safety: facts are only kept when they come from a real search with sources.
    financialHighlights: searched ? financialHighlights.slice(0, 6) : [],
    companyNews: searched ? companyNews.slice(0, 6) : [],
    peopleWeb: searched ? peopleWeb.slice(0, 5) : [],
    web: searched ? { sources, queries, suggestionsHtml: sanitizeSuggestions(String(gm.searchEntryPoint?.renderedContent ?? '')) } : null,
    usage,
  };
}

/**
 * Google's Search Suggestions come as HTML+CSS. Shown as is, but defensively stripped of anything executable
 * (scripts, event handlers, javascript: links, frames, forms). The page's CSP also blocks inline scripts.
 */
export function sanitizeSuggestions(html) {
  return String(html)
    .slice(0, 30_000)
    .replace(/<\s*(script|iframe|object|embed|form|link|meta|base)\b[\s\S]*?(<\s*\/\s*\1\s*>|\/?>)/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
}
