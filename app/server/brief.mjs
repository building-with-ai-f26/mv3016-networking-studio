// Pure helpers for the AI brief: input validation, prompt, Gemini request, response parsing, cost.
// No network calls here, so everything is unit-tested in src/test/ai-brief-server.test.ts.

export const LIMITS = { title: 200, company: 120, person: 120, role: 120, notes: 2000, datetime: 40 };

/** Validates and trims the "Add event" form. Returns { event } or { error }. */
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
  if (!event.company && !event.person) return { error: 'Add at least a company or a person.' };
  return { event };
}

const SYSTEM_INSTRUCTION = `You help a business-school student prepare for a networking event (coffee chat, panel, info session, interview).
Write a short, practical prep brief in English.

Strict honesty rules:
- Use only the event details the student gave you plus widely known, stable public facts about the company.
- Never invent news, recent events, deals, financial figures, headcounts, dates or quotes.
- Never state facts about the person (career history, education, opinions). You only know the name and role the student typed.
- If you are not sure a fact is correct or current, write "Not verified" next to it, and add it to verifyBeforeEvent.
- If the company is unknown or ambiguous, say so in companyOverview and keep products generic, each marked "Not verified".
- Questions must be open-ended and must not assume facts you could not verify.
Return exactly 10 questions in total, grouped into 3-4 themes.`;

/** Gemini structured-output schema (OpenAPI subset). */
export const BRIEF_SCHEMA = {
  type: 'OBJECT',
  properties: {
    essentials: {
      type: 'OBJECT',
      properties: {
        summary: { type: 'STRING' },
        whoYouWillMeet: { type: 'STRING' },
        goalForTheConversation: { type: 'STRING' },
        prepTips: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: ['summary', 'whoYouWillMeet', 'goalForTheConversation', 'prepTips'],
    },
    companyOverview: { type: 'STRING' },
    relevantProducts: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, whyItMatters: { type: 'STRING' } },
        required: ['name', 'whyItMatters'],
      },
    },
    questionThemes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { theme: { type: 'STRING' }, questions: { type: 'ARRAY', items: { type: 'STRING' } } },
        required: ['theme', 'questions'],
      },
    },
    verifyBeforeEvent: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['essentials', 'companyOverview', 'relevantProducts', 'questionThemes', 'verifyBeforeEvent'],
};

export function buildUserPrompt(event) {
  const line = (label, v) => `${label}: ${v || 'Not provided'}`;
  return [
    'Event details (typed by the student):',
    line('Title', event.title),
    line('Date and time', event.datetime),
    line('Company', event.company),
    line('Person', event.person),
    line('Person role', event.role),
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
  // Gemini 2.5 models "think" by default, which spends output tokens. Turn it off to keep runs cheap.
  if (/^gemini-2\.5/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
  return {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: buildUserPrompt(event) }] }],
    generationConfig,
  };
}

const strArr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []);

/** Parses Gemini's response into { brief, usage } or throws an Error with a readable message. */
export function parseGeminiResponse(data) {
  const cand = data?.candidates?.[0];
  if (!cand) throw new Error(data?.promptFeedback?.blockReason ? `The AI blocked this request (${data.promptFeedback.blockReason}).` : 'The AI returned no answer.');
  if (cand.finishReason === 'MAX_TOKENS') throw new Error('The AI answer was cut off (token limit). Try shorter notes.');
  const text = (cand.content?.parts ?? []).map((p) => p.text ?? '').join('');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('The AI answer was not valid JSON.');
  }
  const ess = raw.essentials ?? {};
  const brief = {
    essentials: {
      summary: String(ess.summary ?? ''),
      whoYouWillMeet: String(ess.whoYouWillMeet ?? ''),
      goalForTheConversation: String(ess.goalForTheConversation ?? ''),
      prepTips: strArr(ess.prepTips),
    },
    companyOverview: String(raw.companyOverview ?? ''),
    relevantProducts: (Array.isArray(raw.relevantProducts) ? raw.relevantProducts : [])
      .filter((p) => p && typeof p.name === 'string')
      .map((p) => ({ name: p.name, whyItMatters: String(p.whyItMatters ?? '') })),
    questionThemes: (Array.isArray(raw.questionThemes) ? raw.questionThemes : [])
      .map((t) => ({ theme: String(t?.theme ?? 'Questions'), questions: strArr(t?.questions) }))
      .filter((t) => t.questions.length > 0),
    verifyBeforeEvent: strArr(raw.verifyBeforeEvent),
  };
  if (!brief.essentials.summary || brief.questionThemes.length === 0) throw new Error('The AI answer was missing required sections.');
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
