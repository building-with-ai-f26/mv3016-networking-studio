// Research agent for the AI brief (version 3): plan → research with Google Search (in parallel) → write.
// Goal: the depth of a brief a student would get from a strong research assistant: the person's career in detail,
// how the company makes money, the latest results in a table, recent company and industry news with "why it matters
// today", and specific questions in conversation order, each with plain-language context.
//
// 1) plan():      decides what to research from the event (one person / panel / company only).
// 2) research():  one Google Search call per task, in parallel (gemini-3.8-flash, natural-language bullets: that is the
//                 format for which Google returns sources). Each bullet gets the numbers [n] of the sources behind it.
// 3) write():     a larger call that writes the structured brief from the event, the student's goals and the
//                 numbered research notes, keeping [n] next to every researched fact.
// Privacy: only names, roles, companies, the event title and topic are searched. Never emails, links or notes.

import { SEARCH_PRICE_USD, sanitizeSuggestions } from './research.mjs';

export const RESEARCH_MODEL = process.env.GEMINI_RESEARCH_MODEL || 'gemini-3.8-flash';
export const WRITER_MODEL = process.env.GEMINI_WRITER_MODEL || 'gemini-3.8-flash';
/** Small, fast model for the lens (no web search). */
export const LENS_MODEL = process.env.GEMINI_LENS_MODEL || 'gemini-3.5-flash-lite';
/** Paid-tier prices per 1M tokens for the agent models (gemini-3.8-flash until Dec 31, 2026). */
export const AGENT_PRICES = {
  inputPerMillion: Number(process.env.AGENT_PRICE_INPUT_PER_M || 0.75),
  outputPerMillion: Number(process.env.AGENT_PRICE_OUTPUT_PER_M || 3.75),
};

const clean = (v, max = 200) =>
  String(v ?? '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, ' ')
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const splitList = (s) =>
  clean(s, 400)
    .split(/\s*(?:,|;|&| and | y |\/)\s*/i)
    .map((x) => x.trim())
    .filter((x) => x.length > 1);

const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- 1) plan

export const MAX_PEOPLE = 4;
export const MAX_COMPANIES = 4;

/** How relevant an entity is to the student: priority companies first, then target industries and roles. */
export function relevance(text, student) {
  const t = String(text ?? '').toLowerCase();
  if (!t) return 0;
  let score = 0;
  (student?.companies ?? []).forEach((c, i) => {
    if (c && t.includes(String(c).toLowerCase())) score += 100 - i * 5;
  });
  (student?.industries ?? []).forEach((x, i) => {
    if (x && t.includes(String(x).toLowerCase())) score += 20 - i;
  });
  (student?.roles ?? []).forEach((x, i) => {
    if (x && t.includes(String(x).toLowerCase())) score += 10 - i;
  });
  return score;
}

/** Keeps at most `max` items, the most relevant to the student first (ties keep the event's order). */
export function prioritize(items, max, keyOf, student) {
  return items
    .map((x, i) => ({ x, i, score: relevance(keyOf(x), student) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map((e) => e.x);
}

/**
 * What to research. Deterministic (fast, free). Focus: the companies, their news and the industry.
 * People get a light check (career path and interests). Up to 4 people and 4 companies; with more, the ones most
 * relevant to the student's profile are kept.
 */
export function plan(event, student, lens = null) {
  // People: "Name", or "Name · role, company" lines from the AI reading of the event (attendees).
  const fromAttendees = String(event.attendees ?? '')
    .split(';')
    .map((x) => x.trim())
    .filter((x) => x.includes(' · '))
    .map((x) => {
      const [name, rest = ''] = x.split(' · ');
      const parts = rest.split(',').map((p) => p.trim());
      return { name: clean(name, 120), role: clean(parts.length > 1 ? parts.slice(0, -1).join(', ') : '', 120), company: clean(parts.length > 1 ? parts.at(-1) : parts[0], 120) };
    });
  const companyWords = splitList(event.company).map((c) => c.toLowerCase());
  // A real person's name: 2-4 words, no team/company words (the app may guess "Netflix Ads" as a person).
  const looksLikePerson = (n) =>
    /^[\p{L}'’.-]+(\s+[\p{L}'’.-]+){1,3}$/u.test(n) && !/\b(team|ads|careers?|recruiting|club|office|group|inc|llc|corp|company|association|society|panel)\b/i.test(n) && !companyWords.some((c) => c && n.toLowerCase().includes(c));
  const named = splitList(event.person)
    .filter(looksLikePerson)
    .map((name) => ({ name, role: '', company: '' }));
  const byName = new Map();
  for (const p of [...named, ...fromAttendees]) {
    const k = p.name.toLowerCase();
    if (!p.name || /\.(edu|com|org)$/i.test(p.name) || !looksLikePerson(p.name)) continue;
    const prev = byName.get(k);
    byName.set(k, { name: p.name, role: prev?.role || p.role, company: prev?.company || p.company });
  }
  let people = [...byName.values()].filter((p) => named.length === 0 || named.some((n) => n.name.toLowerCase() === p.name.toLowerCase()));
  if (named.length === 1 && people[0] && !people[0].role) people[0].role = clean(event.role, 120);
  people = prioritize(people, MAX_PEOPLE, (p) => `${p.company} ${p.role}`, student);

  const companyNames = [...splitList(event.company), ...people.map((p) => p.company).filter(Boolean)];
  const seen = new Set();
  let companies = companyNames.filter((c) => !seen.has(c.toLowerCase()) && seen.add(c.toLowerCase()));
  companies = prioritize(companies, MAX_COMPANIES, (c) => c, student);

  const role = clean(event.role, 120);
  const topic = clean(event.topic || event.title, 300);
  // The lens (from lensRequest, when available): the business area the event is about, its industry and competitors.
  const area = clean(lens?.focusArea, 160);
  const industry = clean(lens?.industry, 160);
  const competitors = (Array.isArray(lens?.competitors) ? lens.competitors : []).map((c) => clean(c, 60)).filter(Boolean).slice(0, 5);
  const tasks = [];
  for (const p of people) tasks.push({ kind: 'person', name: p.name, company: p.company || (people.length === 1 ? companies[0] ?? '' : ''), role: p.role });
  // The two companies most relevant to the student get the deep research and a news search; the rest a short overview.
  const focus = prioritize(companies, 2, (c) => c, student);
  companies.forEach((c) => tasks.push({ kind: 'company', company: c, deep: focus.includes(c) }));
  if (area && focus[0]) tasks.push({ kind: 'area', company: focus[0], area });
  focus.forEach((c) => tasks.push({ kind: 'news', company: c, area: area || role || topic }));
  tasks.push({ kind: 'trends', companies, industry, area: area || role || topic, topic });
  if (companies.length) tasks.push({ kind: 'competition', company: focus[0] ?? companies[0], competitors, area: area || industry });
  // A talk about a topic (no company): map the field instead (key players, startups, money, roles for MBAs).
  else tasks.push({ kind: 'landscape', area: area || industry || topic, competitors, topic });
  const shape = people.length > 1 ? 'panel' : people.length === 1 ? 'person' : companies.length ? 'company' : 'topic';
  return { shape, people, companies, area, industry, competitors, tasks };
}

/**
 * The lens: one fast call (no web search) that reads the event and says which business area it is really about
 * (e.g. "Netflix's advertising business" for an ads talk), the industry and the main competitors in that area.
 */
export function lensRequest(event, student) {
  const text = `Event: ${clean(event.title, 200)}
Company: ${clean(event.company, 200) || 'not given'}
People: ${clean(event.person, 300) || 'not named'}${event.role ? ` (${clean(event.role, 200)})` : ''}
Topic: ${clean(event.topic, 300) || 'not given'}
Description: ${clean(event.description, 1200) || 'none'}
Student targets: ${[student?.roles?.join(', '), student?.industries?.join(', ')].filter(Boolean).join(' · ') || 'not given'}

Which specific business area of the main company is this event about (the speaker's area or the topic), e.g. "Netflix's advertising business", "Siemens' industrial AI software"? If it is general, use the company's core business. Name the industry of that area (e.g. "streaming TV advertising (CTV)") and up to 5 main competitors in that area.`;
  return {
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 400,
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { focusArea: { type: 'STRING' }, industry: { type: 'STRING' }, competitors: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['focusArea', 'industry', 'competitors'] },
      thinkingConfig: { thinkingLevel: 'minimal' },
    },
  };
}

export function parseLens(data) {
  try {
    const t = (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    const j = JSON.parse(t);
    return { focusArea: clean(j.focusArea, 160), industry: clean(j.industry, 160), competitors: (Array.isArray(j.competitors) ? j.competitors : []).map((c) => clean(c, 60)).filter(Boolean).slice(0, 5) };
  } catch {
    return null;
  }
}

export function taskPrompt(t, student) {
  const hook = clean(student?.background, 300);
  const goals = [student?.roles?.slice(0, 3).join(', '), student?.industries?.slice(0, 3).join(', ')].filter(Boolean).join(' in ');
  const date = `Today is ${today()}.`;
  switch (t.kind) {
    case 'person':
      // Light check on purpose: the student wants a general idea of the person, the focus is the company.
      return `${date} Quick professional check on ${t.name}${t.role ? `, ${t.role}` : ''}${t.company ? ` (${t.company})` : ''}. Keep it short.
Write under the heading "Profile", one fact per bullet ("- "):
- what they do today (role, team)
- career path: one bullet per main role, "YYYY–YYYY · company · role" (most recent first, max 6)
- education (school and degree)
- topics they care about or speak/write about publicly, if any (with dates)
If several people share this name, say so. Only professional information: never family, address, health or contact details. If nothing reliable is found, write "- Not found".`;
    case 'company':
      return `${date} Research ${t.company}.
Write under the headings "Business", "Bets" and "Latest results", one fact per bullet ("- "), with numbers and dates:
Business: what it does and how it makes money (main business lines, each with one key figure)${t.deep ? '; any name confusion to avoid (similar companies, spin-offs)' : ''}.
Bets: where it is investing now (new products, markets, technology, capex, hiring), what it is pulling back from or stopping (cuts, exits, divestments, layoffs, cancelled products), and recent acquisitions or partnerships.${t.deep ? `
Hiring: what the company's own job postings say about the teams and roles an MBA would join (titles, what they own, what they look for).` : ''}
Latest results: ${t.deep ? 'ONLY the most recent reported quarter or fiscal year (say which one and when it was published): revenue, growth vs the same period a year before, operating income or margin, net income, EPS vs consensus, free cash flow, guidance, how the stock reacted, and the highlights the company stressed. Never mix periods; if sources disagree, say so' : 'the latest revenue and growth, with the period'}. If it is private: funding, valuation, traction, customers, team size.`;
    case 'area':
      return `${date} Deep dive on ${t.area} (at ${t.company}). Find, with numbers and dates:
- size and growth (revenue, users, customers), the targets the company set and whether it is meeting them
- how it works and how it makes money: products or formats, pricing (e.g. price per unit, CPM), how it is sold, channels and partners
- the technology and data it relies on, and what it is building next
- leadership of this area and team changes
- the main challenges and open questions analysts raise
Write under the heading "Area", one fact per bullet ("- ").`;
    case 'news':
      return `${date} Find the 8-10 most important news about ${t.company} from the last 3 months${t.area ? ` (especially about ${t.area})` : ''}. Cover each type that applies: results and how the stock or valuation reacted; layoffs or restructuring; leadership changes; partnerships and deals (also regional ones, e.g. in Latin America or Europe); product launches; acquisitions or divestments; targets raised or cut; regulation or lawsuits.
Write under the heading "News", one bullet per news ("- "): date · what happened, with numbers · the consequence (e.g. "shares fell 6%", "target cut from $3.0B to $2.7B, still growing 80%").${hook ? `
Also search for anything (any date in the last 3 years) that connects ${t.company} with the student's background for a personal hook: ${hook}. E.g. a pilot, launch, partnership or office in that country or region. Put it under the heading "Personal hook".` : ''}`;
    case 'landscape':
      return `${date} Map the field of ${t.area}${t.topic ? ` (event topic: ${t.topic})` : ''}: the key companies (incumbents and fast-growing startups, with what each does and one number: revenue, funding or users), where the money is going (recent funding rounds, acquisitions, partnerships in the last 6-12 months), and which roles companies in this field hire MBAs for (titles, what they do), with examples.
Write under the heading "Landscape", one fact per bullet ("- "), with dates and numbers.`;
    case 'competition':
      return `${date} How is the competition moving in ${t.area || 'this market'}${t.company ? ` against ${t.company}` : ''}? ${t.competitors?.length ? `Look at ${t.competitors.join(', ')} and any other key player. ` : ''}Find 5-8 recent moves (last 6 months): launches, pricing, partnerships, data advantages, mergers, market share, with numbers.
Write under the heading "Competition", one bullet per item ("- "): date · who · what they did · why it matters for ${t.company || 'the company'}.`;
    default:
      return `${date} What are the big shifts in ${t.industry || t.area || 'the industry of ' + (t.companies?.join(', ') || 'this event')} in the last 6-12 months? Find 6-8 trends with hard data from research firms, trade press or industry bodies (e.g. Media Dynamics, eMarketer, Gartner, IDC, McKinsey): where budgets or demand are moving, what buyers or customers now ask for, technology changes, regulation, consolidation, and hiring trends for MBAs${t.topic ? ` (event topic: ${t.topic})` : ''}.
Write under the heading "Industry", one bullet per item ("- "): date · the shift, with numbers · source organization · what it changes.`;
  }
}

// ---------------------------------------------------------------- 2) research

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'its', 'was', 'are', 'has', 'have']);
const words = (t) =>
  new Set(
    String(t ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9%$€.]+/g, ' ')
      .split(' ')
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
function overlaps(a, b) {
  const x = words(a);
  const y = words(b);
  if (x.size < 2 || y.size < 2) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / Math.min(x.size, y.size) >= 0.6;
}

/**
 * Turns one grounded answer into note lines with global source numbers, e.g. "- Revenue rose 12% (Q3 2026) [3][5]".
 * `registry` collects the sources of every task (deduplicated by URL) so numbers are unique across the brief.
 */
export function notesFromGrounded(data, registry) {
  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => (typeof p.text === 'string' ? p.text : '')).join('');
  const gm = cand?.groundingMetadata ?? {};
  const local = new Map(); // chunk index -> global source number (1-based)
  (gm.groundingChunks ?? []).forEach((c, i) => {
    const uri = String(c?.web?.uri ?? '');
    if (!/^https:\/\//.test(uri)) return;
    let k = registry.sources.findIndex((s) => s.uri === uri);
    if (k < 0) {
      if (registry.sources.length >= 120) return;
      registry.sources.push({ uri, title: String(c?.web?.title ?? '').slice(0, 200) });
      k = registry.sources.length - 1;
    }
    local.set(i, k + 1);
  });
  for (const q of gm.webSearchQueries ?? []) if (typeof q === 'string' && q.trim()) registry.queries.push(q.trim());
  if (!registry.suggestionsHtml && gm.searchEntryPoint?.renderedContent) registry.suggestionsHtml = sanitizeSuggestions(gm.searchEntryPoint.renderedContent);
  const supports = (gm.groundingSupports ?? []).map((s) => ({
    text: String(s?.segment?.text ?? ''),
    refs: [...new Set((s?.groundingChunkIndices ?? []).map((i) => local.get(i)).filter(Boolean))],
  }));
  const lines = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\*\*/g, '').trim();
    if (!line) continue;
    if (!/^[-*•]\s+/.test(line)) {
      lines.push(line.replace(/^#+\s*/, '## '));
      continue;
    }
    const refs = new Set();
    for (const s of supports) if (s.refs.length && (line.includes(s.text.trim()) || overlaps(line, s.text))) s.refs.forEach((r) => refs.add(r));
    const marks = [...refs].sort((a, b) => a - b).slice(0, 4).map((r) => `[${r}]`).join('');
    lines.push(`${line}${marks ? ` ${marks}` : ''}`);
  }
  const u = data?.usageMetadata ?? {};
  return {
    notes: lines.join('\n'),
    searched: (gm.groundingChunks ?? []).length > 0, // a real search ran (even if the source list is full)
    usage: { inputTokens: u.promptTokenCount ?? 0, outputTokens: Math.max((u.totalTokenCount ?? 0) - (u.promptTokenCount ?? 0), 0), searches: (gm.webSearchQueries ?? []).filter((q) => typeof q === 'string' && q.trim()).length },
  };
}

/** How to search, added to every research task (method of a strong human-like research assistant). */
export const SEARCH_METHOD = `
How to search:
- Run several short searches (2-6 words each), one topic per search; never put two companies in one search. Use the person's name in quotes for career facts.
- Prefer primary sources: the company's press releases, shareholder letters and filings, investor relations pages, and the company's own job postings (they show how a role or team works). Then reputable business and trade press. People directories only for career facts (say "secondary source"). Company marketing blogs: say the figure is self-reported. Skip forums and anonymous blogs.
- Check dates: say when each fact happened; watch for old news that looks current and deals that were announced and later cancelled.
- If sources disagree, the primary source wins; if it can't be resolved, give both versions. Watch for look-alike company or person names and say so.
- Only facts found in the search results; never fill gaps from memory.`;

export function researchRequest(prompt) {
  return {
    contents: [{ role: 'user', parts: [{ text: `${prompt}\n${SEARCH_METHOD}` }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 3000, thinkingConfig: { thinkingLevel: 'low' } },
  };
}

// ---------------------------------------------------------------- 3) write

const S = { type: 'STRING' };
const SA = { type: 'ARRAY', items: S };
const obj = (properties, required = Object.keys(properties)) => ({ type: 'OBJECT', properties, required });
const arr = (items) => ({ type: 'ARRAY', items });

export const BRIEF_V3_SCHEMA = obj({
  headline: S,
  event: obj({ title: S, when: S, where: S, format: S, topic: S }),
  angle: S,
  angleBullets: SA,
  bigPicture: obj({ company: SA, industry: SA, competition: SA, challenges: SA }),
  people: arr(
    obj(
      {
        name: S,
        roleNow: S,
        affiliation: S,
        summary: S,
        timeline: arr(obj({ years: S, company: S, role: S })),
        education: S,
        highlights: SA,
        whyItMatters: S,
        caveat: S,
      },
      ['name', 'roleNow', 'summary', 'timeline', 'highlights', 'whyItMatters'],
    ),
  ),
  peopleNote: S,
  companies: arr(
    obj(
      {
        name: S,
        summary: S,
        businessLines: arr(obj({ name: S, what: S, keyFact: S })),
        focus: obj({ area: S, summary: S, pieces: arr(obj({ name: S, what: S, keyFact: S })), logic: S }, ['area', 'summary', 'pieces', 'logic']),
        modelInsight: S,
        watchOut: S,
      },
      ['name', 'summary', 'businessLines', 'modelInsight'],
    ),
  ),
  financials: obj(
    { company: S, period: S, takeaway: S, metrics: arr(obj({ metric: S, value: S, change: S })), highlights: SA },
    ['company', 'period', 'takeaway', 'metrics', 'highlights'],
  ),
  companyNews: obj({ lead: S, items: arr(obj({ date: S, headline: S, whyItMatters: S })) }),
  industryNews: obj({ lead: S, items: arr(obj({ date: S, headline: S, whyItMatters: S })) }),
  questionThemes: arr(obj({ theme: S, context: S, questions: SA })),
  verify: SA,
}, ['headline', 'event', 'angle', 'angleBullets', 'bigPicture', 'people', 'companies', 'financials', 'companyNews', 'industryNews', 'questionThemes', 'verify']);

const LANG = { en: 'English', es: 'Spanish (Latin American, natural and simple)' };

export function writerInstruction(language = 'en') {
  return `You are a sharp research assistant who prepares a business-school student for a networking event (coffee chat, panel, info session, lunch & learn, interview).
Write the brief in ${LANG[language] ?? LANG.en}. Write every suggested question in English (the student will ask them as written).

What a great brief looks like (order: most useful at the event first, background last):
- headline: one sentence that says what this event is and why it matters to the student.
- angle ("Your angle"): the strategy for this event: connect it to the student's goals (target roles, industries, priority companies, background), say what to get out of it (e.g. ask for a coffee chat) and, in a panel, who to prioritize and why. For an interview or a 1:1, add what to bring or show (e.g. a 30-second pitch of a project). angleBullets: one bullet per speaker or option when useful, else empty.
- bigPicture: the big picture in a few seconds of reading. company = 2-4 bullets on what is happening at the company right now (its focus, big bets, what it is cutting, momentum); industry = 2-4 shifts in the industry; competition = 2-3 bullets on who competes for the same customers or budgets and their edge; challenges = 2-3 open questions or risks. One sentence each, concrete.
- people (keep it light: a general idea, not a deep profile): for each named person, what they do today, a short career path (one row per main role), education, 1-3 highlights (the pattern of the career, e.g. "changed function, not industry"; the timing, e.g. "joined when the business was one year old"; topics they care about), why this person matters to the student, and a caveat for anything uncertain ("probably…, confirm with them"; "the invitation title differs from public sources"). If little is known about the person, say so in peopleNote and lean on the company and industry. If no person is named, leave people empty and say in peopleNote that the brief focuses on the company.
- companies (the main focus): 2-3 sentence summary; 3-5 business lines with one key figure each; focus = for the main company, a deep dive on the FOCUS AREA of the event (e.g. its advertising business when the speaker works in ads): area name, 2-3 sentence summary (size, growth, share of the company, targets vs actual), 4-7 pieces (products/formats, pricing, how it is sold, partners, technology, expansion, how the team hires), each with what it is and a key figure, and logic = how this area makes money, its trade-off and the open question; leave focus empty for the other companies; modelInsight = the overall conclusion on the company (shown right after the summary, before the details): the logic of its business model, where it is investing and what it is pulling back from, and the open question; focus.logic is the conclusion for the focus area only (don't repeat modelInsight); watchOut = name confusions (spin-offs, look-alike companies) or self-reported figures, else empty.
- financials: ONLY the most recent reported quarter or fiscal year of the main company, as a table (4-7 metrics, each with the value for that period and the change vs the same period a year before). Never put two periods in one cell. Name the period with its months and publication date (e.g. "Q3 2026 (Jul–Sep), published Oct 20"). A one-sentence takeaway (including the stock reaction if known) and 2-4 highlights, especially about the person's area. If sources disagree, use the company's own release and mention the difference in verify. Private company or startup: set metrics empty and give stage, funding, valuation, traction and how it charges in takeaway, and say there are no public reports.
- companyNews: a one-sentence lead that captures the story of the last 3 months, then the 5 best items, most recent first. Pick news that meet at least two of: recent (last 3 months); about the person's area; gives the student something concrete to ask or comment; shows a change of strategy (not just activity); has a number. Include results and the stock reaction, layoffs, leadership changes, partnerships, launches and targets when they exist.
- industryNews: a one-sentence lead with the main shift, then 5 items from the last 6-12 months, most recent first, mixing trends with data (name the research firm) and competitor moves.
- "why it matters" (both news tables): one sentence that connects the news to THIS conversation, not a summary of the news. Useful patterns: "it is exactly [person]'s area"; "they went from selling X to selling Y"; "good question about…"; "shows who they sell to"; "it hits the functions you are targeting: ask tactfully how they hire today". Say consequences explicitly (e.g. "missed its ads target and shares fell 6%, yet ads still grow 80%"). For sensitive news (layoffs, a failed deal) say how to bring it up without making it awkward.
- Personal hook: when the notes have a "Personal hook" (e.g. something the company did in the student's home country), use it in angle or in one question context.
- questionThemes: in conversation order (career questions first in a career talk or 1:1; then the business). Each theme has a short context (1-3 plain-language sentences with the facts behind the question) and 1-2 questions. About 10 questions for one person; for a panel, a theme with 3 questions for the whole panel plus a theme per speaker with 2-3 questions. A great question: is anchored in a concrete fact of the brief (a number, a news item, a decision); has a tension or trade-off (revenue vs experience, partner vs competitor, borrow vs build) so the person has to reason instead of repeating the corporate line; is one only this person can answer because of their path ("Having worked at A and B, what changes between…?"); is open-ended, sometimes with a short personal second part ("and how do you use it day to day?"); connects to the student's goals (roles, skills they value, how they hire); uses a personal hook from the student's background when there is one. Avoid: questions answered by a Google search, uncomfortable questions (turn layoffs into "how does the team work today?"), questions that assume something unconfirmed, and asking for a job directly (use "What does the team look for when it hires MBAs?").
- verify: at most 3-5 things to confirm before the event (missing time or place, inferences, conflicting sources, title differences).

Style:
- The first sentence of every section and of every summary gives the conclusion, with a number or a date when possible.
- Sentences under 25 words; paragraphs of at most 3 sentences. Simple words. Explain each acronym the first time (e.g. "CPM (price per 1,000 ad views)", "DSP (software to buy ads)").
- Data instead of adjectives. Company dates with quarter and months ("Q3 2026, Jul–Sep"). Mark inferences ("probably…, confirm with them").
- Before answering, check: figures match across sections; dates are in order; nothing is assumed without saying so; the tone of the questions fits the event.

Strict rules:
- Facts about people, figures, dates and news must come from the research notes. Put the note's source numbers right after each fact, exactly as written, e.g. "Revenue grew 12% [3]". Never invent source numbers.
- Widely known stable facts (what a company does) may be used without a number. If you infer something, say it is an inference.
- Never invent anything. If the notes do not have it, leave it out or say it is not available.
- people: only the people named in the EVENT section. Never add or substitute someone else (e.g. a company executive found in the research) as if they were attending; you may mention such leaders inside the company section instead.
- Never include emails, phone numbers or links in the text.

No repetition (each fact lives in ONE place; other sections may refer to it in a few words, never restate it):
- Figures from the latest results → financials only. News items → companyNews / industryNews only. Area facts (pricing, formats, partners) → companies[].focus only.
- bigPicture is the synthesis: the meaning of the facts in one line each ("growth is strong but the ads business is behind its own plan"), not a copy of a news headline or a metric. Max one number per bullet.
- headline and angle don't list facts; they say why this event matters to the student.
- Question contexts may recall a fact briefly to set up the question; don't paste whole paragraphs from other sections.
- Vary the wording: don't start several bullets the same way; no filler ("in today's fast-paced world", "it is important to note").

Adapt to the event (leave a field empty or a list empty when it does not apply; the app hides empty sections):
- Coffee chat / 1:1: the person matters more (still a light profile); questions are personal and about their path and team.
- Panel / several speakers: one short entry per speaker, comparing them ("three different paths"); who to prioritize and why; the industry weighs more because it is the common topic; questions: 3 for the whole panel plus 2-3 per speaker.
- Company presentation / info session / recruiting event: the company, the team or area presenting and how they hire; questions about the business and the role.
- Interview or mock interview: the company, its current challenges and how the student fits; add a theme "Prepare for the interview" with the likely questions to expect and how to connect the student's story to the company's priorities; in angle, what to bring or show.
- Career fair or networking night with many companies: a short entry per company (summary + one key recent fact), no deep financials; questions to open a conversation at each table.
- Talk about a topic with no company (e.g. "AI in healthcare"): skip financials and companyNews; use companies for 2-4 key players from the FIELD LANDSCAPE notes (short summary each, no focus); bigPicture and industryNews for the topic (funding, shifts, regulation); questions about the topic and careers in it (which roles exist for MBAs and how to get in).
- Private company or startup: no public results; put funding, valuation, traction and customers in financials.takeaway and leave metrics empty.`;
}

export function writerPrompt(event, student, notes, shape) {
  const line = (label, v) => (v ? `${label}: ${v}` : '');
  const studentLines = [
    line('Name', student?.name),
    line('Program', student?.program),
    line('Career goal', student?.careerGoal),
    line('Background (for personal hooks)', student?.background),
    line('Target roles (in priority order)', student?.roles?.join(', ')),
    line('Target industries', student?.industries?.join(', ')),
    line('Priority companies', student?.companies?.join(', ')),
  ].filter(Boolean);
  const eventLines = [
    line('Title', event.title),
    line('Date and time', event.datetime),
    line('Type', event.eventType),
    line('Format', event.format),
    line('Topic', event.topic),
    line('Organizer', event.organizer),
    line('People', event.person),
    line('Their role', event.role),
    line('Company', event.company),
    line('Attendees (name · company from email domain)', event.attendees),
    line('Description', event.description),
    line('Student notes', event.notes),
    line('What the student already knows about these people (their contacts)', event.contacts),
    line('Extra context the student added', event.extraContext),
  ].filter(Boolean);
  return [
    `Event shape: ${shape === 'panel' ? 'a panel or several speakers' : shape === 'person' ? 'one main person' : shape === 'topic' ? 'no company and no named person: a talk about a topic' : 'no named person: focus on the company'}.`,
    '',
    'EVENT',
    ...eventLines,
    '',
    'STUDENT',
    ...(studentLines.length ? studentLines : ['No profile details.']),
    '',
    'RESEARCH NOTES (from Google Search; [n] = source number)',
    notes || 'No research notes: the web search found nothing.',
  ].join('\n');
}

export function writerRequest(event, student, notes, shape, language, attachment) {
  const file = attachment ? [{ inlineData: { mimeType: attachment.mimeType, data: attachment.data } }, { text: `The PDF above was uploaded by the student for this event (${attachment.name}). Use it as event context.` }] : [];
  return {
    systemInstruction: { parts: [{ text: writerInstruction(language) }] },
    contents: [{ role: 'user', parts: [...file, { text: writerPrompt(event, student, notes, shape) }] }],
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens: 12000,
      responseMimeType: 'application/json',
      responseSchema: BRIEF_V3_SCHEMA,
      thinkingConfig: { thinkingLevel: 'low' },
    },
  };
}

const s = (v, max = 1200) => (typeof v === 'string' ? v.replace(/https?:\/\/\S+/gi, '').trim().slice(0, max) : '');
const sa = (v, n = 12) => (Array.isArray(v) ? v.map((x) => s(x, 600)).filter(Boolean).slice(0, n) : []);
const oa = (v, n) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object').slice(0, n) : []);

/** Validates the writer's JSON into a version-3 brief and removes source numbers that don't exist. */
export function parseWriter(data, sourceCount) {
  const cand = data?.candidates?.[0];
  if (!cand) throw new Error('The AI returned no answer.');
  if (cand.finishReason === 'MAX_TOKENS') throw new Error('The AI answer was cut off (token limit). Try again.');
  const text = (cand.content?.parts ?? []).map((p) => p.text ?? '').join('');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('The AI answer was not valid JSON.');
  }
  // Keep [n] only when source n exists.
  const fix = (t) => t.replace(/\[(\d{1,3})\]/g, (m, n) => (Number(n) >= 1 && Number(n) <= sourceCount ? m : '')).replace(/\s+([.,;:])/g, '$1').trim();
  const fs = (v, max) => fix(s(v, max));
  const fsa = (v, n) => sa(v, n).map(fix);
  const ev = raw.event ?? {};
  const news = (n) => ({ lead: fs(n?.lead, 400), items: oa(n?.items, 7).map((i) => ({ date: s(i.date, 60), headline: fs(i.headline, 400), whyItMatters: fs(i.whyItMatters, 500) })).filter((i) => i.headline) });
  const fin = raw.financials ?? {};
  const brief = {
    version: 3,
    headline: fs(raw.headline, 400),
    event: { title: s(ev.title, 200), when: s(ev.when, 200), where: s(ev.where, 200), format: s(ev.format, 200), topic: fs(ev.topic, 400) },
    angle: fs(raw.angle, 1500),
    angleBullets: fsa(raw.angleBullets, 6),
    bigPicture: {
      company: fsa(raw.bigPicture?.company, 5),
      industry: fsa(raw.bigPicture?.industry, 5),
      competition: fsa(raw.bigPicture?.competition, 4),
      challenges: fsa(raw.bigPicture?.challenges, 4),
    },
    people: oa(raw.people, 5)
      .map((p) => ({
        name: s(p.name, 120),
        roleNow: fs(p.roleNow, 300),
        affiliation: s(p.affiliation, 120),
        summary: fs(p.summary, 800),
        timeline: oa(p.timeline, 10).map((t) => ({ years: s(t.years, 40), company: s(t.company, 120), role: s(t.role, 200) })).filter((t) => t.company || t.role),
        education: fs(p.education, 400),
        highlights: fsa(p.highlights, 7),
        whyItMatters: fs(p.whyItMatters, 800),
        caveat: fs(p.caveat, 500),
      }))
      .filter((p) => p.name),
    peopleNote: fs(raw.peopleNote, 500),
    companies: oa(raw.companies, 4)
      .map((c) => ({
        name: s(c.name, 120),
        summary: fs(c.summary, 1000),
        businessLines: oa(c.businessLines, 7).map((b) => ({ name: s(b.name, 120), what: fs(b.what, 500), keyFact: fs(b.keyFact, 400) })).filter((b) => b.name),
        focus:
          c.focus && s(c.focus.area, 160)
            ? {
                area: s(c.focus.area, 160),
                summary: fs(c.focus.summary, 1200),
                pieces: oa(c.focus.pieces, 8).map((x) => ({ name: s(x.name, 120), what: fs(x.what, 500), keyFact: fs(x.keyFact, 400) })).filter((x) => x.name),
                logic: fs(c.focus.logic, 1000),
              }
            : null,
        modelInsight: fs(c.modelInsight, 800),
        watchOut: fs(c.watchOut, 400),
      }))
      .filter((c) => c.name),
    financials: {
      company: s(fin.company, 120),
      period: s(fin.period, 120),
      takeaway: fs(fin.takeaway, 800),
      metrics: oa(fin.metrics, 9).map((m) => ({ metric: s(m.metric, 120), value: fs(m.value, 200), change: fs(m.change, 200) })).filter((m) => m.metric && m.value),
      highlights: fsa(fin.highlights, 6),
    },
    companyNews: news(raw.companyNews),
    industryNews: news(raw.industryNews),
    questionThemes: oa(raw.questionThemes, 8)
      .map((t) => ({ theme: s(t.theme, 200) || 'Questions', context: fs(t.context, 1500), questions: sa(t.questions, 4).map((q) => q.replace(/\s*\[\d{1,3}\]/g, '')) }))
      .filter((t) => t.questions.length),
    verify: fsa(raw.verify, 8),
  };
  if (!brief.headline || brief.questionThemes.length === 0) throw new Error('The AI answer was missing required sections.');
  dedupeBrief(brief);
  const u = data.usageMetadata ?? {};
  return { brief, usage: { inputTokens: u.promptTokenCount ?? 0, outputTokens: Math.max((u.totalTokenCount ?? 0) - (u.promptTokenCount ?? 0), 0), searches: 0 } };
}

/** Cost of one brief. `paidSearches` = searches beyond Google's monthly free 5,000 (see guard.mjs). */
const DUP_STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'its', 'was', 'are', 'has', 'have', 'its', 'los', 'las', 'del', 'para', 'con', 'que', 'por', 'una', 'sus']);
const keyWords = (t) =>
  new Set(
    String(t ?? '')
      .toLowerCase()
      .replace(/\[\d{1,3}\]/g, ' ')
      .replace(/[^\p{L}\p{N}%$€.]+/gu, ' ')
      .split(' ')
      .filter((w) => w.length > 2 && !DUP_STOP.has(w)),
  );
/** True when two texts say mostly the same thing (most of the shorter one's words appear in the other). */
export function sameFact(a, b) {
  const x = keyWords(a);
  const y = keyWords(b);
  if (x.size < 3 || y.size < 3) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / Math.min(x.size, y.size) >= 0.75;
}

/** Removes repeated items: the same news twice, industry items that are company news, big-picture bullets copied from a section. */
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11, ene: 0, abr: 3, ago: 7, set: 8, dic: 11 };
/** A sortable number for dates like "2026-10-20", "October 20, 2026", "Oct 2026", "20 oct 2026", "Q3 2026"; NaN if unknown. */
export function dateValue(text) {
  const t = String(text ?? '').toLowerCase();
  const iso = t.match(/(20\d\d)-(\d{1,2})(?:-(\d{1,2}))?/);
  if (iso) return Number(iso[1]) * 400 + Number(iso[2]) * 32 + Number(iso[3] ?? 1);
  const year = t.match(/20\d\d/)?.[0];
  if (!year) return NaN;
  const m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|ene|abr|ago|set|dic)[a-zé]*/);
  const q = t.match(/\bq([1-4])\b/);
  const day = t.match(/\b([0-3]?\d)\b(?!\d)/)?.[1];
  const month = m ? MONTHS[m[1]] + 1 : q ? Number(q[1]) * 3 : 0;
  return Number(year) * 400 + month * 32 + (m && day ? Number(day) : 0);
}

/** Most recent first; items without a readable date keep their order after the dated ones. */
export function newestFirst(items) {
  return items
    .map((x, i) => ({ x, i, v: dateValue(x.date) }))
    .sort((a, b) => (Number.isNaN(a.v) ? 1 : 0) - (Number.isNaN(b.v) ? 1 : 0) || (Number.isNaN(a.v) ? a.i - b.i : b.v - a.v || a.i - b.i))
    .map((e) => e.x);
}

export function dedupeBrief(b) {
  const uniq = (items, text) => items.filter((it, i) => !items.slice(0, i).some((prev) => sameFact(text(prev), text(it))));
  b.companyNews.items = uniq(b.companyNews.items, (n) => n.headline);
  b.industryNews.items = uniq(b.industryNews.items, (n) => n.headline).filter((n) => !b.companyNews.items.some((c) => sameFact(c.headline, n.headline)));
  const elsewhere = [...b.companyNews.items.map((n) => n.headline), ...b.industryNews.items.map((n) => n.headline), ...b.financials.highlights];
  for (const k of ['company', 'industry', 'competition', 'challenges']) {
    b.bigPicture[k] = uniq(b.bigPicture[k], (x) => x).filter((x) => !elsewhere.some((e) => sameFact(e, x) && keyWords(x).size <= keyWords(e).size + 3));
  }
  b.financials.highlights = uniq(b.financials.highlights, (x) => x).filter((h) => !b.companyNews.items.some((n) => sameFact(n.headline, h)));
  b.companyNews.items = newestFirst(b.companyNews.items);
  b.industryNews.items = newestFirst(b.industryNews.items);
  for (const p of b.people) p.highlights = uniq(p.highlights, (x) => x);
  return b;
}

export function agentCostUsd(usage, paidSearches = usage.searches ?? 0) {
  return (usage.inputTokens * AGENT_PRICES.inputPerMillion + usage.outputTokens * AGENT_PRICES.outputPerMillion) / 1_000_000 + Math.max(0, paidSearches) * SEARCH_PRICE_USD;
}

// ---------------------------------------------------------------- run

/**
 * Runs the whole agent. `call(body, model, timeoutMs)` performs one Gemini request and returns { ok, status, data }.
 * Returns { brief, usage, model } or throws an Error with a readable message.
 */
export async function runAgent(event, { student, language = 'en', call, attachment, log = () => {} }) {
  let lens = null;
  try {
    const l = await call(lensRequest(event, student), LENS_MODEL, 20_000);
    if (l.ok) lens = parseLens(l.data);
  } catch {
    lens = null; // the plan still works without a lens
  }
  const p = plan(event, student, lens);
  log(`lens: ${p.area || '-'} · ${p.industry || '-'} · competitors ${p.competitors.join(', ') || '-'}`);
  const registry = { sources: [], queries: [], suggestionsHtml: '' };
  const usage = { inputTokens: 0, outputTokens: 0, searches: 0 };
  const add = (u) => {
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;
    usage.searches += u.searches ?? 0;
  };
  // Research tasks run in parallel; their sources are numbered in task order so numbers stay stable.
  const results = await Promise.all(
    p.tasks.map(async (t) => {
      // Sometimes Gemini answers from memory without searching (no sources): try once more, then give up on that task.
      let last = { t, error: 'network' };
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await call(researchRequest(taskPrompt(t, student)), RESEARCH_MODEL, 90_000);
          if (!r.ok) return { t, error: r.status, data: r.data };
          last = { t, data: r.data, wasted: last.data };
          if ((r.data?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []).length > 0) return last;
        } catch {
          // network error: try again
        }
      }
      return last;
    }),
  );
  const noBilling = results.some((r) => r.error && /free.?tier|limit: 0|billing/i.test(String(r.data?.error?.message ?? '')));
  const sections = [];
  for (const r of results) {
    if (r.wasted) add(notesFromGrounded(r.wasted, { sources: [], queries: [], suggestionsHtml: '' }).usage);
    if (r.error) continue;
    const out = notesFromGrounded(r.data, registry);
    add(out.usage);
    if (!out.searched) continue; // never use answers that didn't come from a real search
    const label = { person: `PERSON: ${r.t.name}`, company: `COMPANY: ${r.t.company}`, area: `FOCUS AREA: ${r.t.area}`, news: `COMPANY NEWS: ${r.t.company}`, competition: 'COMPETITION', trends: 'INDUSTRY TRENDS', landscape: 'FIELD LANDSCAPE (key players, money, roles for MBAs)' }[r.t.kind] ?? 'NOTES';
    sections.push(`### ${label}\n${out.notes}`);
  }
  log(`research: ${p.tasks.length} tasks, ${sections.length} with sources, ${registry.sources.length} sources, ${usage.searches} searches`);
  const lensLine = p.area ? `Focus area of this event: ${p.area}. Industry: ${p.industry || 'n/a'}. Main competitors: ${p.competitors.join(', ') || 'n/a'}.\n\n` : '';
  const notes = (lensLine + sections.join('\n\n')).slice(0, 70_000);
  const w = await call(writerRequest(event, student, notes, p.shape, language, attachment), WRITER_MODEL, 150_000);
  if (!w.ok) {
    const e = new Error(w.status === 429 ? 'AI rate limit reached. Wait a minute and try again.' : `The AI service returned an error (${w.status}).`);
    e.usage = usage;
    throw e;
  }
  const { brief, usage: wu } = parseWriter(w.data, registry.sources.length);
  add(wu);
  if (p.shape === 'topic') {
    // No company: no company news or financial results (market data belongs in bigPicture / industryNews).
    brief.financials = { company: '', period: '', takeaway: '', metrics: [], highlights: [] };
    brief.companyNews = { lead: '', items: [] };
  }
  brief.language = language;
  if (registry.sources.length) brief.web = { sources: registry.sources, queries: registry.queries.slice(0, 40), suggestionsHtml: registry.suggestionsHtml };
  else brief.webSearchNote = noBilling ? 'Web search is not available for this AI key (billing not enabled).' : 'The web search found no sources this time. Regenerate to try again.';
  return { brief, usage, model: WRITER_MODEL };
}
