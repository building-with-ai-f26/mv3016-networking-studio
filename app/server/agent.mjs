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
export function plan(event, student) {
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
  const tasks = [];
  for (const p of people) tasks.push({ kind: 'person', name: p.name, company: p.company || (people.length === 1 ? companies[0] ?? '' : ''), role: p.role });
  // The two companies most relevant to the student get the deep research and a news search; the rest a short overview.
  const focus = prioritize(companies, 2, (c) => c, student);
  companies.forEach((c) => tasks.push({ kind: 'company', company: c, deep: focus.includes(c) }));
  focus.forEach((c) => tasks.push({ kind: 'news', company: c, area: role || topic }));
  tasks.push({ kind: 'industry', companies, area: role || topic, topic });
  const shape = people.length > 1 ? 'panel' : people.length === 1 ? 'person' : 'company';
  return { shape, people, companies, tasks };
}

export function taskPrompt(t, student) {
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
Bets: where it is investing now (new products, markets, technology, capex, hiring), what it is pulling back from or stopping (cuts, exits, divestments, layoffs, cancelled products), and recent acquisitions or partnerships.
Latest results: ${t.deep ? 'ONLY the most recent reported quarter or fiscal year (say which one and when it was published): revenue, growth vs the same period a year before, operating income or margin, net income, EPS vs consensus, free cash flow, guidance, how the stock reacted, and the highlights the company stressed. Never mix periods; if sources disagree, say so' : 'the latest revenue and growth, with the period'}. If it is private: funding, valuation, traction, customers, team size.`;
    case 'news':
      return `${date} Find the 5-7 most important news about ${t.company} from the last 3 months${t.area ? `, prioritizing anything about ${t.area}` : ''}.
Write under the heading "News", one bullet per news ("- "): date · what happened, with numbers · who is involved.`;
    default:
      return `${date} Find 5-7 important recent developments (last 6 months) in the industry of ${t.companies?.length ? t.companies.join(', ') : 'this event'}${t.area ? `, especially about ${t.area}` : ''}${t.topic ? ` (event topic: ${t.topic})` : ''}: market data, competitor moves, deals, regulation, hiring trends for MBAs.
Write under the heading "Industry", one bullet per item ("- "): date · what happened, with numbers · source organization (e.g. Gartner, WSJ).`;
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
      if (registry.sources.length >= 40) return;
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
    searched: local.size > 0,
    usage: { inputTokens: u.promptTokenCount ?? 0, outputTokens: Math.max((u.totalTokenCount ?? 0) - (u.promptTokenCount ?? 0), 0), searches: (gm.webSearchQueries ?? []).filter((q) => typeof q === 'string' && q.trim()).length },
  };
}

export function researchRequest(prompt) {
  return {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
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
      { name: S, summary: S, businessLines: arr(obj({ name: S, what: S, keyFact: S })), modelInsight: S, watchOut: S },
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
}, ['headline', 'event', 'angle', 'angleBullets', 'people', 'companies', 'financials', 'companyNews', 'industryNews', 'questionThemes', 'verify']);

const LANG = { en: 'English', es: 'Spanish (Latin American, natural and simple)' };

export function writerInstruction(language = 'en') {
  return `You are a sharp research assistant who prepares a business-school student for a networking event (coffee chat, panel, info session, lunch & learn, interview).
Write the brief in ${LANG[language] ?? LANG.en}. Write every suggested question in English (the student will ask them as written).

What a great brief looks like:
- headline: one sentence that says what this event is and why it matters to the student.
- angle ("Your angle"): connect the event to the student's goals (target roles, industries, priority companies). Say what to get out of it (e.g. ask for a coffee chat), and for a panel who to prioritize and why. angleBullets: one bullet per speaker or option when useful, else empty.
- people (keep it light: a general idea, not a deep profile): for each named person, what they do today, a short career path (one row per main role), education, 1-3 highlights (the pattern of the career, e.g. "changed function, not industry", and topics they care about), why this person matters to the student, and a caveat for anything uncertain ("inference from the title, confirm with them"). If no person is named, leave people empty and say in peopleNote that the brief focuses on the company.
- companies (the main focus): 2-3 sentence summary; 3-5 business lines with one key figure each; modelInsight = the logic of the business model, where the company is investing and what it is pulling back from, and the open question; watchOut = name confusions (spin-offs, look-alike companies), else empty.
- financials: ONLY the most recent reported quarter or fiscal year of the main company, as a table (4-7 metrics, each with the value for that period and the change vs the same period a year before). Never put two periods in one cell. Name the period in period (e.g. "Q3 2026, published Oct 20"). A one-sentence takeaway (including the stock reaction if known) and 2-4 highlights, especially about the person's area. If sources disagree, use the company's own release and mention the difference in verify. If none were found (private company), set metrics empty and explain funding/traction in takeaway.
- companyNews and industryNews: a one-sentence lead that captures the story of the period, then 3-5 items with date, headline and "why it matters today" tied to the person, their area or the student's goals.
- questionThemes: 4-7 themes in conversation order (career first when there is a person, then the business). Each theme has a context of 2-4 plain-language sentences that explains the concept and the facts behind the question, then 1-2 questions. 8-12 questions in total. Questions must be specific (use the facts, numbers and names), open-ended, impossible to answer with a Google search, and show the student did their homework. Use a personal hook when the student's profile gives one.
- verify: what to confirm before the event (missing time or place, inferences, conflicting sources).

Strict rules:
- Facts about people, figures, dates and news must come from the research notes. Put the note's source numbers right after each fact, exactly as written, e.g. "Revenue grew 12% [3]". Never invent source numbers.
- Widely known stable facts (what a company does) may be used without a number. If you infer something, say it is an inference.
- Never invent anything. If the notes do not have it, leave it out or say it is not available.
- people: only the people named in the EVENT section. Never add or substitute someone else (e.g. a company executive found in the research) as if they were attending; you may mention such leaders inside the company section instead.
- Don't repeat the same fact in several sections. Be concise and concrete: numbers, names, dates.
- Never include emails, phone numbers or links in the text.`;
}

export function writerPrompt(event, student, notes, shape) {
  const line = (label, v) => (v ? `${label}: ${v}` : '');
  const studentLines = [
    line('Name', student?.name),
    line('Program', student?.program),
    line('Career goal', student?.careerGoal),
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
    `Event shape: ${shape === 'panel' ? 'a panel or several speakers' : shape === 'person' ? 'one main person' : 'no named person: focus on the company'}.`,
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
  const fix = (t) => t.replace(/\[(\d{1,2})\]/g, (m, n) => (Number(n) >= 1 && Number(n) <= sourceCount ? m : '')).replace(/\s+([.,;:])/g, '$1').trim();
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
      .map((t) => ({ theme: s(t.theme, 200) || 'Questions', context: fs(t.context, 1500), questions: sa(t.questions, 4).map((q) => q.replace(/\s*\[\d{1,2}\]/g, '')) }))
      .filter((t) => t.questions.length),
    verify: fsa(raw.verify, 8),
  };
  if (!brief.headline || brief.questionThemes.length === 0) throw new Error('The AI answer was missing required sections.');
  const u = data.usageMetadata ?? {};
  return { brief, usage: { inputTokens: u.promptTokenCount ?? 0, outputTokens: Math.max((u.totalTokenCount ?? 0) - (u.promptTokenCount ?? 0), 0), searches: 0 } };
}

/** Cost of one brief. `paidSearches` = searches beyond Google's monthly free 5,000 (see guard.mjs). */
export function agentCostUsd(usage, paidSearches = usage.searches ?? 0) {
  return (usage.inputTokens * AGENT_PRICES.inputPerMillion + usage.outputTokens * AGENT_PRICES.outputPerMillion) / 1_000_000 + Math.max(0, paidSearches) * SEARCH_PRICE_USD;
}

// ---------------------------------------------------------------- run

/**
 * Runs the whole agent. `call(body, model, timeoutMs)` performs one Gemini request and returns { ok, status, data }.
 * Returns { brief, usage, model } or throws an Error with a readable message.
 */
export async function runAgent(event, { student, language = 'en', call, attachment, log = () => {} }) {
  const p = plan(event, student);
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
      try {
        const r = await call(researchRequest(taskPrompt(t, student)), RESEARCH_MODEL, 90_000);
        if (!r.ok) return { t, error: r.status, data: r.data };
        return { t, data: r.data };
      } catch {
        return { t, error: 'network' };
      }
    }),
  );
  const noBilling = results.some((r) => r.error && /free.?tier|limit: 0|billing/i.test(String(r.data?.error?.message ?? '')));
  const sections = [];
  for (const r of results) {
    if (r.error) continue;
    const out = notesFromGrounded(r.data, registry);
    add(out.usage);
    if (!out.searched) continue; // never use answers that didn't come from a real search
    const label = r.t.kind === 'person' ? `PERSON: ${r.t.name}` : r.t.kind === 'company' ? `COMPANY: ${r.t.company}` : r.t.kind === 'news' ? `COMPANY NEWS: ${r.t.company}` : 'INDUSTRY';
    sections.push(`### ${label}\n${out.notes}`);
  }
  log(`research: ${p.tasks.length} tasks, ${sections.length} with sources, ${registry.sources.length} sources, ${usage.searches} searches`);
  const notes = sections.join('\n\n').slice(0, 60_000);
  const w = await call(writerRequest(event, student, notes, p.shape, language, attachment), WRITER_MODEL, 150_000);
  if (!w.ok) {
    const e = new Error(w.status === 429 ? 'AI rate limit reached. Wait a minute and try again.' : `The AI service returned an error (${w.status}).`);
    e.usage = usage;
    throw e;
  }
  const { brief, usage: wu } = parseWriter(w.data, registry.sources.length);
  add(wu);
  brief.language = language;
  if (registry.sources.length) brief.web = { sources: registry.sources, queries: registry.queries.slice(0, 40), suggestionsHtml: registry.suggestionsHtml };
  else brief.webSearchNote = noBilling ? 'Web search is not available for this AI key (billing not enabled).' : 'The web search found no sources this time. Regenerate to try again.';
  return { brief, usage, model: WRITER_MODEL };
}
