# Networking Studio — local app (Build 2)

Students log in with Google, the app reads their Google Calendar (read-only), keeps only networking events, and generates a real AI prep brief with Gemini. A demo mode with a fictional calendar works without an account. Contacts and Industry News are still Build 1 sample features.

React + TypeScript + Vite in the browser, plus a small Node.js server (`server/`, port 8787) that holds every key and talks to Google and Gemini.

## Run it

Requires Node.js 20.12+ (tested with Node 26). Setup and keys: see `../AGENTS.md` → Setup.

```bash
cd app
npm install        # first time only
npm run dev        # app at http://localhost:5173 + local server on :8787 (stop with Ctrl+C)
```

| Command | What it does |
|---|---|
| `npm run build` | Type-check and build to `dist/` |
| `npm run typecheck` | TypeScript check only |
| `npm test` | 69 tests (Vitest + Testing Library, jsdom). AI and Google are mocked: no cost |
| `npm run e2e` | Browser smoke test in your installed Google Chrome at 1440px and 390px (run `npm run build` first) |
| `npm run preview` | Serve the production build |

## How it works

1. **Login** (`/login`): *Create account* asks Google once for name, email and read-only calendar access, then shows “Almost set!” (3 welcome questions: about you, goals, target companies). *Log in* only picks the Google account and reuses that access. *Explore the demo* needs no account. Log out is in Settings → Account.
2. **Calendar:** the server reads the last 7 days and the next 14 days. It removes meeting links, emails and phone numbers from locations and descriptions before anything reaches the browser or the AI.
3. **Networking filter** (`src/lib/classifier.ts`): rules first. Hidden: course codes, classes, exams, all-day, declined, out-of-office, focus time, recurring events, fellowship programs, weekly syncs, club coordination without a named guest, events with no other attendees. Kept: coffee chats, “Name <> Name” intros, panels, info sessions, lunch and learns, mixers, alumni/career/recruiting events, interviews. Unclear events go to the AI (`/api/classify`, one at a time, cached). The type badge on each card is a menu to correct it; corrections are remembered.
4. **Add event:** a form for events the calendar misses.
5. **AI brief** (`server/brief.mjs`): Gemini returns JSON for 8 sections (essentials, people, companies, financials, company news, industry themes, 10 questions, sources & what to verify). No web search yet, so financials and news are “Not verified” with a list of what to look up. Labeled “AI-generated draft”, with tokens and cost per run.
6. **Analytics:** PostHog (`src/lib/analytics.ts`), masked session replay.

## Data

- **Demo mode:** the sample week Nov 9–15, 2026 (4 hand-written sample briefs) and a fictional calendar for Nov 16–22 that goes through the real classifier and AI brief.
- **Signed-in accounts:** each Google account has its own data file on the local server, `app/.data/users/<hash of the email>.json` (git-ignored): profile, added events, AI briefs, AI classifications and corrections. So each AI brief is generated once per event and account, in any browser (it is only regenerated when the user clicks “Regenerate”). New accounts start with an empty profile and no contacts, and answer the “Almost set!” questions once. Google Calendar events themselves are never saved: they are read from Google each time.
- **Demo mode:** `localStorage` key `networking-studio:v1` in this browser. Reset: Settings → Demo controls (demo only).
- **Sessions:** `app/.data/sessions.json` and `accounts.json` (Google refresh tokens), git-ignored. Settings → Disconnect revokes Google access and deletes the account's sessions, tokens and data file.

## What is still simulated

Email reminders, the brief chat, Contacts and Industry News sample content, and the 48h/24h schedule.

## Known limitations

- No web search: no live news, financials or background on people (planned, with a monthly cap).
- Events with only a title give thin briefs (planned: ask for missing details).
- Gemini free tier: per-minute limits and occasional “high demand” errors (the server retries).
- The school sign-in page can loop in Chrome incognito (blocked cookies). Use a normal window.
