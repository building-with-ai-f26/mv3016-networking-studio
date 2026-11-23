# Networking Studio — app (Build 3)

Students log in with Google. The app reads their Google Calendar (read-only), keeps only networking events and writes a researched AI prep brief with live web search, where every fact has a clickable source. After an event, the people they met go to Contacts with follow-up tasks: LinkedIn, and email drafts that are sent only after the student approves. **Discover** suggests real in-person NYC events that fit their profile. A demo mode with a fictional calendar works without an account.

React + TypeScript + Vite in the browser, plus a small Node.js server (`server/`) that holds every key and talks to Google (Calendar, Gmail), Gemini and Supabase. **Live:** https://networking-studio.onrender.com (Render). Security: `../SECURITY.md`.

## Run it

Requires Node.js 20.12+ (Render uses Node 22). Setup, keys and deploy: see `../AGENTS.md`.

```bash
cd app
npm install        # first time only
npm run dev        # app at http://localhost:5173 + local server on :8787 (stop with Ctrl+C)
```

| Command | What it does |
|---|---|
| `npm run build` | Type-check and build to `dist/` |
| `npm run typecheck` | TypeScript check only |
| `npm test` | 153 tests (Vitest + Testing Library, jsdom). AI, Google and Gmail are mocked, so tests cost nothing. Server tests never read `.env` or touch the real database |
| `npm run e2e` | Browser smoke test in your installed Google Chrome at 1440px and 390px (run `npm run build` first) |
| `npm start` | Production server: API + built app on one port (what Render runs) |
| `node scripts/backup-db.mjs` | Manual database backup to `.data/backups/` (git-ignored) |

## How it works

1. **Login** (`/login`): *Create account* asks Google for name, email and read-only calendar access, then shows "Almost set!" (about you, goals, target companies). *Explore the demo* needs no account.
2. **Calendar:** the server reads the last 4 weeks, this week and the next 2 weeks (New York weeks). The last month of past events is saved in the account, so it stays even if Google stops returning it. The server removes meeting links, emails and phone numbers before anything reaches the browser or the AI.
3. **Networking filter** (`src/lib/classifier.ts`): rules first. Unclear events go to the AI (`/api/classify`, cached). The type badge is a menu to correct it, and corrections are remembered.
4. **AI brief, research agent** (`server/agent.mjs`):
   1. A "lens" call picks the focus area, industry and competitors.
   2. A plan: light checks on people (career, interests) and deep research on up to 4 companies, prioritized by the student's profile.
   3. Parallel searches with Grounding with Google Search: company, focus area, news, competition, trends.
   4. A writer builds the brief: summary, the logic of the business, the focus area and its bottom line, people, financials, company and industry news (newest first), and questions by theme (always in English). Every fact has a `[n]` that opens its source.

   The brief language (English/Spanish) and an "About you" background are in Settings. It shows tokens, searches and cost per run.
5. **On the brief:** save and copy questions, more questions, an "Ask about this brief" chat, and PDF/Word export. **Related emails** from Gmail can be added to the brief ("Use in brief").
6. **Gmail** (connected separately in Settings): AI-written drafts (thank-you, follow-up, reply) with a comments box. **Save draft** or **Send**, where Send only works after a confirm dialog. Scopes are read + compose, never delete.
7. **Contacts:** people from past networking events are added automatically (stage *New*). You can **Connect** (LinkedIn search plus a 300-character note to copy, or email) or **Dismiss** them. The stages are New → Added on LinkedIn / Emailed → Follow-up due → Replied → Coffee chat done. Tasks (connect within 3 days, thank-you after a coffee chat, reply, follow-up after 7 days) show in Contacts and on the calendar. Gmail is checked for replies when the app opens (no AI).
8. **Discover:** real events from Eventbrite, Luma and Meetup, read from each platform's own structured data. They are filtered to in person, NYC, the next 2 months and no spam/promoters. The AI only rates relevance to your profile. Club newsletters and CampusGroups emails from Gmail are included too. Events are grouped by week with *High priority* and *Paid* tags, plus Register / Add to my calendar / Add to Google Calendar / Not interested. Web sources refresh daily and email every 3 hours, with no refresh button.
9. **Analytics:** PostHog (`src/lib/analytics.ts`), with masked session replay.

## Data

- **Signed-in accounts:** one row per account in Supabase (`user_state`, keyed by a hash of the email): profile, briefs, contacts, Discover, corrections. Google tokens and sessions are encrypted. Emails are read live from Gmail and not stored (only message ids, dates and subjects in each contact's log). Upcoming calendar events are read live from Google.
- **Without Supabase keys** (local quick runs, tests): the same data goes to JSON files in `app/.data/` (git-ignored).
- **Demo mode:** `localStorage` in this browser. Reset in Settings → Demo controls.
- Settings → Disconnect revokes Google access and deletes the account's sessions, tokens and data.

## Known limitations

- Google OAuth is in Testing mode: only listed test users can sign in, and they sign in again every 7 days.
- Briefs take about a minute (several web searches).
- Partiful has no structured event data, so its events only come in through newsletters.
- The free Render instance sleeps after 15 minutes idle. The first visit takes about 50 seconds.
- The CampusGroups calendar link is supported but not connected yet.
