# Networking Studio — Prototype v2 (local demo)

An interactive frontend demo of Networking Studio: Calendar → Event → Brief → Questions/chat → back to Calendar, plus Contacts and Industry News with a visual Lab. React + TypeScript + Vite, with React Flow for the Lab and Lucide icons. No backend, no login, no API keys.

## Run it

Requires Node.js 18+ (tested with Node 26). All dependencies install locally into `app/node_modules`.

```bash
cd app
npm install        # first time only
npm run dev        # start at http://localhost:5173  (stop with Ctrl+C)
```

Other commands:

| Command | What it does |
|---|---|
| `npm run build` | Type-check and build to `dist/` |
| `npm run typecheck` | TypeScript check only |
| `npm test` | 27 interaction/logic tests (Vitest + Testing Library, jsdom) |
| `npm run e2e` | Browser smoke test in your installed Google Chrome at 1440px and 390px (run `npm run build` first) |
| `npm run preview` | Serve the production build |

## Demo data and reset

- **Fixed demo week:** Nov 9–15, 2026, no matter what today's date is. All event times display in **America/New_York**.
- **Fixed "now":** `2026-11-09T09:00:00-05:00` for brief statuses. Three briefs start Ready; Siemens starts Scheduled. Use "Generate demo brief now" to create it.
- **Persistence:** browser `localStorage`, key `networking-studio:v1`, with defensive parsing. If saved data is corrupt, the sample data is restored and a notice appears.
- **Reset:** Settings → Demo controls → *Reset demo data* (asks you to confirm first). You can also clear site data for `localhost:5173`.
- **Error-state fixture:** open `http://localhost:5173/calendar?fixture=storage-unavailable` to see the in-memory mode (changes are not saved, and a notice explains this).

## What is implemented

- **Calendar:** vertical day-by-day agenda, previous/next/demo-week controls, an empty-day state, brief status shown with text and icons, the 48h/24h timing labeled as simulated, and the same week plus scroll position restored when you come back from an event.
- **Event brief:** a document-style brief with 8 sections, each adapted to its event:
  - Joseph: the name comes from the calendar title; no role or employer is given.
  - Media night: no confirmed attendee list is shown, and there is an editable priority list.
  - GTM panel: 4 speakers from the event description, speaker chips, and multi-company cards.
  - Siemens: no named speaker and no invented program details.
- **Questions:** each event shows 10 grouped questions that you can save or copy. "Generate more questions" adds curated variants with duplicates removed, ranked by your target roles, and filtered by the Strategy/Role/Career focus. When no variants are left, it says so. Questions are stored per event.
- **Demo chat:** each event keeps its own chat. There are 3 shortcuts with event-specific answers and a short typing state. Free text gets keyword-matched replies, an honest "can't answer" fallback, and "Note:" saves a note.
- **Email preview:** a dialog that shows the reminder email. Nothing is sent.
- **Contacts:** a table on desktop and cards on mobile. Includes global search, 7 column filters combined with AND, filter chips, a result count, Clear filters, sorting (blank dates sort last), add/edit with validation, delete with confirmation, and a notes drawer.
- **Industry News:** New, Saved and Lab tabs that use one shared saved state. The selected tab is kept in the URL.
- **Lab:** industry hubs in a 2×2 layout on a dotted canvas, with pan, zoom, fit-to-view, reset layout and an industry filter.
  - Positions you drag are saved, and a drag does not open the drawer.
  - A newly saved article is placed so it doesn't overlap others.
  - Includes a summary drawer, a list view, and an empty state.
- **Settings:** profile; industries and roles in priority order (Move up/down); target companies with no duplicates; a demo Google Calendar connector; brief preferences; and reset. Includes Save/Cancel and validation. Priorities change the order of news groups and the goal context on screen.

## What is simulated (not real)

Google Calendar connection, brief generation, AI chat replies, the reminder email, and all news. News and financial sections are either illustrative examples (clearly labeled, with no source link) or designed empty states. The only external links are the two Stern event pages that were provided (which may need a Stern login) and company homepages, labeled as homepages.

## Known limitations

- The Lab map supports mouse and touch dragging. Keyboard users should use the List view, which is the default on narrow screens.
- The production build is one JavaScript bundle of about 450 KB, so Vite prints a size warning. That's fine for a demo.
- Changing industry priorities can move whole clusters around the Lab map. Article positions you set stay relative to their industry hub.

## Future integrations (live product, not in this demo)

- **Google Calendar OAuth:** read networking events.
- **Scheduled brief generation 48h before each event**, using an AI model plus research tools.
- **Email delivery 24h before each event.**
- **Live, linked news.**
- **Source requirements for the live product:** every news item and financial highlight must link to its original article or official investor-relations report. Company news must come from the preceding three months. Unknown facts must be stated as unknown. Profiles of people must not be built from scraped web data.
