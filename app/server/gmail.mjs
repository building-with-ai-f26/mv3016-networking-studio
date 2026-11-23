// Gmail for Networking Studio (server only; the token never reaches the browser).
// - Read: find emails related to an event (person / company / title) in the last 6 months. Shown to the user only;
//   nothing goes to the AI unless the user clicks "Use in brief".
// - Write: the AI drafts an email; the user edits it; it is saved as a Gmail draft or sent ONLY after the user clicks
//   Send and confirms. Only drafts created by this app in this session can be sent from the app.
// - Permissions: gmail.readonly + gmail.compose (no delete). Every route is rate limited and CSRF-checked in index.mjs.

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** Gmail search for an event: quoted names, recent mail, no chats. Strips characters that change the search. */
export function buildSearchQuery({ person = '', company = '', title = '' }) {
  const term = (s) =>
    String(s)
      .replace(/[^\p{L}\p{N} .&'-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
  const parts = [
    ...String(person)
      .split(/[,;]/)
      .map(term)
      .filter((x) => x.split(' ').length >= 2),
    ...String(company)
      .split(/[,;]/)
      .map(term)
      .filter((x) => x.length >= 2),
  ].slice(0, 6);
  if (!parts.length && term(title).length >= 4) parts.push(term(title));
  if (!parts.length) return '';
  return `(${parts.map((p) => `"${p}"`).join(' OR ')}) newer_than:180d -in:chats`;
}

const header = (msg, name) => (msg.payload?.headers ?? []).find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

/** "Jordan Lee <jordan@acme.com>" → { name: 'Jordan Lee', email: 'jordan@acme.com', domain: 'acme.com' } */
export function parseFrom(value) {
  const v = String(value ?? '');
  const email = (v.match(/<([^>]+)>/)?.[1] ?? v).trim().toLowerCase();
  const name = v.replace(/<[^>]+>/, '').replace(/"/g, '').trim() || email.split('@')[0];
  return { name: name.slice(0, 120), email: EMAIL.test(email) ? email : '', domain: email.split('@')[1] ?? '' };
}

export function summarizeMessage(msg) {
  const from = parseFrom(header(msg, 'From'));
  return {
    id: String(msg.id ?? ''),
    subject: header(msg, 'Subject').slice(0, 200),
    fromName: from.name,
    fromEmail: from.email,
    fromDomain: from.domain,
    date: header(msg, 'Date').slice(0, 60),
    snippet: String(msg.snippet ?? '')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .slice(0, 300),
  };
}

async function gmailFetch(token, path, init = {}) {
  const r = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error(`[gmail] ${path.split('?')[0]} → ${r.status}`);
    const e = new Error(r.status === 403 ? 'Gmail refused the request. Reconnect Gmail in Settings.' : `Gmail returned an error (${r.status}).`);
    e.status = r.status === 401 ? 401 : 502;
    throw e;
  }
  return data;
}

/** Up to 8 recent emails related to the event (metadata and a short snippet only). */
export async function findRelated(token, event) {
  const q = buildSearchQuery(event);
  if (!q) return { query: '', emails: [] };
  const list = await gmailFetch(token, `/messages?maxResults=8&q=${encodeURIComponent(q)}`);
  const ids = (list.messages ?? []).map((m) => m.id).slice(0, 8);
  const emails = await Promise.all(ids.map((id) => gmailFetch(token, `/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`).then(summarizeMessage)));
  return { query: q, emails };
}

// ---------- writing ----------

export const EMAIL_KINDS = {
  thanks: 'a short thank-you note after the event, mentioning one specific thing they said or did, and keeping the door open',
  followup: 'a follow-up a few days later that references the conversation and asks one clear next step',
  coffee: 'a request for a 20-minute coffee chat, explaining in one sentence why them specifically',
  intro: 'a short note before the event to introduce yourself and say what you hope to learn',
};

/** Validates the user's recipients: 1-5 plain email addresses, no names or line breaks. */
export function validRecipients(to) {
  const list = String(to ?? '')
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (!list.length || list.length > 5 || !list.every((x) => EMAIL.test(x) && x.length <= 254)) return null;
  return list;
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const b64url = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Builds the raw email (RFC 2822). Subject and recipients can't contain line breaks (no header injection). */
export function buildRawEmail({ to, subject, body }) {
  const recipients = validRecipients(Array.isArray(to) ? to.join(',') : to);
  if (!recipients) throw new Error('Check the recipient: 1-5 email addresses.');
  const subj = String(subject ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  if (!subj) throw new Error('Add a subject.');
  const text = String(body ?? '').replace(/\r\n/g, '\n').slice(0, 10_000);
  if (!text.trim()) throw new Error('The email is empty.');
  const mime = [`To: ${recipients.join(', ')}`, `Subject: =?UTF-8?B?${b64(subj)}?=`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', b64(text)].join('\r\n');
  return b64url(mime);
}

/** Drafts created by the app, per user (only these can be sent from the app). Kept in memory. */
const appDrafts = new Map();

export async function createDraft(token, userEmail, email) {
  const raw = buildRawEmail(email);
  const d = await gmailFetch(token, '/drafts', { method: 'POST', body: JSON.stringify({ message: { raw } }) });
  const set = appDrafts.get(userEmail) ?? new Set();
  set.add(d.id);
  appDrafts.set(userEmail, set);
  return { draftId: d.id };
}

export async function sendDraft(token, userEmail, draftId) {
  if (!appDrafts.get(userEmail)?.has(draftId)) {
    const e = new Error('Save this email as a draft first (only drafts made in the app can be sent from here).');
    e.status = 400;
    throw e;
  }
  const r = await gmailFetch(token, '/drafts/send', { method: 'POST', body: JSON.stringify({ id: draftId }) });
  appDrafts.get(userEmail).delete(draftId);
  // threadId lets the app check later whether the person replied.
  return { messageId: r.id ?? '', threadId: r.threadId ?? '' };
}

/**
 * For emails the user sent from the app: did someone else write in the same thread afterwards?
 * Returns one entry per thread that has a reply: { threadId, repliedAt, fromName, snippet }.
 */
export async function findReplies(token, userEmail, threads) {
  const me = String(userEmail).toLowerCase();
  const list = (Array.isArray(threads) ? threads : []).filter((t) => t && /^[A-Za-z0-9_-]{6,40}$/.test(String(t.threadId))).slice(0, 25);
  const out = [];
  for (const t of list) {
    const sentAt = Date.parse(t.sentAt) || 0;
    const thread = await gmailFetch(token, `/threads/${encodeURIComponent(t.threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=Date`).catch(() => null);
    const reply = (thread?.messages ?? []).find((m) => {
      const from = parseFrom(header(m, 'From'));
      return from.email && from.email !== me && Number(m.internalDate ?? 0) > sentAt;
    });
    if (reply) out.push({ threadId: t.threadId, repliedAt: new Date(Number(reply.internalDate)).toISOString(), fromName: parseFrom(header(reply, 'From')).name, snippet: summarizeMessage(reply).snippet.slice(0, 200) });
  }
  return { replies: out };
}

/** AI note for a LinkedIn invitation (LinkedIn allows up to 300 characters). */
export function linkedinNoteRequest({ language, studentName, studentProgram, name, role, company, eventTitle, comments }) {
  const text = `Write a LinkedIn connection request note from ${studentName || 'a business-school student'}${studentProgram ? ` (${studentProgram})` : ''} to ${name}${role ? `, ${role}` : ''}${company ? ` at ${company}` : ''}, whom they met at "${eventTitle || 'an event'}".
Things the student wants to include: ${comments || 'nothing specific'}.
Rules: in ${language === 'es' ? 'Spanish' : 'English'}; at most 280 characters including spaces; warm and specific; mention the event; no job request; no links, emails or phone numbers; never invent what was said; sign with the student's first name.`;
  return {
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: { temperature: 0.6, maxOutputTokens: 300, responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { note: { type: 'STRING' } }, required: ['note'] }, thinkingConfig: { thinkingLevel: 'minimal' } },
  };
}

export function parseLinkedinNote(data) {
  let j;
  try {
    j = JSON.parse((data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join(''));
  } catch {
    throw new Error('The AI answer was not valid. Try again.');
  }
  let note = String(j.note ?? '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (note.length > 300) note = `${note.slice(0, 297).replace(/\s+\S*$/, '')}…`;
  if (!note) throw new Error('The AI returned an empty note. Try again.');
  const u = data.usageMetadata ?? {};
  return { note, usage: { inputTokens: u.promptTokenCount ?? 0, outputTokens: Math.max((u.totalTokenCount ?? 0) - (u.promptTokenCount ?? 0), 0) } };
}

/** For tests. */
export const _appDrafts = appDrafts;

const LANG = { en: 'English', es: 'Spanish' };

/** Gemini request that writes the email. The brief summary gives specific details; nothing is invented. */
export function composeRequest({ kind, language, studentName, studentProgram, event, briefSummary, notes, recipientName }) {
  const what = EMAIL_KINDS[kind] ?? EMAIL_KINDS.thanks;
  const text = `Write ${what}.
From: ${studentName || 'the student'}${studentProgram ? `, ${studentProgram}` : ''}.
To: ${recipientName || 'the person from the event'}.
Event: ${event.title}${event.company ? ` (${event.company})` : ''}${event.datetime ? `, ${event.datetime}` : ''}.
What the student knows (from their prep brief): ${briefSummary || 'nothing else'}.
Student's own notes about the conversation: ${notes || 'none'}.

Rules: in ${LANG[language] ?? 'English'}; 60-140 words; warm, professional, specific; one clear ask at most; no flattery clichés; never invent what was said at the event (if the notes don't say it, keep it general or use a [bracketed placeholder] for the student to fill); no links, phone numbers or email addresses; sign with the student's first name.`;
  return {
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 1200,
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { subject: { type: 'STRING' }, body: { type: 'STRING' } }, required: ['subject', 'body'] },
      thinkingConfig: { thinkingLevel: 'minimal' },
    },
  };
}

export function parseCompose(data) {
  const t = (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    throw new Error('The AI answer was not valid. Try again.');
  }
  const strip = (s) => String(s ?? '').replace(/https?:\/\/\S+/gi, '').replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '');
  const subject = strip(j.subject).replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  const body = strip(j.body).trim().slice(0, 4000);
  if (!subject || !body) throw new Error('The AI returned an empty email. Try again.');
  const u = data.usageMetadata ?? {};
  return { subject, body, usage: { inputTokens: u.promptTokenCount ?? 0, outputTokens: Math.max((u.totalTokenCount ?? 0) - (u.promptTokenCount ?? 0), 0) } };
}
