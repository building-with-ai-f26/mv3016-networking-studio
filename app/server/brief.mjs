// Pure helpers for the AI brief: input validation, prompt, Gemini request, response parsing, cost.
// No network calls here, so everything is unit-tested in src/test/ai-brief.test.tsx.
// The brief has the same 8 sections as the sample briefs. Without web search, financials and news are
// never written as facts: the AI only says what to look up, and the app labels them "Not verified".

export const LIMITS = { title: 200, datetime: 200, company: 120, person: 120, role: 120, eventType: 60, attendeeCompanies: 300, notes: 2000, description: 1500 };

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
  return { event };
}

const SYSTEM_INSTRUCTION = `You help a business-school student prepare for a networking event (coffee chat, panel, info session, lunch and learn, interview).
Write a practical prep brief in English with these sections: event essentials, people, companies, financials, company news, industry themes, questions.

Read the event description carefully: it often names the company, the speaker, their role and the topic. Use it.
If the company is only implied (for example a speaker "from Meta", or an attendee email domain), use it and say where it came from in foundIn.

Strict honesty rules:
- Use only the event details given plus widely known, stable public facts about the company (what it does, main products, business model).
- Never invent news, recent events, deals, launches, financial figures, headcounts, dates or quotes. You have no web access.
- For financials and company news, do NOT state facts. Only list specific things the student should look up, and where (e.g. "Latest quarterly earnings release on the investor relations site").
- industryThemes are long-running themes in the industry (not news); explain why each matters for this conversation.
- People: you only know what the event text says. Never add career history, education or opinions. howToConnect is advice, not facts.
- If you are not sure a fact is correct or current, write "Not verified" next to it.
- Return EXACTLY 10 questions in total (for example 4 + 3 + 3), grouped into 3 themes, open-ended, tailored to the people, company and topic. Count them before answering.`;

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
    line('Company', event.company),
    line('Person', event.person),
    line('Person role', event.role),
    line('Companies from attendee email domains', event.attendeeCompanies),
    line('Event description', event.description),
    line('Student notes', event.notes),
  ].join('\n');
}

/** Builds the Gemini generateContent request body. */
export function buildGeminiRequest(event, { model, maxOutputTokens }) {
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
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: buildUserPrompt(event) }] }],
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
    throw new Error('The AI answer was not valid JSON.');
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
  return { brief, usage: { inputTokens, outputTokens } };
}

/** Cost in USD at paid rates. Prices are per 1 million tokens. */
export function estimateCostUsd(usage, { inputPerMillion, outputPerMillion }) {
  return (usage.inputTokens * inputPerMillion + usage.outputTokens * outputPerMillion) / 1_000_000;
}
