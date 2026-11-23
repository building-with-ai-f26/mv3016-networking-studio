# Security — Networking Studio

**Live app:** https://networking-studio.onrender.com · **Lane:** Beginner · **Last review:** 2026-11-22 (Build 3)

## What kind of app this is
An **app with sign-in** (Google OAuth). It **saves data** (Supabase Postgres), **calls a paid AI API** (Gemini with Google Search grounding) and **reads and writes Gmail** (read, and drafts sent only after the user approves). A demo mode without sign-in can also call the AI, with stricter limits.

| Piece | Where it runs | Holds secrets? |
|---|---|---|
| React app (`app/src`) | Visitor's browser | No. It only calls our own `/api/*` and `/auth/*` routes. |
| Node server (`app/server`) | Render Web Service | Yes, as Render environment variables: Gemini key, Google client secret, Supabase secret key, token encryption key. |
| Database | Supabase (US East) | Per-account data. Google tokens and sessions are encrypted. |
| Analytics | PostHog | Public project key (`phc_…`). Session replay masks all text and inputs. |

**Data the app touches, and where it goes**

| Data | Stored | Sent to the AI (Gemini)? |
|---|---|---|
| Calendar events (last 4 weeks to 2 weeks ahead) | Only the last month's past events, already cleaned (no emails, links or phone numbers; attendees as name + email domain), in the user's own row, so contacts and history keep their context | Title, time, company, attendee names and email **domains**. Emails, links, phone numbers and meeting URLs are stripped first. |
| Briefs, contacts, profile, notes | Supabase, keyed by `sha256(email)` | The event and profile, to write the brief. |
| Gmail: related emails | No | Only when the user clicks **"Use in brief"**. |
| Gmail: newsletters and club emails | Only the message ids already read | The newsletter text, to find events in it. Personal emails are skipped (only bulk/list senders, `.edu`, CampusGroups, 12Twenty). |
| Email drafts | Gmail drafts (the user's own account) | The event, brief summary and the user's notes. Never other emails. |
| Contacts' email addresses | Supabase | **Never.** |

## Checks and results

### 1. Access control (Account B must not read Account A's data)
- **Design:** every `/api/*` route gets the account from the server-side session cookie, never from the request. No user id appears in any URL or body, so a request can't name another account. The server ignores fake `?user=` parameters and `X-User-Email` headers.
- **Database:** Row Level Security is ON for all 4 tables (`user_state`, `app_sessions`, `google_accounts`, `ai_usage`), with **no policies**. Privileges are revoked from `anon`/`authenticated` (`supabase/migrations/001_init.sql`, `002_ai_usage_searches.sql`). Only the server's secret key can read or write. The browser never talks to Supabase.
- **Gmail:** a user can only send drafts the app created for them. Other draft ids are refused.
- **Automated end-to-end test** (`app/src/test/access-control.test.ts`): starts the real server with two signed-in accounts (temporary data, never the real database). Results: each account reads only its own data. B asking for A with `?user=`, `?email=`, `?user_key=` or an `X-User-Email` header still gets only B's data. B's save never overwrites A. With no session or a made-up session id, `/api/state`, `/api/gmail/*` and `/api/usage` answer `401`. A save from another website answers `403`. **5/5 pass.**
- **Result on the live site (2026-11-23):** ✅ signed in as Account B (a second test Google account), asked for Account A's data with `?user=account-A` and an `X-User-Email` header → `200` with **0 briefs and 0 contacts** (only B's own, empty data). `/api/state` without a session → **`401 Not signed in`**. `/api/gmail/related` without a session → **`401 Not signed in`**. Screenshot submitted with Build 3.
- **Supabase publishable key (2026-11-23):** ✅ reading each table with the public key (`select=*` on `user_state`, `app_sessions`, `google_accounts`, `ai_usage`) → **`401 permission denied`** on all 4. Writing a row to `user_state` → **`401 permission denied`**.

### 2. Secret keys stay on the server
- Searched **all git history** (`git log --all -p`) and every tracked file for `sb_secret_`, `service_role`, `sk-or-`, `sk-ant-`, `sk-proj-`, `sk_live_`, Google API keys (`AIza…`), Google client secrets (`GOCSPX-…`) and OAuth tokens (`ya29.`, `1//…`). **Result: no real keys** (re-run 2026-11-22). The only matches are placeholders in `.env.example` and pattern names in these docs.
- `app/.env` and `app/.data/` have never been committed. `git check-ignore` confirms both are ignored, and it is checked before every push.
- Downloaded the **live site's HTML and JavaScript** and searched them for the same patterns. **Result: none.** Only the PostHog `phc_` key appears, and it is public by design.
- Gemini, Google APIs (Calendar, Gmail) and Supabase are called only from `app/server`.

### 3. File storage
No storage buckets are used. A PDF the user attaches to a brief goes once to Gemini through the server and is **not saved**. Emails are read live from Gmail and not copied into the database.

### 4. Protect production from the agent
- `AGENTS.md` → **Ask me first**: deleting data or tables, keys/secrets/permissions, anything that costs money, sending messages, rewriting git history, publishing real data.
- **Manual backup:** `node scripts/backup-db.mjs` exports every table to `app/.data/backups/` (git-ignored, on the builder's computer only). Backups: 2026-11-22 and 2026-11-23 (before submitting Build 3).
- Schema changes are tracked in git as SQL migrations (`supabase/migrations/`).

### 5. Spending caps and rate limits
- **Per-visitor rate limits** (`server/guard.mjs`) on every route that calls Gemini, Gmail or writes to the database. Over the limit the server answers **`429 Too Many Requests`** with `Retry-After`.

  | Route | Signed in | Demo (no sign-in, per IP) |
  |---|---|---|
  | Brief (research agent), more questions, chat, LinkedIn note | 20 per hour | 10 per hour |
  | Classify, read event | 120 per hour | 60 per hour |
  | Save data (`PUT /api/state`) | 60 per minute | (needs sign-in) |
  | Start Google sign-in | 20 per 10 min | 20 per 10 min |
  | Gmail: search related emails, replies, activity | 30 per 10 min | (needs sign-in) |
  | Gmail: AI draft / save draft | 20 per hour | (needs sign-in) |
  | **Gmail: send** | **10 per hour** | (needs sign-in) |
  | Discover (events from the web, emails, CampusGroups) | 10 per hour | (needs sign-in) |
  | **Whole app, all visitors** | 300 AI calls + 1,500 small calls per hour | |

- **Tests:** automated tests make 30 calls in a row: calls 21–30 get `429` when signed in, and calls 11+ get `429` in demo mode.
- **Monthly AI budget:** the server adds up the estimated cost of every AI call **and every paid Google Search** (table `ai_usage`, columns `cost_usd` and `searches`). At `AI_MONTHLY_BUDGET_USD` (**$5** on Render), all AI routes answer `429` until next month. The first 5,000 grounded searches each month are free from Google, so they count as $0. After that each search costs $0.014.
- **Fewer AI calls:** Gmail sync, contacts and follow-up tasks use no AI. Discover reads the web once every 24 hours and email every 3 hours, with no manual "refresh" button. Briefs are saved, so they aren't generated twice.
- **Provider side:** Gemini billing is enabled (paid tier, so prompts are not used to train Google's models). A Google Cloud budget alert is the backstop (see "Remaining").

### 6. Dependencies
- `npm audit` (2026-11-23): **0 vulnerabilities.**
- Earlier in Build 3 it found 8 (2 critical, 4 high, 2 moderate) in React Router, Vite/esbuild and Vitest. Fixed by upgrading `react-router-dom` 6 → 7, `vite` 5 → 8, `vitest` 2 → 5 and `@vitejs/plugin-react` 4 → 6.
- **159 automated tests pass** and the production build works.

### 7. Agent security review (tried to break the app)
| # | Attack / weakness found | Risk | Fix |
|---|---|---|---|
| 1 | **CSRF:** another website makes a visitor's browser call our AI, Gmail or account routes. | Spend, unwanted emails | Every POST/PUT must come from our own origin (`Origin` / `Sec-Fetch-Site` check), else `403`. Cookies are `SameSite=Lax`. |
| 2 | **Fake IP to dodge rate limits:** the limiter trusted the *first* `X-Forwarded-For` entry, which the visitor controls. | Unlimited AI calls | Uses `CF-Connecting-IP` / `True-Client-IP` or the *last* proxy hop. Unit test with a forged header. |
| 3 | **Many IPs to burn the budget** | Cost | Stricter demo limits, an app-wide hourly AI ceiling and a monthly budget that counts paid searches. |
| 4 | **No Content-Security-Policy** | XSS impact | CSP: scripts only from our site and PostHog; `frame-ancestors 'none'`; `object-src 'none'`; forms only to Google. |
| 5 | **Clickjacking / MIME sniffing / downgrade** | UI tricks | `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS on the live site. |
| 6 | **Session fixation / endless sessions** | Account takeover | New random session id on every sign-in (old one deleted). Sessions expire server-side after 30 days. Cookie is `HttpOnly`, `Secure` (live), `SameSite=Lax`. |
| 7 | **OAuth code interception** | Account takeover | **PKCE (S256)** plus the `state` check. Accounts need a verified Google email. |
| 8 | **Path traversal on the static server** (`/..%2F..%2F.env`) | Leaks secrets | Only files inside `app/dist` are served. `.env` can't be fetched. |
| 9 | **Tokens readable if the database leaks** | Calendar/Gmail access | Google tokens and sessions are encrypted with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`, never in the DB). Session ids are stored hashed. Tests cover tampering and a wrong key. |
| 10 | **AI spend visible to anyone** (`/api/usage`) | Info leak | Requires sign-in. |
| 11 | **Personal data sent to the AI** | Privacy | Emails, links, meeting URLs and phone numbers are stripped before AI calls (see the data table above). Tests cover this. |
| 12 | **Email header injection:** a name or subject with a line break adds `Bcc:` to a draft. | Spam from the user's account | Line breaks are removed from every header, and addresses are validated before the raw email is built (tests). |
| 13 | **AI or attacker sends email without the user** | Unwanted emails | Gmail scope is `gmail.compose` (no delete, no settings). Sending needs a click on **Send** plus a confirm dialog. Only drafts the app created can be sent. Limit: 10 per hour. |
| 14 | **AI-invented or scam event links** in Discover | Phishing | Events come only from trusted platforms (Eventbrite, Luma, Meetup), read from their own structured data. The AI only rates relevance and can't add events or links. Newsletter links are kept only if they open that event's own page on a trusted platform or school/club site. Otherwise the button opens the email in Gmail. |
| 15 | **SSRF:** a link in an email or event page redirects the server to an internal address (e.g. `169.254.169.254`). | Internal access | Links must be public `https` (no IP literals, localhost or `user:pass@`). **Every redirect hop is checked** (`safeFetch`, max 5 hops, new in this review). The CampusGroups iCal only accepts `https://*.campusgroups.com` and refuses redirects. Unit test with a redirect to `127.0.0.1`. |
| 16 | **Prompt injection** from an event, email or web page ("ignore your rules…") | Misleading output | The AI has no tools that act: it can't send email, change data or browse. Its output is shown as plain text (React escapes it), and citations link only to sources Google returned. Every email needs the user's approval. |
| 17 | **Hammering event platforms** (Eventbrite answered `429`) | Getting blocked; impolite | Polite fetching: one page at a time per platform with a pause, stop on `429`, at most once a day. |

## Remaining issues and next steps
- **Google Cloud budget alert:** set an alert (e.g. $10/month) in Google Cloud Billing as a second safety net behind the app's $5 monthly budget.
- **Google OAuth is in "Testing" mode:** only listed test users can sign in, Google shows an "unverified app" screen, and refresh tokens expire after 7 days. Gmail scopes would need Google's verification (and a security assessment for restricted scopes) before a public launch.
- **Rate-limit counters live in memory:** they reset when the free Render instance restarts. The monthly budget is stored in the database and does not reset.
- **DNS rebinding:** `safeFetch` checks host names, not the IP they resolve to. A public name pointing to a private IP could still be fetched. Low risk on Render, where there is no sensitive internal service. A fix would resolve the IP before connecting.
- **Same keys locally and on Render:** a separate production Gemini key is recommended, so it can be revoked on its own.
- `style-src 'unsafe-inline'` is allowed in the CSP (React inline styles). Scripts are not.
