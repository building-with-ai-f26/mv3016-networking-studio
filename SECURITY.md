# Security — Networking Studio

**Live app:** https://networking-studio.onrender.com · **Lane:** Beginner · **Last review:** 2026-11-22 (Build 3)

## What kind of app this is
An **app with sign-in** (Google OAuth) that **saves data** (Supabase Postgres) and **calls a paid AI API** (Gemini). There is also a demo mode without sign-in that can call the AI.

| Piece | Where it runs | Holds secrets? |
|---|---|---|
| React app (`app/src`) | Visitor's browser | No. It only calls our own `/api/*` and `/auth/*` routes. |
| Node server (`app/server`) | Render Web Service | Yes: Gemini key, Google client secret, Supabase secret key, token encryption key (Render environment variables). |
| Database | Supabase (US East) | Stores per-account data. Google tokens and sessions are encrypted. |
| Analytics | PostHog | Public project key (`phc_…`). Session replay masks all text and inputs. |

## Checks and results

### 1. Access control (sign-in app: Account B must not read Account A's data)
- **Design:** `/api/state` gets the account from the server-side session cookie, never from the request. There is no user id in any URL or body, so a request can't ask for another account. Each row is keyed by `sha256(email)`.
- **Database:** Row Level Security is ON for all 4 tables, with **no policies**, and privileges are revoked from `anon`/`authenticated` (`supabase/migrations/001_init.sql`). The public (publishable) key can't read or write anything. Only the server's secret key can.
- **Result:** ⏳ *Manual two-account test still to run on the live site, with a screenshot of the blocked request (see "Remaining").*

### 2. Secret keys stay on the server
- Searched **all git history** for `sb_secret_`, `service_role`, `sk-or-`, `sk-ant-`, `sk-proj-`, `sk_live_`, Google API keys (`AIza…`), Google client secrets (`GOCSPX-…`), OAuth tokens (`ya29.`, `1//…`). **Result: no real keys.** The only matches are a fake token in a test and the word `service_role` in a SQL comment.
- `app/.env` and `app/.data/` have never been committed (`git log --all -- app/.env app/.data` is empty). `git check-ignore` confirms both are ignored.
- Downloaded the **live site's JavaScript** and searched it for the same patterns. **Result: none.** Only the PostHog `phc_` key, which is public by design.
- AI and Google calls happen only in `app/server`. The browser never talks to Gemini, Google APIs or Supabase.

### 3. File storage
No storage buckets are used. A PDF the user attaches to a brief is sent once to Gemini through the server and **not saved**.

### 4. Protect production from the agent
- `AGENTS.md` → **Ask me first**: deleting data or tables, keys, secrets and permissions, anything that costs money, sending messages, rewriting git history.
- **Manual backup:** `node scripts/backup-db.mjs` exports every table to `app/.data/backups/` (git-ignored, on the builder's computer only). First backup: 2026-11-22.
- Schema changes are tracked in git as SQL migrations (`supabase/migrations/`).

### 5. Spending caps and rate limits
- **Per-visitor rate limits** (`server/guard.mjs`) on every route that calls Gemini or writes to the database. Over the limit, the server answers **`429 Too Many Requests`** with `Retry-After`.

  | Route | Signed in | Demo (no sign-in, per IP) |
  |---|---|---|
  | Brief, more questions, chat | 20 per hour | 10 per hour |
  | Classify, read event | 120 per hour | 60 per hour |
  | Save data (`PUT /api/state`) | 60 per minute | (needs sign-in) |
  | Start Google sign-in | 20 per 10 min | 20 per 10 min |
  | **Whole app, all visitors** | 300 AI calls per hour + 1,500 small calls per hour | |

- **Test:** 30 calls in a row to `/api/brief` → calls 1–20 answered, **21–30 got `429`** (signed-in limit). In demo mode, calls 11+ get `429`.
- **Monthly AI budget:** the server adds up the estimated cost of every AI call (saved in the `ai_usage` table). At `AI_MONTHLY_BUDGET_USD` (default **$5**), all AI routes answer `429` until next month.
- **Provider cap:** Gemini currently runs on Google's **free tier** (no billing, so it can't charge). Before enabling billing (planned for web search), add a Google Cloud budget alert. See "Remaining".

### 6. Dependencies
- `npm audit` found **8 issues (2 critical, 4 high, 2 moderate)**: React Router (open-redirect/XSS issues), Vite and esbuild (dev server), Vitest and Tinypool (test runner).
- **Fixed:** upgraded `react-router-dom` 6 → 7, `vite` 5 → 8, `vitest` 2 → 5, `@vitejs/plugin-react` 4 → 6. **`npm audit` now reports 0 vulnerabilities.** All 99 tests pass and the build works.

### 7. Agent security review (tried to break the app)
| # | Attack / weakness found | Risk | Fix |
|---|---|---|---|
| 1 | **CSRF:** another website could make a visitor's browser call our AI routes or account actions. | Spend, unwanted actions | Every POST/PUT must come from our own origin (`Origin` check, `Sec-Fetch-Site`). Otherwise `403`. Cookies are `SameSite=Lax`. |
| 2 | **Fake IP to dodge rate limits:** the limiter trusted the *first* `X-Forwarded-For` entry, which the visitor controls. | Unlimited AI calls | Uses `CF-Connecting-IP` / `True-Client-IP` or the *last* proxy hop. Unit test with a forged header. |
| 3 | **Many IPs to burn the budget** | Cost | Stricter demo limits + app-wide hourly AI ceiling + monthly budget. |
| 4 | **No Content-Security-Policy:** injected scripts could run or load from anywhere. | XSS impact | CSP: scripts only from our site + PostHog; `frame-ancestors 'none'`; `object-src 'none'`; forms only to Google. Checked in Chrome: no violations, PostHog and replay still load. |
| 5 | **Clickjacking / MIME sniffing / downgrade** | UI tricks | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS on the live site. |
| 6 | **Session fixation / long-lived sessions:** the same session id was reused across sign-ins and never expired on the server. | Account takeover with an old cookie | New random session id on every sign-in (old one deleted). Sessions expire server-side after 30 days. Cookie is `HttpOnly`, `Secure` (live), `SameSite=Lax`. |
| 7 | **OAuth code interception** | Account takeover | **PKCE (S256)** added to Google sign-in, plus the existing `state` check. Accounts need a verified Google email. |
| 8 | **Path traversal on the static server** (`/..%2F..%2F.env`) | Leak secrets | Only files inside `app/dist` are served. Tested: `.env` can't be fetched (returns the app page). Missing assets return 404. |
| 9 | **Tokens readable if the database leaks** | Calendar access | Google refresh tokens and sessions are encrypted with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`, never stored in the DB). Session ids are stored hashed. Tests cover tampering and a wrong key. |
| 10 | **AI spend visible to anyone** (`/api/usage`) | Info leak | Now requires sign-in. |
| 11 | **Google token revocation sent in the URL** | Token in logs | Now sent in the POST body. |
| 12 | **Personal data sent to the AI** | Privacy | Emails, links, meeting URLs and phone numbers are stripped before any AI call. Only names and email *domains* leave the server (tests). |

## Remaining issues and next steps
- ⏳ **Two-account test on the live site** (Account B can't read Account A), with screenshot. Also try the Supabase **publishable key** against each table (expect empty results / permission denied).
- **Gemini free tier:** Google may use free-tier prompts to improve its products. Calendar text is minimized (no emails, links or numbers), but enabling billing (paid tier) removes this. Planned with web search, together with a Google Cloud budget alert.
- **Google OAuth is in "Testing" mode:** only listed test users can sign in, Google shows an "unverified app" screen, and refresh tokens expire after 7 days (users sign in again weekly). Removing this needs Google verification.
- **Prompt injection:** a calendar invite could contain text that tries to steer the AI. Impact is limited because the AI has no tools and its output is shown as plain text (React escapes it). Future Gmail drafts will always need the user's approval before sending.
- **Rate-limit counters live in memory:** they reset when the free Render instance restarts. The monthly budget is stored in the database and does not reset.
- **Same keys locally and on Render:** using a separate Gemini key for production is recommended, so it can be revoked on its own.
- `style-src 'unsafe-inline'` is allowed in the CSP (needed by React inline styles). Scripts are not.
