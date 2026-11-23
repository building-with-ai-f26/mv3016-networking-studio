// Product Page screenshots with demo data only (fictional people and events). Uses the running dev app
// (npm run dev) and the installed Chrome. All /api calls are answered here, so nothing reaches Google, Gmail or the AI.
// Usage: node e2e/docs-shots.mjs <demo-state.json> <out-dir>
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [statePath, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const BASE = 'http://localhost:5173';
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const NOW = Date.now();
const iso = (d) => new Date(NOW + d * 86400_000).toISOString();
const at = (days, hh) => { const d = new Date(NOW + days * 86400_000); d.setUTCHours(hh + 5, 0, 0, 0); return d.toISOString(); };

// --- fictional contacts at every stage of the follow-up flow ---
const ev = (title, d) => [{ eventId: `demo-${title}`, title, date: iso(d) }];
const base = { lastContact: '', referral: 'not-asked', notes: '', isSample: false };
const contacts = [
  { ...base, id: 'd1', name: 'Morgan Ellis', role: 'Product Lead', company: 'Northwind Payments', sourceKey: 'demo|Morgan Ellis', addedAt: iso(-1), events: ev('Fintech product panel', -1) },
  { ...base, id: 'd2', name: 'Taylor Brooks', role: 'Strategy Manager', company: 'Brightline Media', sourceKey: 'demo|Taylor Brooks', addedAt: iso(-2), events: ev('Media careers mixer', -2) },
  { ...base, id: 'd3', name: 'Jamie Park', role: 'Senior PM', company: 'Cobalt Cloud', addedAt: iso(-12), events: ev('Coffee chat: Jamie <> Alex', -12), email: 'jamie@cobalt.example', emails: [{ threadId: 't3', sentAt: iso(-9), kind: 'thanks', subject: 'Great meeting you' }] },
  { ...base, id: 'd4', name: 'Drew Santos', role: 'Associate', company: 'Ferrum Industrial', addedAt: iso(-6), events: ev('Info session: Ferrum Industrial', -6), email: 'drew@ferrum.example', emails: [{ threadId: 't4', sentAt: iso(-4), kind: 'followup', subject: 'Following up', repliedAt: iso(-1), replySnippet: 'Happy to chat next week…' }] },
  { ...base, id: 'd5', name: 'Robin Hale', role: 'Director of Product', company: 'Northwind Payments', addedAt: iso(-8), events: ev('Alumni breakfast', -8), linkedinAt: iso(-7), coffeeAt: iso(0) },
  { ...base, id: 'd6', name: 'Quinn Abara', role: 'VP Growth', company: 'Brightline Media', addedAt: iso(-20), events: ev('Media careers mixer', -20), linkedinAt: iso(-19) },
];

// --- fictional Discover events (fictional organizers, example links) ---
const dEvent = (id, title, d, hh, organizer, type, why, extra = {}) => ({ id, title, start: at(d, hh), end: at(d, hh + 2), venue: 'Manhattan, New York, NY', organizer, price: 'Free', free: true, type, why, link: `https://www.eventbrite.com/e/${id}`, source: 'web', sourceLabel: '✓ Eventbrite', foundAt: iso(0), relevance: 80, ...extra });
const discoverEvents = [
  dEvent('demo-fintech-summit', 'NYC Payments Product Summit', 3, 9, 'Northwind Fintech Forum', 'conference', 'Payments product leaders on launching at scale: matches your Product Management + Fintech goals.', { relevance: 94 }),
  dEvent('demo-ai-pm', 'AI Product Managers Meetup', 4, 18, 'Cobalt PM Circle', 'networking', 'PMs building AI products; good for your Technology & AI focus.', { link: 'https://www.meetup.com/demo-ai-pm/events/1/', sourceLabel: '✓ Meetup', relevance: 88 }),
  dEvent('demo-media-panel', 'Streaming & Ads Strategy Panel', 9, 18, 'Brightline Media Club', 'panel', 'Ad-supported streaming strategy, close to your Media & Entertainment interest.', { price: 'Paid', free: false, relevance: 82 }),
  dEvent('demo-club-night', 'Product Club: Office Hours with Alumni', 10, 19, 'Stern Product Club', 'networking', 'Alumni PMs answer recruiting questions.', { link: '', source: 'email', sourceLabel: 'Email · Product Club', emailId: 'demo123456', relevance: 78 }),
  dEvent('demo-industrial', 'Industrial Tech Innovation Night', 16, 18, 'Ferrum Innovation Lab', 'panel', 'Industrial technology and innovation roles, matches your target industries.', { link: 'https://luma.com/demo-industrial', sourceLabel: '✓ Luma', relevance: 76 }),
];

const signedState = { ...state, contacts, onboarded: true, discover: { ...state.discover, events: discoverEvents, lastWebAt: iso(0), lastMailAt: iso(0), dismissed: [] } };

async function fakeApi(ctx, signedIn) {
  await ctx.route('**/api/**', async (route) => {
    const u = new URL(route.request().url());
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/me') return json(signedIn ? { configured: true, signedIn: true, email: 'alex.demo@example.com', name: 'Alex Demo', calendarConnected: true, gmailConnected: true } : { configured: true, signedIn: false });
    if (u.pathname === '/api/state') return json(route.request().method() === 'GET' ? { state: signedState } : { ok: true });
    if (u.pathname === '/api/calendar/events') return json({ events: [] });
    if (u.pathname.startsWith('/api/gmail')) return json({ emails: [], replies: [], activity: [], addresses: [] });
    if (u.pathname.startsWith('/api/discover')) return json({ events: [], processed: [], stats: {} });
    return json({ error: 'not in screenshot mode' }, 404);
  });
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const shots = [];
async function shot(page, name, { full = false, clip } = {}) {
  await page.waitForTimeout(700);
  const text = await page.evaluate(() => document.body.innerText);
  shots.push({ name, text });
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full, clip });
}
try {
  // Demo mode: calendar + the real AI brief (generated earlier for the fictional event "Info session: Netflix Ads").
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await ctx.addInitScript((s) => { localStorage.setItem('networking-studio:demo-mode', '1'); localStorage.setItem('networking-studio:v1', s); }, JSON.stringify(state));
    await fakeApi(ctx, false);
    const page = await ctx.newPage();
    const id = Object.keys(state.aiBriefs)[0];
    await page.goto(`${BASE}/events/${id}`);
    await page.waitForSelector('text=Netflix', { timeout: 15000 });
    await shot(page, '12-brief-v3-top');
    const sections = await page.$$eval('h2, h3', (hs) => hs.map((h) => ({ t: h.textContent, y: h.getBoundingClientRect().top + window.scrollY })));
    console.log(JSON.stringify(sections));
    for (const [label, re] of [['13-brief-v3-business', /logic of the business/i], ['14-brief-v3-questions', /questions/i]]) {
      const s = sections.find((x) => re.test(x.t ?? ''));
      if (!s) { console.log('missing section', label); continue; }
      await page.evaluate((y) => window.scrollTo(0, y - 90), s.y);
      await shot(page, label);
    }
    // citation popup
    await page.evaluate(() => window.scrollTo(0, 0));
    const cite = page.locator('button.cite, [data-cite], sup button').first();
    if (await cite.count()) { await cite.scrollIntoViewIfNeeded(); await cite.click(); await page.evaluate(() => window.scrollBy(0, -200)); await shot(page, '15-brief-v3-source-popup'); }
    await ctx.close();
  }
  // Signed in (fake API): Contacts follow-up flow, Discover. Desktop + phone.
  for (const vp of [{ n: '', width: 1440, height: 900 }, { n: '-mobile', width: 390, height: 844 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
    await fakeApi(ctx, true);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/contacts`);
    await page.waitForSelector('text=Morgan Ellis', { timeout: 15000 });
    await shot(page, `16-contacts-followup${vp.n}`);
    await page.goto(`${BASE}/discover`);
    await page.waitForSelector('text=NYC Payments Product Summit', { timeout: 15000 });
    await shot(page, `17-discover${vp.n}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
// Privacy check: report capitalized name pairs seen in each screenshot, to review before publishing.
for (const s of shots) console.log(`\n### ${s.name}\n` + [...new Set(s.text.match(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g) ?? [])].join(', '));
