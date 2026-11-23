# Networking Studio

> **One-line pitch:** for students who are recruiting. It reads your calendar, prepares you for every networking event with a researched brief, and helps you follow up with the people you meet.

- **Builder:** `mv3016` · NYU Stern "Building with AI" (Fall 2026) · **Lane:** Beginner
- **Live app (Build 3):** https://networking-studio.onrender.com. Google sign-in is in testing mode, so only invited test users can log in. "Explore the demo" works for anyone.
- **Product Page & Living PRD:** https://building-with-ai-f26.github.io/mv3016-networking-studio/ (PRD v3 and the Build 3 log)
- **Security audit:** [`SECURITY.md`](./SECURITY.md)

## Current status: Build 3 (due Nov 23)

The core workflow works end to end on a live app with real inputs:

1. **Sign in with Google.** The app reads your Google Calendar (read-only) from the last 4 weeks to 2 weeks ahead, and shows only networking events.
2. **Researched AI brief.** A research agent with Gemini and Google Search writes it. Every fact has a number that opens its source. It can include related Gmail emails.
3. **Follow-up.** People you met wait in Contacts → To do. Connect on LinkedIn or by email, or dismiss them. Email drafts are sent only after you confirm. Contacts track emails exchanged, the last interaction and follow-up tasks.
4. **Discover.** Real in-person NYC events that fit your goals, from Eventbrite, Luma, Meetup and your club newsletters.

Stack:
- React + TypeScript + Vite.
- A Node server on **Render** that holds every key.
- **Supabase** Postgres, server-only, with Row Level Security.
- Gemini, and PostHog with masked session replay.

There are 159 automated tests.

## Repository map

| File / folder | Purpose |
| --- | --- |
| [`docs/index.html`](./docs/index.html) | Public Product Page: pitch, living PRD (v3), weekly build log, screenshots (demo data only). |
| [`app/`](./app/) | The app: React frontend (`src/`) and Node server (`server/`). See [`app/README.md`](./app/README.md). |
| [`AGENTS.md`](./AGENTS.md) | Project structure, setup, commands, **Shipping (deploy to Render)**, "Ask me first" and rules from real mistakes. |
| [`SECURITY.md`](./SECURITY.md) | Build 3 security audit: access control, secrets, storage, backups, spending caps and rate limits, npm audit, attack review. |
| [`supabase/migrations/`](./supabase/migrations/) | Database schema (RLS on every table). |
| [`Intent.md`](./Intent.md), [`Plan.md`](./Plan.md), [`journal/`](./journal/) | Drafting aids. |
| [`SPONSOR_MEMO.md`](./SPONSOR_MEMO.md) | Sponsor memo (due Dec 14). |

## Run it locally

```bash
git clone https://github.com/building-with-ai-f26/mv3016-networking-studio.git
cd mv3016-networking-studio/app
npm install
npm run dev        # app at http://localhost:5173 + server on :8787
npm test           # 159 tests, no API cost
```

Keys go only in `app/.env` (git-ignored). The template is in `.env.example`. Full setup and deploy steps are in [`AGENTS.md`](./AGENTS.md).
