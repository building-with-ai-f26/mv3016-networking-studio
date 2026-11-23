# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** Networking Studio, an app where students connect their Google Calendar and get an AI prep brief before networking events (coffee chats, panels, info sessions, interviews).
- **Primary user & core workflow:** recruiting students (first users: NYU Stern MBA classmates). Log in with Google → calendar shows only networking events → "Generate brief with AI" (a research agent with live Google Search, every fact cited) → after the event, people go to Contacts with follow-up tasks (LinkedIn, email drafts the user approves) → Discover suggests real NYC events that fit the profile. See the living PRD in `docs/index.html`.
- **Tech stack:** React 18 + TypeScript + Vite (frontend), a small Node.js server with no framework (`app/server`, port 8787), Google OAuth + Google Calendar API (read-only) + Gmail API (read + compose, never delete), Gemini API (`gemini-3.8-flash` for research and writing, `gemini-3.5-flash-lite` for small calls; Grounding with Google Search), Supabase Postgres (server-only, Row Level Security), PostHog analytics, Vitest + Testing Library, Playwright (with the installed Chrome) for the smoke test.
- **Hosting:** Render (one Web Service runs the server, which also serves the built app). Product Page: GitHub Pages (`docs/`).

## 2. Project structure
```
docs/                 Product Page (GitHub Pages, public, no login) + screenshots (demo data only)
app/                  The app (all commands run here)
  server/             API server: holds every secret (also serves app/dist when deployed)
    index.mjs           routes: /api/brief, /api/classify, /api/extract, /api/state, /api/me, /api/calendar/events, /api/usage,
                        /api/gmail/*, /api/linkedin/note, /api/discover/web|mail|ical, /auth/*
    guard.mjs           per-visitor rate limits (429), CSRF origin check, monthly AI + search budget
    store.mjs           database access (Supabase via secret key; local files when not configured)
    crypto.mjs          AES-256-GCM encryption of Google tokens and sessions
    agent.mjs           research agent for briefs: lens → plan → parallel grounded searches → writer (JSON v3) → citations
    research.mjs        Google Search grounding helpers (sources, search price, Search Suggestions)
    brief.mjs           brief context, more questions, chat, cost per run
    classify.mjs        AI step of the networking classifier (unclear events only)
    extract.mjs         AI reading of an event (people, companies, topic)
    google.mjs          Google sign-in (PKCE), sessions, calendar read, cleaning (no links/emails)
    gmail.mjs           related emails, reply/activity tracking, safe raw email, drafts and send (app drafts only)
    discover.mjs        Discover: newsletters/club emails, CampusGroups iCal, link checks
    eventsources.mjs    Discover: real events from Eventbrite/Luma/Meetup structured data, NYC filters, safeFetch (SSRF-safe)
  scripts/            One-off tools: import-local-data.mjs (local files → Supabase), backup-db.mjs (manual DB backup)
  src/
    pages/              Login, Calendar, Event (brief), Contacts, Discover, News, Settings
    components/         UI pieces (AiBriefV3 with citation popups, EmailPanel/EmailComposer, ContactDrawer, background syncs: GmailSync, DiscoverSync, ContactsAutoImport)
    lib/followups.ts    contact stages and follow-up task rules (connect in 3 days, thanks after a coffee chat, reply, follow-up after 7 days)
    lib/discover.ts     merging, ranking and weekly grouping of Discover events
    lib/classifier.ts   Networking rules (free, explainable) + company/person extraction
    lib/analytics.ts    PostHog (masked session replay; no names or free text in events)
    state/              App store (per-account data via /api/state; demo in localStorage) + classification hook
    services/           Browser calls to the local server (never to Gemini or Google directly)
    data/               Sample data: demo week, fictional demo calendar, sample briefs
    test/               Vitest tests (153), incl. access-control.test.ts (two accounts against the real server)
  .data/              Local fallback store when Supabase is not configured (git-ignored)
  .env                Secrets (git-ignored). Template: ../.env.example
supabase/migrations/  Database schema, tracked in git (run in Supabase → SQL Editor)
journal/              Build journal
```

## 3. Setup (first time)
1. `cd app && npm install` (installs into `app/node_modules`; never use `npm install -g`).
2. Copy the template: `cp ../.env.example .env`, then fill in `app/.env` yourself (never paste secrets into a chat):
   - `GEMINI_API_KEY`: from aistudio.google.com → Get API key (billing on: web search grounding is used; 5,000 searches/month free).
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: Google Cloud → OAuth client (Web application) with redirect URI `http://localhost:8787/auth/google/callback`; **Calendar API and Gmail API** enabled; scopes `calendar.readonly`, `gmail.readonly`, `gmail.compose` on the consent screen; your Google account added as a test user.
   - `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`: the PostHog **project** token (public, starts with `phc_`) and host.
   - `SUPABASE_URL`, `SUPABASE_SECRET_KEY`: Supabase → Project Settings → Data API (URL) and API Keys → Secret keys (`sb_secret_…`). Server only.
   - `TOKEN_ENCRYPTION_KEY`: 32 random bytes, base64 (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). Must be the same locally and on Render, or saved sessions/tokens can't be read.
   - Optional: `GEMINI_MODEL`, `GEMINI_MAX_OUTPUT_TOKENS`, `GEMINI_PRICE_*` (cost-per-run label), `AI_MONTHLY_BUDGET_USD` (default 5).
   - Database: run `supabase/migrations/*.sql` in order in Supabase → SQL Editor (every table has Row Level Security, no policies).
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
- **Run the production server locally:** `npm run build && PORT=8899 npm start`, then open http://localhost:8899
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

## 6. Shipping (deploy to Render)
The live app is one Render **Web Service**. The Node server (`app/server/index.mjs`) serves the API, Google sign-in and the built React app (`app/dist`) on one URL. Steps marked **Human** need the builder's clicks or keys; the agent never types keys.

**Before every deploy (agent):**
1. `cd app && npm test && npm run build` must pass.
2. `git check-ignore app/.env app/.data` must print both paths; scan the diff for keys (`sb_secret_`, `service_role`, `sk-`, `AIza`, `GOCSPX`).
3. If the database schema changed: add a new numbered file in `supabase/migrations/` and ask the human to run it in Supabase → SQL Editor **before** deploying (Ask me first).
4. Commit and push to `main`.

**First-time setup (Human, once):**
1. render.com → sign up → **New + → Web Service → Public Git Repository** → `https://github.com/building-with-ai-f26/mv3016-networking-studio` (no GitHub access needed).
2. Settings: Name `networking-studio` · Branch `main` · Region **Virginia (US East)** · Root Directory `app` · Build Command `npm ci && npm run build` · Start Command `npm start` · Instance **Free**.
3. Environment → **Add from .env**: paste the contents of `app/.env`. Then add `HOST=0.0.0.0`, `TRUST_PROXY=1`, `NODE_VERSION=22`, `AI_MONTHLY_BUDGET_USD=5`.
4. **Deploy Web Service**. When it says **Live**, copy the URL (`https://<name>.onrender.com`), add `PUBLIC_URL=<that URL>` and save (Render redeploys).
5. Google Cloud → APIs & Services → Clients → the OAuth client → add `<URL>/auth/google/callback` to **Authorized redirect URIs** and `<URL>` to **Authorized JavaScript origins** → Save. Add testers under **Audience → Test users**.

**Every later deploy:** after the push, Render → the service → **Manual Deploy → Deploy latest commit** (public-repo services don't auto-deploy).

**Verify the live site (agent):** `curl <URL>/api/health` → `{"ok":true,…}`; open `<URL>` → login screen; "Explore the demo" works on a phone width (390px); Google sign-in returns to `<URL>/calendar`; PostHog Activity shows `$pageview` from the live host.

**Roll back:** Render → the service → **Events** → pick the last good deploy → **Rollback**.

## 7. Ask me first (stop and ask the human)
- Deleting data or files, running SQL that changes or drops tables, or touching the production database (Supabase) beyond normal app use.
- Anything with keys, secrets or permissions: creating/rotating keys, changing Google OAuth scopes or test users, Render environment variables, Supabase settings.
- Anything that costs money: enabling billing, paid plans, raising `AI_MONTHLY_BUDGET_USD`, new paid APIs.
- Sending email or messages for the user, publishing real data, rewriting Git history, force-pushing.

## 8. Rules from real mistakes
- **Never put real data in public files.** (Mistake: real names and event titles went into the public demo calendar and tests; they had to be replaced with fictional ones.) Before committing anything in `docs/`, `src/data/`, tests or screenshots, check it only has fictional people and events.
- **Never send links or contact details to the AI.** (Mistake: Zoom links reached Gemini through the event's location field.) Every field sent to the AI goes through the cleaning helpers in `server/google.mjs` / `extract.mjs`; add a test when adding a field.
- **Don't take shortcuts that remove features.** (Mistake: interactive questions and chat were dropped from AI briefs to save time.) If a feature must change, say so and ask first.
- **Never let the AI invent things that look real.** (Mistake: Discover asked the AI to search the web for events, and most results or links were wrong or about other events.) Events now come only from trusted platforms' own structured data; the AI may only rate or summarize what a real source returned. The same rule applies to brief facts: every fact needs a citation from a real search result.
- **Tests must never touch the real database or keys.** (Mistake avoided in Build 3: a server test would have read `app/.env` and written to Supabase.) Server tests set `NS_TEST_NO_DOTENV=1` and `NS_DATA_DIR=<temp folder>`.
- **Don't rewrite a file by reading and writing it in one line.** (Mistake: `open(f,'w').write(open(f).read()…)` emptied `agent.mjs`; restored with `git checkout`.) Read first, then write.
- **Be polite to other websites.** (Mistake: repeated tests got Eventbrite to answer `429 Too Many Requests`.) One page at a time per platform, pause between pages, stop on `429`, at most once a day.
- **Keep runtime data out of watched folders.** (Mistake: saving sessions inside `server/` restarted the dev server on every login, causing a login loop.)
