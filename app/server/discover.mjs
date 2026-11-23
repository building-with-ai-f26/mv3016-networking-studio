// Discover: in-person events in New York City that fit the student, from three sources.
// 1) Web: Gemini + Google Search (event sites, company and industry pages, school clubs). Each event keeps its source link.
// 2) Gmail: newsletters and club emails (mailing lists, NYU, CampusGroups, 12Twenty) from the last 30 days. Only NEW
//    emails are read (ids already processed are skipped). Meeting links (Zoom/Meet/Teams) and unsubscribe links are removed
//    before the AI sees the text; event links (Eventbrite, Luma…) are kept.
// 3) CampusGroups: the student's calendar link (iCal), fetched only from campusgroups.com over https.
// Personal emails are never read for this: only bulk / mailing-list / school / club senders.

import { isTrustedHost, trustedEvents } from './eventsources.mjs';

export const DISCOVER_MODEL = process.env.GEMINI_RESEARCH_MODEL || 'gemini-3.8-flash';
export const EXTRACT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const DAY = 24 * 3600_000;
/** How far ahead Discover looks: about 2 months. */
export const WINDOW_DAYS = 62;
const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

const clean = (v, n) => String(v ?? '').replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const profileLine = (s) =>
  [
    s?.careerGoal && `goal: ${clean(s.careerGoal, 200)}`,
    s?.roles?.length && `target roles: ${s.roles.slice(0, 5).map((x) => clean(x, 60)).join(', ')}`,
    s?.industries?.length && `industries: ${s.industries.slice(0, 5).map((x) => clean(x, 60)).join(', ')}`,
    s?.companies?.length && `priority companies: ${s.companies.slice(0, 8).map((x) => clean(x, 60)).join(', ')}`,
    s?.program && `program: ${clean(s.program, 100)}`,
  ]
    .filter(Boolean)
    .join('; ');

// ---------- the event shape every source produces ----------

const EVENT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    events: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          start: { type: 'STRING', description: 'ISO date-time in New York time, e.g. 2026-12-02T18:00:00-05:00; date only if no time' },
          end: { type: 'STRING' },
          venue: { type: 'STRING' },
          organizer: { type: 'STRING' },
          price: { type: 'STRING', description: '"Free" or the price, e.g. "$25"' },
          type: { type: 'STRING', enum: ['networking', 'panel', 'conference', 'workshop', 'info_session', 'other'] },
          inPersonNyc: { type: 'BOOLEAN' },
          why: { type: 'STRING', description: 'one sentence: why it fits this student' },
          link: { type: 'STRING' },
          sourceRefs: { type: 'ARRAY', items: { type: 'INTEGER' } },
        },
        required: ['title', 'start', 'venue', 'organizer', 'price', 'type', 'inPersonNyc', 'why'],
      },
    },
  },
  required: ['events'],
};

const extractRequest = (instructions, text) => ({
  contents: [{ role: 'user', parts: [{ text: `${instructions}\n\n${text}` }] }],
  generationConfig: { temperature: 0.1, maxOutputTokens: 6000, responseMimeType: 'application/json', responseSchema: EVENT_SCHEMA, thinkingConfig: { thinkingLevel: 'minimal' } },
});

/** Keeps only valid, upcoming (next 45 days), in-person NYC events, with a clean shape. */
export function normalizeEvents(raw, { source, sourceLabel, now = Date.now(), linkFor = (e) => e.link }) {
  const out = [];
  for (const e of Array.isArray(raw) ? raw : []) {
    if (!e || typeof e !== 'object' || e.inPersonNyc === false) continue;
    const start = Date.parse(String(e.start ?? ''));
    if (!Number.isFinite(start) || start < now - 3600_000 || start > now + WINDOW_DAYS * DAY) continue;
    const title = clean(e.title, 200);
    if (!title) continue;
    let link = String(linkFor(e) ?? '').trim();
    if (!/^https:\/\//.test(link) || /zoom\.us|meet\.google|teams\.(microsoft|live)|unsubscribe|optout|opt-out/i.test(link)) link = '';
    const price = clean(e.price, 60) || 'Not listed';
    out.push({
      id: `${source}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}-${new Date(start).toISOString().slice(0, 10)}`,
      title,
      start: new Date(start).toISOString(),
      end: Number.isFinite(Date.parse(e.end)) ? new Date(Date.parse(e.end)).toISOString() : '',
      venue: clean(e.venue, 200),
      organizer: clean(e.organizer, 120),
      price,
      free: /^free\b/i.test(price),
      type: ['networking', 'panel', 'conference', 'workshop', 'info_session'].includes(e.type) ? e.type : 'other',
      why: clean(e.why, 300),
      link: link.slice(0, 1000),
      source,
      sourceLabel: clean(sourceLabel, 80),
    });
  }
  return out;
}

// ---------- 1) web ----------

export function webSearchPrompt(student, now = Date.now()) {
  return `Today is ${today(now)}. Find upcoming IN-PERSON networking events, panels, meetups, talks and conferences in New York City in the next 2 months that fit a business-school (MBA) student (${profileLine(student) || 'interested in business and tech'}).
Search event sites (Luma, Eventbrite, Meetup), company and industry event pages, professional associations, and NYC business-school club events open to students. Prefer events where the student can meet people working at the priority companies, in the target roles or industries.
Write under the heading "Events", one event per bullet ("- "): event name, date and time, venue and neighborhood, organizer, price (Free or the price), and one sentence on why it fits this student. Only events whose own page shows a date in the next 2 months and a New York City venue. Skip online-only events. 12-20 events, spread over the 2 months.`;
}

/**
 * Web source: real events from Eventbrite, Luma and Meetup (their own structured data), filtered for New York City,
 * in person, next 2 months, no spam; the AI only rates relevance from each event's real description.
 */
export async function webEvents(student, call, now = Date.now()) {
  return trustedEvents(student, profileLine(student), call, EXTRACT_MODEL, now);
}

const STOPW = new Set(['the', 'and', 'for', 'with', 'nyc', 'new', 'york', 'city', 'event', 'events', '2026', '2027', 'tickets', 'eventbrite', 'luma', 'meetup']);
const titleWords = (t) => new Set(String(t ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOPW.has(w)));
/** True when a page title is about this event (most of the event's words appear in it). */
export function sameEvent(pageTitle, eventTitle) {
  const a = titleWords(eventTitle);
  const b = titleWords(pageTitle);
  if (!a.size || !b.size) return false;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size) >= 0.5;
}

/** Public https hosts only (never local or private network addresses). */
export function safePublicUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')) return null;
    return u;
  } catch {
    return null;
  }
}

/**
 * Opens a search-result link (Google's redirect) and keeps it only if the page is really about this event.
 * Returns the final page URL, or '' when the page is about something else (e.g. a list of other events).
 */
export async function verifyEventLink(link, title) {
  if (!safePublicUrl(link)) return '';
  try {
    const r = await fetch(link, { redirect: 'follow', signal: AbortSignal.timeout(8_000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NetworkingStudio/1.0)', Accept: 'text/html' } });
    const final = safePublicUrl(r.url);
    if (!r.ok || !final) return '';
    const html = (await r.text()).slice(0, 300_000);
    const pageTitle = [html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1], html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]].filter(Boolean).join(' ');
    return sameEvent(pageTitle.replace(/&amp;/g, '&'), title) ? final.toString() : '';
  } catch {
    return '';
  }
}

/** A newsletter link that really opens this event: trusted platform or school/club site, and the page is about it. */
export async function verifyNewsletterLink(link, title) {
  if (!safePublicUrl(link)) return '';
  try {
    const r = await fetch(link, { redirect: 'follow', signal: AbortSignal.timeout(8_000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NetworkingStudio/1.0)', Accept: 'text/html' } });
    const final = safePublicUrl(r.url);
    if (!r.ok || !final) return '';
    const host = final.hostname;
    if (!isTrustedHost(host) && !/(\.edu|campusgroups\.com|12twenty\.com)$/i.test(host)) return '';
    const html = (await r.text()).slice(0, 300_000);
    const pageTitle = [html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1], html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]].filter(Boolean).join(' ');
    return sameEvent(pageTitle.replace(/&amp;/g, '&'), title) ? final.toString() : '';
  } catch {
    return '';
  }
}

export function parseEventsJson(data) {
  const u = data?.usageMetadata ?? {};
  const usage = { inputTokens: u.promptTokenCount ?? 0, outputTokens: Math.max((u.totalTokenCount ?? 0) - (u.promptTokenCount ?? 0), 0) };
  try {
    const j = JSON.parse((data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join(''));
    return { events: Array.isArray(j.events) ? j.events : [], usage };
  } catch {
    return { events: [], usage };
  }
}

// ---------- 2) newsletters and club emails ----------

const EVENT_WORDS = '(event OR events OR RSVP OR register OR registration OR panel OR mixer OR networking OR conference OR summit OR "info session" OR "coffee chat" OR "fireside chat" OR workshop OR "happy hour")';
export const NEWSLETTER_QUERY = `newer_than:30d -in:sent -in:chats ${EVENT_WORDS}`;
const SCHOOL_OR_CLUB = /(\.edu$|campusgroups|12twenty|groups\.google|googlegroups|eventbrite|lu\.ma|luma|meetup)/i;

/** A newsletter, mailing list or club / school / event-platform email (never a personal 1:1 email). */
export function isBulkOrClub(headers) {
  const h = (n) => headers.find((x) => x.name?.toLowerCase() === n)?.value ?? '';
  const fromDomain = (h('from').match(/@([^>\s]+)/)?.[1] ?? '').toLowerCase();
  return Boolean(h('list-unsubscribe') || h('list-id') || /bulk|list/i.test(h('precedence')) || SCHOOL_OR_CLUB.test(fromDomain));
}

const b64 = (s) => Buffer.from(String(s ?? '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

/** Plain text of an email (text/plain preferred; HTML stripped otherwise), with its links listed. */
export function emailText(payload) {
  const parts = [];
  const walk = (p) => {
    if (!p) return;
    if (p.parts) p.parts.forEach(walk);
    else if (p.body?.data && /^text\/(plain|html)/.test(p.mimeType ?? '')) parts.push({ type: p.mimeType, text: b64(p.body.data) });
  };
  walk(payload);
  const plain = parts.find((p) => p.type.startsWith('text/plain'))?.text;
  const html = parts.find((p) => p.type.startsWith('text/html'))?.text ?? '';
  const text = plain ?? html.replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gis, '$2 ($1)').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/h\d>/gi, '\n').replace(/<[^>]+>/g, ' ');
  return cleanEmailText(text);
}

/** Removes meeting and unsubscribe links, email addresses and phone numbers; keeps event links. */
export function cleanEmailText(text) {
  return String(text ?? '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/https?:\/\/\S*(zoom\.us|meet\.google|teams\.microsoft|teams\.live|unsubscribe|optout|opt-out|manage-preferences|email-preferences)\S*/gi, '[link removed]')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\+?\d[\d\s().-]{8,}\d/g, '[number]')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, 8000);
}

async function gmail(token, path) {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw Object.assign(new Error(`Gmail returned an error (${r.status}).`), { status: r.status === 401 ? 401 : 502 });
  return r.json();
}

/**
 * Reads NEW newsletters / club emails about events (skips ids in `processed`) and extracts NYC in-person events.
 * Returns { events, processed: [all ids looked at], usage }.
 */
export async function newsletterEvents(token, student, processed, call, now = Date.now()) {
  const done = new Set(Array.isArray(processed) ? processed.map(String) : []);
  const usage = { inputTokens: 0, outputTokens: 0, searches: 0 };
  const list = await gmail(token, `/messages?maxResults=60&q=${encodeURIComponent(NEWSLETTER_QUERY)}`);
  const ids = (list.messages ?? []).map((m) => String(m.id)).filter((id) => !done.has(id)).slice(0, 40);
  const metas = await Promise.all(ids.map((id) => gmail(token, `/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=List-Unsubscribe&metadataHeaders=List-Id&metadataHeaders=Precedence`).catch(() => null)));
  const chosen = metas.filter((m) => m && isBulkOrClub(m.payload?.headers ?? [])).slice(0, 20);
  const events = [];
  let withEvents = 0;
  for (const m of chosen) {
    const full = await gmail(token, `/messages/${encodeURIComponent(m.id)}?format=full`).catch(() => null);
    if (!full) continue;
    const headers = full.payload?.headers ?? [];
    const from = (headers.find((h) => h.name?.toLowerCase() === 'from')?.value ?? '').replace(/<[^>]+>/, '').replace(/"/g, '').trim();
    const subject = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value ?? '';
    const text = emailText(full.payload);
    if (text.length < 40) continue;
    const r = await call(
      extractRequest(
        `This is a newsletter or club email received ${new Date(Number(full.internalDate ?? now)).toISOString().slice(0, 10)} (today is ${today(now)}). Extract every event it announces that is IN PERSON in New York City and still upcoming. For each: title, start (ISO, New York time; use the email's year when missing), end, venue, organizer (the club or company), price ("Free" or the price), type, inPersonNyc, link (the event's registration or page URL from the text, never a meeting link), and "why" = one sentence on why it fits this student (${profileLine(student) || 'MBA student'}). If there are no such events, return an empty list. Never invent events or details.`,
        `From: ${clean(from, 120)}\nSubject: ${clean(subject, 200)}\n\n${text}`,
      ),
      EXTRACT_MODEL,
      45_000,
    );
    if (!r.ok) continue;
    const p = parseEventsJson(r.data);
    usage.inputTokens += p.usage.inputTokens;
    usage.outputTokens += p.usage.outputTokens;
    const label = /campusgroups/i.test(from) ? 'CampusGroups' : /12twenty/i.test(from) ? '12Twenty' : clean(from, 60) || 'Newsletter';
    const found = normalizeEvents(p.events, { source: 'email', sourceLabel: `Email · ${label}`, now });
    // Newsletter links are often tracking redirects: keep a link only if it opens this event's own page on a trusted
    // platform or a school/club site; otherwise the button opens the email in Gmail (the real source).
    await Promise.all(
      found.map(async (e) => {
        e.emailId = String(m.id);
        e.link = e.link ? await verifyNewsletterLink(e.link, e.title) : '';
      }),
    );
    if (found.length) withEvents++;
    events.push(...found);
  }
  // Only mark as read the emails actually looked at (bulk/club ones and the personal ones skipped on purpose).
  return { events, processed: [...done, ...ids].slice(-1000), usage, stats: { newEmails: ids.length, newsletters: chosen.length, withEvents } };
}

// ---------- 3) CampusGroups calendar (iCal) ----------

/** Only https links on campusgroups.com (blocks requests to other or internal hosts). */
export function validIcalUrl(raw) {
  try {
    const u = new URL(String(raw ?? '').trim().replace(/^webcal:\/\//i, 'https://'));
    if (u.protocol !== 'https:' || !/(^|\.)campusgroups\.com$/i.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const unfold = (ics) => String(ics).replace(/\r?\n[ \t]/g, '');
const icsValue = (v) => String(v ?? '').replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
function icsDate(v) {
  const m = String(v ?? '').match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return '';
  const [, y, mo, d, h = '00', mi = '00', s = '00', z] = m;
  if (z) return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
  // Times without "Z" are New York local time (CampusGroups calendars for NYU): -05:00 in winter, -04:00 in summer.
  const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  const off = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(new Date(guess)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-5';
  const hours = Number(off.replace('GMT', '') || -5);
  return new Date(guess - hours * 3600_000).toISOString();
}

/** Parses the iCal text into raw events (VEVENT: SUMMARY, DTSTART, DTEND, LOCATION, URL, DESCRIPTION). */
export function parseIcal(text) {
  const out = [];
  for (const block of unfold(text).split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0];
    const get = (k) => body.match(new RegExp(`^${k}(?:;[^:\\n]*)?:(.*)$`, 'm'))?.[1] ?? '';
    const location = icsValue(get('LOCATION'));
    out.push({
      title: icsValue(get('SUMMARY')),
      start: icsDate(get('DTSTART')),
      end: icsDate(get('DTEND')),
      venue: location,
      organizer: icsValue(get('ORGANIZER')).replace(/^.*CN=/i, '').replace(/[:;].*$/, ''),
      price: 'Not listed',
      type: 'other',
      inPersonNyc: !/zoom|online|virtual|webinar|teams|meet\.google/i.test(location),
      why: '',
      link: icsValue(get('URL')),
    });
  }
  return out;
}

export async function icalEvents(url, now = Date.now()) {
  const safe = validIcalUrl(url);
  if (!safe) throw Object.assign(new Error('Use your CampusGroups calendar link (https://….campusgroups.com/…).'), { status: 400 });
  const r = await fetch(safe, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
  if (!r.ok) throw Object.assign(new Error(`CampusGroups returned an error (${r.status}).`), { status: 502 });
  const text = (await r.text()).slice(0, 2_000_000);
  return { events: normalizeEvents(parseIcal(text), { source: 'campusgroups', sourceLabel: 'CampusGroups', now }) };
}
