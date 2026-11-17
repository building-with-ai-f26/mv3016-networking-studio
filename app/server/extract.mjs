// Reads a whole calendar event with AI and extracts who you will meet, their companies and the topic.
// No fixed rules for titles: the AI reads the title, description, attendees (name + email domain, never full
// emails), organizer and location, and says where each fact came from. One call per event; the app caches it.

const STR = { type: 'STRING' };

export const EXTRACT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    people: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: STR, role: STR, company: STR, source: { type: 'STRING', enum: ['title', 'description', 'attendees', 'organizer'] } },
        required: ['name', 'role', 'company', 'source'],
      },
    },
    companies: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { name: STR, source: { type: 'STRING', enum: ['title', 'description', 'attendees', 'organizer'] } }, required: ['name', 'source'] },
    },
    topic: STR,
  },
  required: ['people', 'companies', 'topic'],
};

const SYSTEM = `You read one calendar event of a business-school student and extract the professionals they will meet.
Return:
- people: the people the student will meet, with role and company only if written or clearly implied (e.g. "PM at Spotify", "(Stripe)", or a company email domain). Use "" when unknown.
  Always include people named in the title or description (match a first name in the title to the attendee with that first name to get the full name).
  From the attendee list: include people from outside the school; include people from the school only if the meeting is small (3 or fewer attendees) or they are named in the title/description.
  Never include the student themself.
- companies: the outside companies the event is about or the people work at (not the student's school, clubs, rooms or buildings).
- topic: one short phrase about what the event is about, or "" if unclear.
Use only the given text. Never guess names or companies that are not written. Attendee names may come from email addresses; the email domain hints at the company (school and personal domains are not companies).`;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function validateExtractInput(body) {
  if (!body || typeof body !== 'object' || !str(body.title, 200)) return { error: 'title is required.' };
  const attendees = Array.isArray(body.attendees)
    ? body.attendees
        .filter((a) => a && typeof a === 'object')
        .slice(0, 30)
        .map((a) => ({ name: str(a.name, 80), domain: str(a.domain, 80).toLowerCase() }))
        .filter((a) => a.name || a.domain)
    : [];
  // Defense in depth: drop anything that still looks like an email.
  const noEmails = (t) => t.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '');
  return {
    input: {
      title: noEmails(str(body.title, 200)),
      description: noEmails(str(body.description, 1500)),
      location: noEmails(str(body.location, 120)),
      organizer: noEmails(str(body.organizer, 120)),
      studentNames: (Array.isArray(body.studentNames) ? body.studentNames : []).map((n) => str(n, 80)).filter(Boolean).slice(0, 3),
      schoolDomains: (Array.isArray(body.schoolDomains) ? body.schoolDomains : []).map((n) => str(n, 80)).filter(Boolean).slice(0, 5),
      attendees,
    },
  };
}

export function buildExtractRequest(input, { model }) {
  const text = [
    `Student (exclude): ${input.studentNames.join(', ') || 'unknown'}`,
    `Student's school email domains: ${input.schoolDomains.join(', ') || 'unknown'}`,
    `Title: ${input.title}`,
    `Description: ${input.description || 'None'}`,
    `Location: ${input.location || 'None'}`,
    `Organizer: ${input.organizer || 'None'}`,
    `Number of attendees: ${input.attendees.length}`,
    `Attendees (name · email domain): ${input.attendees.map((a) => `${a.name || 'unknown name'} · ${a.domain || 'unknown domain'}`).join('; ') || 'None'}`,
  ].join('\n');
  const generationConfig = { temperature: 0, maxOutputTokens: 800, responseMimeType: 'application/json', responseSchema: EXTRACT_SCHEMA };
  if (/^gemini-3/.test(model)) generationConfig.thinkingConfig = { thinkingLevel: 'minimal' };
  return { systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: 'user', parts: [{ text }] }], generationConfig };
}

export function parseExtractResponse(data, input) {
  const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('The AI answer was not valid JSON.');
  }
  const self = new Set((input?.studentNames ?? []).map((n) => n.toLowerCase()));
  const people = (Array.isArray(raw.people) ? raw.people : [])
    .map((p) => ({ name: str(p?.name, 80), role: str(p?.role, 80), company: str(p?.company, 80), source: str(p?.source, 20) || 'description' }))
    .filter((p) => p.name && !self.has(p.name.toLowerCase()))
    .slice(0, 12);
  const companies = (Array.isArray(raw.companies) ? raw.companies : [])
    .map((c) => ({ name: str(c?.name, 80), source: str(c?.source, 20) || 'description' }))
    .filter((c) => c.name)
    .slice(0, 8);
  const u = data?.usageMetadata ?? {};
  return {
    result: { people, companies, topic: str(raw.topic, 200) },
    usage: { inputTokens: u.promptTokenCount ?? 0, outputTokens: Math.max(0, (u.totalTokenCount ?? 0) - (u.promptTokenCount ?? 0)) },
  };
}
