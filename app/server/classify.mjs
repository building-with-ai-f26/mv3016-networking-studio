// AI step of the networking classifier: only for events the rules could not decide.
// Input never includes emails: only title, cleaned description and company names guessed from domains.

export const TYPES = ['coffee_chat', 'networking_event', 'company_presentation', 'career_panel', 'mock_interview', 'interview', 'not_networking'];

const SYSTEM = `You classify a business-school student's calendar events. Decide if the event is a networking opportunity.
Types: coffee_chat (1:1 chat), networking_event (mixer, alumni or club event with professionals), company_presentation (info session, lunch and learn, company talk),
career_panel, mock_interview, interview, not_networking (classes, study groups, personal, admin, internal team meetings).
Use only the given text. Return company/person/role only if they are written in the text; otherwise return empty strings. Never guess.
confidence is a number from 0 to 1. reason is one short sentence a student would understand.`;

export const CLASSIFY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    type: { type: 'STRING', enum: TYPES },
    confidence: { type: 'NUMBER' },
    reason: { type: 'STRING' },
    company: { type: 'STRING' },
    person: { type: 'STRING' },
    role: { type: 'STRING' },
  },
  required: ['type', 'confidence', 'reason', 'company', 'person', 'role'],
};

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function validateClassifyInput(body) {
  if (!body || typeof body !== 'object' || !str(body.title, 200)) return { error: 'title is required.' };
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((x) => x.slice(0, 80)).slice(0, 15) : []);
  return {
    input: {
      title: str(body.title, 200),
      description: str(body.description, 1500),
      attendeeCompanies: list(body.attendeeCompanies),
      attendeeCount: Number.isFinite(body.attendeeCount) ? Math.max(0, Math.min(500, body.attendeeCount)) : 0,
      targetCompanies: list(body.targetCompanies),
    },
  };
}

export function buildClassifyRequest(input, { model }) {
  const text = [
    `Title: ${input.title}`,
    `Description: ${input.description || 'None'}`,
    `Other attendees: ${input.attendeeCount}`,
    `Companies from attendee email domains: ${input.attendeeCompanies.join(', ') || 'None'}`,
    `Student's target companies: ${input.targetCompanies.join(', ') || 'None'}`,
  ].join('\n');
  const generationConfig = { temperature: 0, maxOutputTokens: 300, responseMimeType: 'application/json', responseSchema: CLASSIFY_SCHEMA };
  if (/^gemini-3/.test(model)) generationConfig.thinkingConfig = { thinkingLevel: 'minimal' };
  return { systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: 'user', parts: [{ text }] }], generationConfig };
}

export function parseClassifyResponse(data) {
  const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  const raw = JSON.parse(text);
  if (!TYPES.includes(raw.type)) throw new Error('Unknown type');
  const u = data.usageMetadata ?? {};
  return {
    result: {
      type: raw.type,
      confidence: Math.max(0, Math.min(1, Number(raw.confidence) || 0)),
      reason: str(raw.reason, 200) || 'Classified by AI',
      company: str(raw.company, 80),
      person: str(raw.person, 80),
      role: str(raw.role, 80),
    },
    usage: { inputTokens: u.promptTokenCount ?? 0, outputTokens: Math.max(0, (u.totalTokenCount ?? 0) - (u.promptTokenCount ?? 0)) },
  };
}
