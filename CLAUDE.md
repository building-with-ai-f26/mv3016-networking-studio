# Networking Studio - instructions for Claude Code

## How to work with me
- I am a complete beginner (first time using Terminal, Git and code). Always explain in simple Spanish: what you are about to do, why, and whether I need to do anything.
- Do as much as possible yourself: edit files, run commands and tests, commit and push. Only ask me for what you cannot do: clicks on websites (PostHog, OpenRouter, Google Cloud), my keys, or decisions.
- When I must do something, give me numbered steps with the exact buttons to click and the exact text to copy.
- Work one phase at a time. At the end of each phase: summarize in Spanish what changed and how I can see it, then commit and push.
- Stop and ask me before anything that costs money, deletes files, rewrites Git history, or publishes my real data.

## Secrets and privacy (strict)
- Never ask me to paste API keys or secrets into this chat. Give me a one-line command to run in a separate Terminal window instead, e.g. echo 'NAME=value' >> app/.env
- Secrets live only in app/.env (git-ignored). Never in browser code, logs, commits or docs. Check with git check-ignore before every push.
- Never show real people's names, real calendar entries or my real email anywhere public: docs/, README files, screenshots, commit messages, Networking_Studio_Codex_Prompt.md. Public screenshots must use demo data.
- PostHog session replay in the app must mask all text and inputs.

## Project
Networking Studio: students connect their calendar and get an AI prep brief before networking events (coffee chats, panels, info sessions). Course: NYU Stern "Building with AI". The repo is public. Product Page = docs/index.html on GitHub Pages; it must stay public, with no login. The app is in app/ (React + TypeScript + Vite) and runs locally with npm run dev. Commands are in AGENTS.md and app/README.md.

## Today: Build 2, due Monday Nov 16, 12:00 pm New York time
Requirements (assignment + professor email + Build 1 feedback):
- One full user action with a real AI/API call, shown on the Product Page with a screenshot.
- PostHog on the Product Page AND the local app: pageviews, clicks, session replay. The Product Page needs the official web snippet in <head> (public project token and correct host, never a personal API key) and the event clicked_try_product on its main button.
- PRD v2 on the Product Page: biggest risk, how this build tests it, how the app works, cost per run.
- AGENTS.md: project structure, setup and how to run.
- Updated Build 2 log: progress, lessons, problems, costs, hours.
- Build 1 feedback: a real AI brief for a newly added event, shown in a screenshot. (Fictional names in seed.ts: already done.)

## Today's scope, in this order
1. PostHog: page and app. Page event: clicked_try_product. App: pageviews on route change, event_opened, brief_generated, question_saved, chat_message_sent, contact_added, article_saved, signed_in, calendar_connected, event_classified_override.
2. OpenRouter AI brief: local server on port 8787 (never call AI from the browser); OPENROUTER_API_KEY in app/.env; cheap model with a max token limit. "Add event" form (title, date/time, company, person, role, notes). "Generate brief with AI" returns: event essentials, company overview, relevant products, 10 questions grouped by theme, "What to verify before the event". Never invent news, financial figures or facts about people; write "Not verified" when unsure. Label it "AI-generated draft". Show tokens and cost per run. npm run dev starts both the app and the server.
3. Personal login + Google Calendar: "Sign in with Google" in the app (OAuth on the local server, redirect http://localhost:8787/auth/google/callback). After sign-in, ask for read-only calendar access (calendar.readonly) and load the next 14 days. Sessions and tokens are stored only locally and git-ignored. Add sign out and disconnect. Demo mode stays available without login. If Google blocks my account, propose a fallback (e.g. the calendar's secret iCal address).
4. Networking classifier: rules first, AI only for ambiguous events (JSON: type, confidence, reason, company, person, role), cached. Exclude: course codes (e.g. "TECH-GB 2160"), class, lecture, recitation, section, exam, all-day events, declined events, events with no other attendees, out-of-office and focus time. Networking signals: coffee chat, networking, mixer, info session, panel, alumni, career, recruiting, mock interview, interview, "<name> <> <name>" titles, attendees with non-school email domains, my target companies. Extract the company from attendee email domains. Types: coffee_chat, networking_event, company_presentation, career_panel, mock_interview, interview, not_networking. Show a badge and reason; let me override, including "Ignore this recurring series"; remember overrides. Unit tests with 12+ example titles.
5. Documentation: Product Page (demo-data screenshots, PRD v2, Build 2 log), AGENTS.md, and remove real names from Networking_Studio_Codex_Prompt.md.
If time runs short, finish 1, 2 and 5 (the deliverables) before 3 and 4.

## Done when
- PostHog shows $pageview and clicked_try_product from the published page, and session replay works.
- The Product Page shows a screenshot of a real AI brief.
- Tests pass and everything is committed and pushed.
- You tell me exactly what to submit: Product Page link, repo link, PostHog screenshot.
