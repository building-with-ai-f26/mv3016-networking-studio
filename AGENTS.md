# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** Networking Studio, an app where students connect their Google Calendar and get an AI prep brief before networking events (coffee chats, panels, info sessions, interviews).
- **Primary user & core workflow:** recruiting students (first users: NYU Stern MBA classmates). Log in with Google → calendar shows only networking events → "Generate brief with AI" → 8-section brief. See the living PRD in `docs/index.html`.
- **Tech stack:** React 18 + TypeScript + Vite (frontend), a small Node.js server with no framework (`app/server`, port 8787), Google OAuth + Google Calendar API (read-only), Gemini API (`gemini-3.5-flash-lite`), PostHog analytics, Vitest + Testing Library, Playwright (with the installed Chrome) for the smoke test.

## 2. Project structure
```
docs/                 Product Page (GitHub Pages, public, no login) + screenshots (demo data only)
app/                  The app (all commands run here)
  server/             Local API server: holds every secret
    index.mjs           routes: /api/brief, /api/classify, /api/me, /api/calendar/events, /auth/*
    brief.mjs           AI brief: prompt, JSON schema, parsing, cost per run
    classify.mjs        AI step of the networking classifier (unclear events only)
    google.mjs          Google sign-in, sessions, calendar read, cleaning (no links/emails)
  src/
    pages/              Login, Calendar, Event (brief), Contacts, News, Settings
    components/         UI pieces (AddEventDialog, brief/AiBriefDocument, …)
    lib/classifier.ts   Networking rules (free, explainable) + company/person extraction
    lib/analytics.ts    PostHog (masked session replay; no names or free text in events)
    state/              App store (localStorage) + classification hook
    services/           Browser calls to the local server (never to Gemini or Google directly)
    data/               Sample data: demo week, fictional demo calendar, sample briefs
    test/               Vitest tests (69)
  .data/              Local sessions, Google tokens and one data file per account (git-ignored)
  .env                Secrets (git-ignored). Template: ../.env.example
journal/              Build journal
```

## 3. Setup (first time)
1. `cd app && npm install` (installs into `app/node_modules`; never use `npm install -g`).
2. Copy the template: `cp ../.env.example .env`, then fill in `app/.env` yourself (never paste secrets into a chat):
   - `GEMINI_API_KEY`: from aistudio.google.com → Get API key.
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: Google Cloud → OAuth client (Web application) with redirect URI `http://localhost:8787/auth/google/callback`; Calendar API enabled; your Google account added as a test user.
   - `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`: the PostHog **project** token (public, starts with `phc_`) and host.
   - Optional: `GEMINI_MODEL`, `GEMINI_MAX_OUTPUT_TOKENS`, `GEMINI_PRICE_*` (cost-per-run label), `CALENDAR_PAST_DAYS` (default 7).
3. Without any keys the app still runs in demo mode (login screen → "Explore the demo").

## 4. Commands
All app commands run inside the `app/` folder (`cd app`).
- **Run locally:** `npm run dev` (starts the app and the local server), then open http://localhost:5173 (stop with Ctrl+C)
- **Only the web app / only the server:** `npm run dev:web` / `npm run dev:server`
- **Build (type-check + production build):** `npm run build`
- **Type-check only:** `npm run typecheck`
- **Run deterministic tests:** `npm test` (Vitest + Testing Library; AI and Google calls are mocked, so tests cost nothing)
- **Browser smoke test:** `npm run build && npm run e2e` (uses the installed Google Chrome at 1440px and 390px)
- **Preview the production build:** `npm run preview`
- **Run model evals:** not yet (planned for Build 4)

See `app/README.md` for how the app works, the demo data, what is real and what is simulated.

## 5. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`app/.env`) and update `.env.example` when new variables are needed. AI and Google calls happen only in `app/server`, never in the browser. Check `git check-ignore app/.env app/.data` before every push.
6. **Privacy:** Never put real people's names, real calendar entries or real emails in `docs/`, READMEs, screenshots, tests, sample data or commit messages. Never send meeting links, emails or phone numbers to the AI. PostHog session replay masks all text and inputs.
7. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.
