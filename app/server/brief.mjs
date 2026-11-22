import { SEARCH_PRICE_USD, sanitizeSuggestions } from './research.mjs';
// Pure helpers for the AI brief: input validation, prompt, Gemini request, response parsing, cost.
// No network calls here, so everything is unit-tested in src/test/ai-brief.test.tsx.
// The brief has the same 8 sections as the sample briefs. Without web search, financials and news are
// never written as facts: the AI only says what to look up, and the app labels them "Not verified".

export const LIMITS = { title: 200, datetime: 200, company: 120, person: 200, role: 120, eventType: 60, attendeeCompanies: 300, notes: 2000, description: 1500, topic: 300, attendees: 1500, organizer: 200, format: 40, contacts: 3000, extraContext: 6000 };
export const MAX_ATTACHMENT_BASE64 = 2_800_000; // about 2 MB of PDF

/** Validates and trims the event details. Returns { event } or { error }. */
export function validateEventInput(body) {
  if (!body || typeof body !== 'object') return { error: 'Request body must be a JSON object.' };
  const event = {};
  for (const [key, max] of Object.entries(LIMITS)) {
    const v = body[key];
    if (v !== undefined && v !== null && typeof v !== 'string') return { error: `${key} must be text.` };
    const s = (v ?? '').trim();
    if (s.length > max) return { error: `${key} is too long (max ${max} characters).` };
    event[key] = s;
  }
  if (!event.title) return { error: 'Event title is required.' };
  // Optional file for this brief only (PDF). Text files are read in the browser and arrive as extraContext.
  const a = body.attachment;
  if (a !== undefined && a !== null) {
    if (typeof a !== 'object' || a.mimeType !== 'application/pdf' || typeof a.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(a.data.slice(0, 200)))
      return { error: 'The file must be a PDF.' };
    if (a.data.length > MAX_ATTACHMENT_BASE64) return { error: 'The file is too large (max 2 MB).' };
    return { event, attachment: { mimeType: 'application/pdf', data: a.data, name: String(a.name ?? 'file.pdf').slice(0, 120) } };
  }
  return { event };
}

const BASE_INSTRUCTION = `You help a business-school student prepare for a networking event (coffee chat, panel, info session, lunch and learn, interview).
Write a practical prep brief in English with these sections: event essentials, people, companies, financials, company news, industry themes, questions.

Read the event description carefully: it often names the company, the speaker, their role and the topic. Use it.
If the company is only implied (for example a speaker "from Meta", or an attendee email domain), use it and say where it came from in foundIn.
Other sources you may get: attendee names with the company from their email domain (list them in people, foundIn "Calendar attendees"); the organizer; text or a file the student added (agenda, bio, invitation); and the student's own contact records (role, last contact, referral status, private notes). Use contact notes to suggest how to reconnect and follow up; never repeat sensitive details beyond what helps the conversation.

`;

const COMMON_RULES = `- industryThemes are long-running themes in the industry (not news); explain why each matters for this conversation.
- If you are not sure a fact is correct or current, write "Not verified" next to it.
- Return EXACTLY 10 questions in total (for example 4 + 3 + 3), grouped into 3 themes, open-ended, tailored to the people, company and topic. Count them before answering.`;

/** Without web access: no news or figures, only what to look up. */
const OFFLINE_RULES = `Strict honesty rules:
- Use only the event details given plus widely known, stable public facts about the company (what it does, main products, business model).
- Never invent news, recent events, deals, launches, financial figures, headcounts, dates or quotes. You have no web access.
- For financials and company news, do NOT state facts. Leave financialHighlights and companyNews empty, and only list specific things the student should look up, and where (e.g. "Latest quarterly earnings release on the investor relations site").
- People: you only know what the event text says. Never add career history, education or opinions. howToConnect is advice, not facts.
${COMMON_RULES}`;

/** With Google Search: current facts, each from the search results, with dates. */
const WEB_RULES = `You can use Google Search. Search for: the company's latest reported financial results, the company's news from the last 3 months, and the public professional background of the named people.
Strict honesty rules:
- financialHighlights: 2-4 facts from the latest reported results (revenue, growth, profit, users, funding), each with the period (e.g. "Q3 2026") and the source name. Only figures you found in the search results.
- companyNews: 2-4 items from the last 3 months, each with the date, the source name and why it matters for this conversation. Only items you found in the search results.
- People: you may add publicly reported professional information found in the search (current role, past roles, public talks or articles), with foundIn "Web search". Never personal details (family, address, health, contact details). If unsure it is the same person, say "Not verified".
- Never invent anything. If the search finds nothing reliable, leave the list empty and say what to look up in financialsToCheck / companyNewsToCheck.
- financialsToCheck and companyNewsToCheck: what the student should still double-check.
${COMMON_RULES}`;

export const systemInstruction = (webSearch) => `${BASE_INSTRUCTION}\n${webSearch ? WEB_RULES : OFFLINE_RULES}`;

const STR = { type: 'STRING' };
const STR_ARR = { type: 'ARRAY', items: STR };

/** Gemini structured-output schema (OpenAPI subset). */
export const BRIEF_SCHEMA = {
  type: 'OBJECT',
  properties: {
    essentials: {
      type: 'OBJECT',
      properties: { summary: STR, goal: STR, prepareFor: STR_ARR },
      required: ['summary', 'goal', 'prepareFor'],
    },
    people: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: STR, role: STR, company: STR, foundIn: STR, howToConnect: STR },
        required: ['name', 'role', 'company', 'foundIn', 'howToConnect'],
      },
    },
    companies: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: STR,
          foundIn: STR,
          overview: STR,
          businessModel: STR,
          products: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: STR, whyItMatters: STR }, required: ['name', 'whyItMatters'] } },
        },
        required: ['name', 'foundIn', 'overview', 'businessModel', 'products'],
      },
    },
    financialHighlights: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { fact: STR, period: STR, source: STR }, required: ['fact', 'period', 'source'] },
    },
    companyNews: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { headline: STR, date: STR, source: STR, whyItMatters: STR }, required: ['headline', 'date', 'source', 'whyItMatters'] },
    },
    financialsToCheck: STR_ARR,
    companyNewsToCheck: STR_ARR,
    industryThemes: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { theme: STR, whyItMatters: STR }, required: ['theme', 'whyItMatters'] },
    },
    questionThemes: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { theme: STR, questions: STR_ARR }, required: ['theme', 'questions'] },
    },
    verifyBeforeEvent: STR_ARR,
  },
  required: ['essentials', 'people', 'companies', 'financialsToCheck', 'companyNewsToCheck', 'industryThemes', 'questionThemes', 'verifyBeforeEvent'],
};

export function buildUserPrompt(event) {
  const line = (label, v) => `${label}: ${v || 'Not provided'}`;
  return [
    'Event details (from the student’s calendar or typed by the student):',
    line('Title', event.title),
    line('Date and time', event.datetime),
    line('Event type', event.eventType),
    line('Format', event.format),
    line('Topic', event.topic),
    line('Organizer', event.organizer),
    line('Attendees (name · company from email domain)', event.attendees),
    line('Company', event.company),
    line('Person', event.person),
    line('Person role', event.role),
    line('Companies from attendee email domains', event.attendeeCompanies),
    line('Event description', event.description),
    line('Student notes', event.notes),
    line('People the student already knows (from their contacts)', event.contacts),
    line('Extra context the student pasted or uploaded', event.extraContext),
  ].join('\n');
}

/** Builds the Gemini generateContent request body. */
export function buildGeminiRequest(event, { model, maxOutputTokens, attachment, webSearch = false }) {
  const generationConfig = {
    temperature: 0.4,
    maxOutputTokens,
    responseMimeType: 'application/json',
    responseSchema: BRIEF_SCHEMA,
  };
  // Gemini models "think" by default, which spends (billed) output tokens. Keep thinking minimal to keep runs cheap.
  if (/^gemini-2\.5/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
  else if (/^gemini-3/.test(model)) generationConfig.thinkingConfig = { thinkingLevel: 'minimal' };
  return {
    systemInstruction: { parts: [{ text: systemInstruction(webSearch) }] },
    // Grounding with Google Search: the model searches while writing the brief (billed per search it runs).
    ...(webSearch ? { tools: [{ google_search: {} }] } : {}),
    contents: [
      {
        role: 'user',
        parts: [
          ...(attachment ? [{ inlineData: { mimeType: attachment.mimeType, data: attachment.data } }, { text: `The PDF above was uploaded by the student for this event (${attachment.name}).` }] : []),
          { text: buildUserPrompt(event) },
        ],
      },
    ],
    generationConfig,
  };
}

const s = (v) => (typeof v === 'string' ? v.trim() : '');
const strArr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []);
const objArr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);

/** Parses Gemini's response into { brief, usage } or throws an Error with a readable message. */
export function parseGeminiResponse(data) {
  const cand = data?.candidates?.[0];
  if (!cand) throw new Error(data?.promptFeedback?.blockReason ? `The AI blocked this request (${data.promptFeedback.blockReason}).` : 'The AI returned no answer.');
  if (cand.finishReason === 'MAX_TOKENS') throw new Error('The AI answer was cut off (token limit). Try again.');
  const text = (cand.content?.parts ?? []).map((p) => p.text ?? '').join('');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    const a = text.indexOf('{');
    const b = text.lastIndexOf('}');
    try {
      raw = JSON.parse(text.slice(a, b + 1));
    } catch {
      throw new Error('The AI answer was not valid JSON.');
    }
  }
  const ess = raw.essentials ?? {};
  const brief = {
    version: 2,
    essentials: { summary: s(ess.summary), goal: s(ess.goal), prepareFor: strArr(ess.prepareFor) },
    people: objArr(raw.people)
      .map((p) => ({ name: s(p.name), role: s(p.role), company: s(p.company), foundIn: s(p.foundIn), howToConnect: s(p.howToConnect) }))
      .filter((p) => p.name),
    companies: objArr(raw.companies)
      .map((c) => ({
        name: s(c.name),
        foundIn: s(c.foundIn),
        overview: s(c.overview),
        businessModel: s(c.businessModel),
        products: objArr(c.products).map((p) => ({ name: s(p.name), whyItMatters: s(p.whyItMatters) })).filter((p) => p.name),
      }))
      .filter((c) => c.name),
    financialHighlights: objArr(raw.financialHighlights)
      .map((f) => ({ fact: s(f.fact), period: s(f.period), source: s(f.source) }))
      .filter((f) => f.fact)
      .slice(0, 6),
    companyNews: objArr(raw.companyNews)
      .map((n) => ({ headline: s(n.headline), date: s(n.date), source: s(n.source), whyItMatters: s(n.whyItMatters) }))
      .filter((n) => n.headline)
      .slice(0, 6),
    financialsToCheck: strArr(raw.financialsToCheck),
    companyNewsToCheck: strArr(raw.companyNewsToCheck),
    industryThemes: objArr(raw.industryThemes).map((t) => ({ theme: s(t.theme), whyItMatters: s(t.whyItMatters) })).filter((t) => t.theme),
    questionThemes: objArr(raw.questionThemes)
      .map((t) => ({ theme: s(t.theme) || 'Questions', questions: strArr(t.questions) }))
      .filter((t) => t.questions.length > 0),
    verifyBeforeEvent: strArr(raw.verifyBeforeEvent),
  };
  if (!brief.essentials.summary || brief.questionThemes.length === 0) throw new Error('The AI answer was missing required sections.');
  brief.questionCount = brief.questionThemes.reduce((n, t) => n + t.questions.length, 0);
  const u = data.usageMetadata ?? {};
  const inputTokens = u.promptTokenCount ?? 0;
  const totalTokens = u.totalTokenCount ?? 0;
  // Output = everything that is not input (includes any "thinking" tokens, which are billed as output).
  const outputTokens = Math.max(totalTokens - inputTokens, (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0));
  const web = groundingOf(cand);
  if (web) {
    brief.web = { sources: web.sources, queries: web.queries, suggestionsHtml: web.suggestionsHtml };
    attachRefs(brief, web);
  }
  return { brief, usage: { inputTokens, outputTokens, searches: web?.queries.length ?? 0 } };
}

/** Sources, searches and Google's Search Suggestions from a grounded answer (null when no search ran). */
export function groundingOf(cand) {
  const gm = cand?.groundingMetadata;
  if (!gm) return null;
  // Deduplicated https sources; chunkToSource maps Google's chunk index to our 0-based source number.
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
  const queries = (gm.webSearchQueries ?? []).filter((q) => typeof q === 'string' && q.trim()).slice(0, 20);
  if (!sources.length && !queries.length) return null;
  // Which piece of the answer each source supports (Google's groundingSupports).
  const supports = (gm.groundingSupports ?? [])
    .map((s) => ({ text: norm(s?.segment?.text), refs: [...new Set((s?.groundingChunkIndices ?? []).map((i) => chunkToSource.get(i)).filter((k) => k !== undefined))] }))
    .filter((s) => s.text.length >= 12 && s.refs.length);
  return { sources, queries, supports, suggestionsHtml: sanitizeSuggestions(String(gm.searchEntryPoint?.renderedContent ?? '')) };
}

const norm = (t) => String(t ?? '').toLowerCase().replace(/\\"/g, '"').replace(/[^a-z0-9%$.]+/g, ' ').trim();

/** Source numbers (0-based) backing a piece of text: Google's supports first, then the named source vs. source titles. */
export function refsFor(texts, sourceName, web) {
  const vals = texts.map(norm).filter((v) => v.length >= 12);
  const refs = new Set();
  for (const s of web.supports ?? []) {
    if (vals.some((v) => v.includes(s.text) || s.text.includes(v))) s.refs.forEach((r) => refs.add(r));
  }
  if (!refs.size && sourceName) {
    const name = norm(sourceName).replace(/ /g, '');
    web.sources.forEach((src, i) => {
      const t = norm(src.title).replace(/ /g, '').replace(/^www\./, '');
      const root = t.split('.')[0];
      if (root.length >= 3 && (name.includes(root) || t.includes(name))) refs.add(i);
    });
  }
  return [...refs].sort((a, b) => a - b).slice(0, 4);
}

/** Adds `refs` (source numbers) to each web-backed fact so the UI can show a clickable [n] next to it. */
function attachRefs(brief, web) {
  for (const f of brief.financialHighlights) f.refs = refsFor([f.fact], f.source, web);
  for (const n of brief.companyNews) n.refs = refsFor([n.headline, n.whyItMatters], n.source, web);
  for (const p of brief.people) p.refs = refsFor([p.role, p.howToConnect], '', web);
  for (const c of brief.companies) c.refs = refsFor([c.overview, c.businessModel], '', web);
}

/** Cost in USD at paid rates. Prices are per 1 million tokens; each Google search counted at $14 per 1,000 (after the free 5,000/month). */
export function estimateCostUsd(usage, { inputPerMillion, outputPerMillion }) {
  return (usage.inputTokens * inputPerMillion + usage.outputTokens * outputPerMillion) / 1_000_000 + (usage.searches ?? 0) * SEARCH_PRICE_USD;
}

// ---------- Follow-ups on an existing brief: more questions, and chat ----------

const thinking = (model) =>
  /^gemini-2\.5/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : /^gemini-3/.test(model) ? { thinkingConfig: { thinkingLevel: 'minimal' } } : {};

/** Short text version of a brief, used as context for follow-ups (keeps calls small and cheap). */
export function briefContext(event, brief) {
  const b = brief ?? {};
  const lines = [
    buildUserPrompt(event),
    '',
    'The prep brief already written:',
    `Summary: ${b.essentials?.summary ?? ''}`,
    `Goal: ${b.essentials?.goal ?? ''}`,
    `People: ${(b.people ?? []).map((p) => `${p.name} (${p.role || 'role unknown'}, ${p.company || 'company unknown'})`).join('; ') || 'none named'}`,
    `Companies: ${(b.companies ?? []).map((c) => `${c.name}: ${c.overview}`).join(' | ') || 'none identified'}`,
    `Industry themes: ${(b.industryThemes ?? []).map((t) => t.theme).join('; ')}`,
    `Questions already in the brief: ${(b.questionThemes ?? []).flatMap((t) => t.questions).join(' / ')}`,
  ];
  return lines.join('\n').slice(0, 8000);
}

const RULES = `Honesty rules: use only the event details and the brief, plus widely known stable facts. Never invent news, financial figures, dates, quotes or facts about people. You have no web access; if something needs current information, say it is not verified and what to check.`;

export function validateFollowUp(body) {
  if (!body || typeof body !== 'object') return { error: 'Invalid request.' };
  const { event, error } = validateEventInput(body.event ?? {});
  if (error) return { error };
  if (!body.brief || typeof body.brief !== 'object') return { error: 'brief is required.' };
  const existing = Array.isArray(body.existingQuestions) ? body.existingQuestions.filter((q) => typeof q === 'string').slice(0, 60).map((q) => q.slice(0, 300)) : [];
  const messages = Array.isArray(body.messages)
    ? body.messages
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
        .slice(-10)
        .map((m) => ({ role: m.role, text: m.text.slice(0, 2000) }))
    : [];
  return { input: { event, brief: body.brief, existing, messages } };
}

export const MORE_QUESTIONS_SCHEMA = {
  type: 'OBJECT',
  properties: { questions: { type: 'ARRAY', items: { type: 'OBJECT', properties: { theme: STR, question: STR }, required: ['theme', 'question'] } } },
  required: ['questions'],
};

export function buildMoreQuestionsRequest({ event, brief, existing }, { model }) {
  const text = `${briefContext(event, brief)}\n\nAlso already suggested: ${existing.join(' / ') || 'nothing else'}\n\nWrite exactly 3 NEW open-ended questions the student could ask at this event. Do not repeat or rephrase any question above. Use one of the brief's themes for each, or a short new theme.`;
  return {
    systemInstruction: { parts: [{ text: `You help a business-school student prepare for a networking event. ${RULES}` }] },
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 800, responseMimeType: 'application/json', responseSchema: MORE_QUESTIONS_SCHEMA, ...thinking(model) },
  };
}

const usageOf = (data) => {
  const u = data?.usageMetadata ?? {};
  return { inputTokens: u.promptTokenCount ?? 0, outputTokens: Math.max(0, (u.totalTokenCount ?? 0) - (u.promptTokenCount ?? 0)) };
};
const textOf = (data) => (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');

export function parseMoreQuestions(data, existing = []) {
  let raw;
  try {
    raw = JSON.parse(textOf(data));
  } catch {
    throw new Error('The AI answer was not valid JSON.');
  }
  const seen = new Set(existing.map((q) => q.trim().toLowerCase()));
  const questions = (Array.isArray(raw.questions) ? raw.questions : [])
    .map((q) => ({ theme: s(q?.theme) || 'More questions', question: s(q?.question) }))
    .filter((q) => q.question && !seen.has(q.question.toLowerCase()))
    .slice(0, 3);
  if (questions.length === 0) throw new Error('The AI did not return new questions. Try again.');
  return { questions, usage: usageOf(data) };
}

export function buildChatRequest({ event, brief, messages }, { model }) {
  const system = `You are a prep assistant inside Networking Studio. The student is preparing for the event below; answer their follow-up questions about it in a short, practical way (at most 150 words, plain text, no markdown headings). ${RULES}\n\n${briefContext(event, brief)}`;
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })),
    generationConfig: { temperature: 0.5, maxOutputTokens: 700, ...thinking(model) },
  };
}

export function parseChat(data) {
  const reply = textOf(data).trim();
  if (!reply) throw new Error(data?.candidates?.[0]?.finishReason === 'MAX_TOKENS' ? 'The answer was cut off. Ask a shorter question.' : 'The AI returned no answer.');
  return { reply, usage: usageOf(data) };
}
