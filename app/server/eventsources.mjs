// Real events from trusted platforms, read from their own structured data (schema.org Event in JSON-LD).
// No AI invents events here: name, date, address, link and organizer come from the platform's page.
//   1) Eventbrite NYC topic pages (/d/ny--new-york/<topic>/), Meetup NYC search, Luma NYC page → candidate events.
//   2) Validation: trusted host, in person, scheduled (not cancelled), New York City address, next 2 months, no spam.
//   3) The AI only scores relevance to the student from the event's real description (and writes "why it fits").
//   4) The best ones are opened on their own page for the exact time, organizer and price.

const DAY = 24 * 3600_000;
export const WINDOW_DAYS = 62;
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; NetworkingStudio/1.0)', Accept: 'text/html' };

/** Hosts whose event pages we trust (official event platforms). */
export const TRUSTED_HOSTS = [/(^|\.)eventbrite\.com$/, /(^|\.)lu\.ma$/, /(^|\.)luma\.com$/, /(^|\.)meetup\.com$/, /(^|\.)partiful\.com$/];
export const isTrustedHost = (host) => TRUSTED_HOSTS.some((r) => r.test(String(host).toLowerCase()));
export const platformOf = (url) => {
  const h = new URL(url).hostname;
  return /eventbrite/.test(h) ? 'Eventbrite' : /meetup/.test(h) ? 'Meetup' : /partiful/.test(h) ? 'Partiful' : 'Luma';
};

/** Only public https addresses (no localhost, private IPs, IPv6 literals or user:pass@). */
export function publicHttpsUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':') || h.includes('[') || !h.includes('.')) return null;
    return u;
  } catch {
    return null;
  }
}

/**
 * fetch() that follows redirects itself (max 5) and checks every hop with publicHttpsUrl, so a link can't bounce the
 * server to an internal address (SSRF). Returns the response with `finalUrl`.
 */
export async function safeFetch(url, init = {}, hops = 5) {
  let current = publicHttpsUrl(url);
  for (let i = 0; current && i <= hops; i++) {
    const r = await fetch(current, { ...init, redirect: 'manual' });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      current = publicHttpsUrl(new URL(r.headers.get('location'), current).toString());
      continue;
    }
    return Object.assign(r, { finalUrl: current.toString() });
  }
  throw new Error('Blocked or too many redirects');
}

const NYC_PLACES = ['new york', 'manhattan', 'brooklyn', 'queens', 'bronx', 'staten island', 'long island city', 'kings county', 'new york county', 'queens county'];
/** New York City: by city / borough name or by NYC ZIP code (100–104, 110–114, 116). */
export function isNyc(address) {
  const a = address ?? {};
  const city = String(a.addressLocality ?? '').toLowerCase();
  const zip = String(a.postalCode ?? '').slice(0, 3);
  const region = String(a.addressRegion ?? '').toLowerCase();
  const ny = !region || region === 'ny' || region === 'new york';
  return ny && (NYC_PLACES.some((p) => city.includes(p)) || ['100', '101', '102', '103', '104', '110', '111', '112', '113', '114', '116'].includes(zip));
}

/** Typical junk: dating, get-rich, giveaways, and SEO titles stuffed with keywords ("Mixer | PE | VC | Law | Fintech"). */
export function looksLikeSpam(name, organizer = '') {
  const t = `${name} ${organizer}`.toLowerCase();
  if (/speed dating|singles|dating|make money|passive income|get rich|giveaway|free money|forex|crypto signals|mlm|network marketing|sugar|bottle service|club night|party bus/.test(t)) return true;
  // Promoters of generic paid "networking nights" (not professional communities).
  if (/business minds|fun events|business founders group|nomad global|networking affair|meet & mingle|eventsfy|nyc business networking events|founders club|allevents/.test(t)) return true;
  return (String(name).match(/\|/g) ?? []).length >= 3;
}

/** All schema.org Events on a page (direct, in @graph, or inside an ItemList). */
export function eventsFromHtml(html) {
  const out = [];
  for (const m of String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let j;
    try {
      j = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const nodes = Array.isArray(j) ? j : j['@graph'] ? j['@graph'] : [j];
    for (const x of nodes) {
      const type = [].concat(x?.['@type'] ?? []);
      if (type.some((t) => /Event$/.test(t))) out.push(x);
      if (type.includes('ItemList')) for (const li of x.itemListElement ?? []) if ([].concat(li?.item?.['@type'] ?? []).some((t) => /Event$/.test(t))) out.push(li.item);
    }
  }
  return out;
}

/** One schema.org Event → our candidate, or null when it fails a rule. */
export function toCandidate(e, now = Date.now()) {
  const url = String(e.url ?? e['@id'] ?? '');
  let host;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    host = u.hostname;
  } catch {
    return null;
  }
  if (!isTrustedHost(host)) return null;
  const name = String(e.name ?? '').replace(/\s+/g, ' ').trim();
  const start = Date.parse(String(e.startDate ?? ''));
  if (!name || !Number.isFinite(start) || start < now - 6 * 3600_000 || start > now + WINDOW_DAYS * DAY) return null;
  if (/Online/i.test(String(e.eventAttendanceMode ?? ''))) return null;
  if (/Cancelled|Postponed|MovedOnline/i.test(String(e.eventStatus ?? ''))) return null;
  const place = [].concat(e.location ?? [])[0] ?? {};
  if (!isNyc(place.address)) return null;
  const organizer = String([].concat(e.organizer ?? [])[0]?.name ?? '').trim();
  if (looksLikeSpam(name, organizer)) return null;
  const a = place.address ?? {};
  const offer = [].concat(e.offers ?? [])[0] ?? {};
  const low = Number(offer.lowPrice ?? offer.price);
  const free = e.isAccessibleForFree === true || offer.price === '0' || offer.price === 0 || low === 0;
  return {
    url,
    name: name.slice(0, 200),
    start: new Date(start).toISOString(),
    dateOnly: /^\d{4}-\d{2}-\d{2}$/.test(String(e.startDate)),
    end: Number.isFinite(Date.parse(e.endDate)) ? new Date(Date.parse(e.endDate)).toISOString() : '',
    venue: [place.name, a.streetAddress, a.addressLocality].filter((x, i, arr) => x && arr.indexOf(x) === i).join(', ').slice(0, 200),
    organizer: organizer.slice(0, 120),
    price: free ? 'Free' : Number.isFinite(low) && low > 0 ? 'Paid' : 'Not listed',
    description: String(e.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400),
    platform: platformOf(url),
  };
}

async function fetchHtml(url) {
  const r = await safeFetch(url, { signal: AbortSignal.timeout(12_000), headers: UA });
  if (r.status === 429) throw Object.assign(new Error('rate limited'), { rateLimited: true });
  if (!r.ok) return '';
  return (await r.text()).slice(0, 3_000_000);
}

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
/** Reads a platform's pages one at a time with a short pause (polite); stops that platform if it says "too many requests". */
async function politeFetchAll(urls, fetcher, gapMs) {
  const out = [];
  for (const u of urls) {
    try {
      out.push(await fetcher(u));
    } catch (e) {
      if (e?.rateLimited) break;
      out.push('');
    }
    if (gapMs) await pause(gapMs);
  }
  return out;
}

const slug = (s) => String(s).toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Topics to look for, from the profile: target roles, industries, priority companies, plus networking for MBAs. */
export function topicsFor(student) {
  const roles = (student?.roles ?? []).map((r) => r.replace(/\b(manager|lead|associate|analyst)\b/gi, '').trim()).filter(Boolean);
  const industries = (student?.industries ?? []).flatMap((x) => x.split(/[&/,]| and /)).map((x) => x.trim()).filter(Boolean);
  const companies = student?.companies ?? [];
  const all = [...roles.slice(0, 3), ...industries.slice(0, 4), ...companies.slice(0, 3), 'conference', 'mba'];
  return [...new Set(all.map((x) => x.toLowerCase()))].slice(0, 10);
}

/** The listing pages to read (Eventbrite and Meetup per topic, Luma's NYC page). */
export function listingUrls(topics) {
  const urls = new Set(['https://luma.com/nyc']);
  for (const t of topics) {
    urls.add(`https://www.eventbrite.com/d/ny--new-york/${slug(t)}/`);
    urls.add(`https://www.meetup.com/find/?location=us--ny--new-york&source=EVENTS&keywords=${encodeURIComponent(t)}`);
  }
  return [...urls].slice(0, 21);
}

/** Reads every listing page and returns valid, de-duplicated candidates. */
export async function collectCandidates(student, now = Date.now(), fetcher = fetchHtml, gapMs = 1200) {
  const urls = listingUrls(topicsFor(student));
  const byHost = (re) => urls.filter((u) => re.test(u));
  // Platforms in parallel; each platform's pages one at a time.
  const pages = (await Promise.all([politeFetchAll(byHost(/eventbrite/), fetcher, gapMs), politeFetchAll(byHost(/meetup/), fetcher, gapMs), politeFetchAll(byHost(/luma/), fetcher, 0)])).flat();
  const byUrl = new Map();
  for (const html of pages) for (const e of eventsFromHtml(html)) {
    const c = toCandidate(e, now);
    if (c && !byUrl.has(c.url.split('?')[0])) byUrl.set(c.url.split('?')[0], { ...c, url: c.url.split('?')[0] });
  }
  return [...byUrl.values()];
}

/** Opens an event's own page for the exact time, organizer and price (listings sometimes only give the day). */
export async function enrich(candidate, now = Date.now(), fetcher = fetchHtml) {
  const html = await fetcher(candidate.url).catch(() => '');
  const own = eventsFromHtml(html).map((e) => toCandidate({ ...e, url: e.url ?? candidate.url }, now)).find(Boolean);
  if (!own) return candidate.dateOnly ? null : candidate; // can't confirm the page now: keep only if the listing already had the time
  return { ...candidate, ...own, url: candidate.url, description: own.description || candidate.description, dateOnly: own.dateOnly };
}

/** The AI request that scores relevance from the real descriptions (it never adds events). */
export function relevanceRequest(candidates, profileLine) {
  const list = candidates.map((c, i) => `#${i} | ${c.name} | ${c.organizer || 'organizer n/a'} | ${c.start.slice(0, 10)} | ${c.platform} | ${c.description.slice(0, 280)}`).join('\n');
  return {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `A business-school (MBA) student in New York (${profileLine || 'interested in business and tech'}) wants professional networking events, panels, talks and conferences that help their recruiting.
Rate each event below (from Eventbrite, Luma or Meetup) using ONLY its title, organizer and description:
- relevance 0-100: how useful for THIS student's target roles, industries and companies (100 = about their priority companies or exactly their field; low for unrelated topics, hobbies, parties, dating, generic sales pitches);
- credible: false for generic mass "networking mixers/nights" run by event promoters (not by a company, community or school), paid seminars selling a product or course, MLM, or anything that looks low quality; true for events hosted by companies, universities and business schools, professional associations, established communities (e.g. Startup Grind, Women Who Code, Product School) and recognized industry conferences;
- type: networking | panel | conference | workshop | info_session | other;
- why: one sentence on why it fits this student (only if relevance >= 50).
Return entries ONLY for events with relevance >= 50 (skip the rest), each with its #index.

${list}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8000,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: { ratings: { type: 'ARRAY', items: { type: 'OBJECT', properties: { index: { type: 'INTEGER' }, relevance: { type: 'INTEGER' }, credible: { type: 'BOOLEAN' }, type: { type: 'STRING' }, why: { type: 'STRING' } }, required: ['index', 'relevance', 'credible', 'type'] } } },
        required: ['ratings'],
      },
      thinkingConfig: { thinkingLevel: 'minimal' },
    },
  };
}

export const MIN_RELEVANCE = 65;

/**
 * Full pipeline: real candidates → AI relevance (from their real descriptions) → own-page details for the kept ones.
 * `call(body, model, timeoutMs)` performs one Gemini request. Returns { events, usage, stats }.
 */
export async function trustedEvents(student, profileLine, call, model, now = Date.now(), fetcher = fetchHtml, gapMs = 1200) {
  const usage = { inputTokens: 0, outputTokens: 0, searches: 0 };
  const candidates = (await collectCandidates(student, now, fetcher, gapMs)).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 220);
  if (!candidates.length) return { events: [], usage, stats: { candidates: 0, relevant: 0 } };
  // Rate in batches of 55, in parallel (one big answer would be cut off).
  const BATCH = 55;
  const batches = [];
  for (let i = 0; i < candidates.length; i += BATCH) batches.push(i);
  const results = await Promise.all(batches.map((offset) => call(relevanceRequest(candidates.slice(offset, offset + BATCH), profileLine), model, 60_000).then((r) => ({ r, offset }))));
  let ratings = [];
  for (const { r, offset } of results) {
    if (!r.ok) continue;
    const u = r.data?.usageMetadata ?? {};
    usage.inputTokens += u.promptTokenCount ?? 0;
    usage.outputTokens += Math.max((u.totalTokenCount ?? 0) - (u.promptTokenCount ?? 0), 0);
    try {
      const list = JSON.parse((r.data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')).ratings ?? [];
      ratings.push(...list.map((x) => ({ ...x, index: Number(x.index) + offset })));
    } catch {
      // a batch that failed to parse is skipped
    }
  }
  if (!results.some(({ r }) => r.ok)) return { events: [], usage, stats: { candidates: candidates.length, relevant: 0 }, error: results[0]?.r.status };
  const kept = ratings
    .filter((x) => Number.isInteger(x.index) && candidates[x.index] && x.credible === true && Number(x.relevance) >= MIN_RELEVANCE)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 30)
    .map((x) => ({ ...candidates[x.index], relevance: Number(x.relevance), type: ['networking', 'panel', 'conference', 'workshop', 'info_session'].includes(x.type) ? x.type : 'other', why: String(x.why ?? '').slice(0, 300) }));
  // Exact time, organizer and price from each event's own page (in small batches, to be polite to the platforms).
  const detailed = [];
  for (let i = 0; i < kept.length; i += 4) {
    detailed.push(...(await Promise.all(kept.slice(i, i + 4).map((c) => enrich(c, now, fetcher).catch(() => (c.dateOnly ? null : c)).then((d) => (d ? { ...d, relevance: c.relevance, type: c.type, why: c.why } : null))))));
    if (gapMs) await pause(gapMs / 2);
  }
  const events = detailed.filter(Boolean).map((c) => ({
    id: `web-${c.url.replace(/^https:\/\/(www\.)?/, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 80)}`,
    title: c.name,
    start: c.start,
    end: c.end,
    venue: c.venue,
    organizer: c.organizer,
    price: c.price,
    free: c.price === 'Free',
    type: c.type,
    why: c.why,
    link: c.url,
    source: 'web',
    sourceLabel: `✓ ${c.platform}`,
    relevance: c.relevance,
  }));
  return { events, usage, stats: { candidates: candidates.length, relevant: kept.length, shown: events.length } };
}
