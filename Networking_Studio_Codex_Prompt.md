# Networking Studio — build specification for Codex

Build the working prototype described below. Implement it, run it, and verify the main user flows; do not stop at a plan. Make reasonable implementation decisions within this scope. All user-facing copy must be in English.

## 1. Product and scope

Networking Studio helps students organize networking and arrive prepared for recruiting conversations. Initial audience: NYU Stern MBA students. The primary journey is Calendar → Event → Brief → Questions/chat → Back to calendar. Secondary journeys are managing contacts and saving industry news into a visual Industry Lab.

Build a polished interactive frontend demo with seeded data and local persistence. No login, backend, real Google OAuth, live AI, live news fetching, email delivery, scraping, job applications, resume analysis, notetaking integration, event recommendations, or contact recommendations. Do not request API keys. Future integrations must not block the demo.

Show a discreet persistent “Demo mode” badge. Settings must explain: “Sample data. Changes are saved in this browser. Calendar sync, AI responses, and email delivery are simulated.” Simulated actions must never claim a real connection, a sent email, or live research.

Use the existing repository conventions if present. Otherwise use React, TypeScript, Vite, CSS or Tailwind, Lucide icons, and a maintained React graph library such as React Flow for the Lab. Reuse installed compatible dependencies. No unnecessary backend architecture. Use browser localStorage with a versioned key, defensive parsing, and a reset-demo action with confirmation. Keep seed data and mock service functions separate from UI components.

## 2. Design direction

Personality: playful, composed, welcoming, academically credible. Make the experience feel like an organized personal studio. Use restrained rounded cards, crisp icons, small friendly illustrations made from simple shapes, generous whitespace, and subtle motion. Avoid excessive gradients, confetti, dense analytics dashboards, or childish visuals.

Design tokens:

| Role | Color |
|---|---|
| Page background | #FAF8FC |
| Surface | #FFFFFF |
| Soft lilac / selected background | #EEE5FF |
| Decorative lavender | #C4AFF2 |
| Primary action / active icon | #6D46B5 |
| Main text | #292238 |
| Secondary text | #686073 |
| Border | #E5DFEB |
| Mint accent | #DDF2E8 |
| Peach accent | #FFE5D6 |

Use dark text on pastel fills and white text on the dark primary button. Verify contrast, including muted text. Use a clean sans-serif such as Inter with system fallbacks. Body text 15–16px, readable line height, page headings 28–32px. Card radii 16px; controls 10px; subtle shadows. Motion 150–200ms with reduced-motion support.

Desktop: narrow left navigation, spacious content, persistent top header with avatar initials MV and a Settings gear at the upper right on every page. Navigation: Calendar, Contacts, Industry News. Lab lives inside Industry News. Calendar is the landing page, not a marketing page. On mobile use compact navigation and stacked content. Avoid whole-page horizontal overflow; only a contained table/map may pan horizontally.

## 3. Routes and navigation

- /calendar: weekly agenda.
- /events/:eventId: brief and chat.
- /contacts: contact tracker.
- /news: New, Saved, and Lab tabs; preserve selected tab.
- /settings: accessible via the upper-right gear; Back returns to prior screen.

Browser back/forward and direct links must work. Return from an event to the same calendar week and scroll position. Handle unknown event IDs with a friendly not-found screen.

## 4. Calendar

Heading: “Your networking week”. Subtitle: “A little preparation. Better conversations.” Show week range, Previous week, Next week, and “Demo week” controls. Default to November 9–15, 2026 regardless of the computer’s current date. Label it “Sample week · Nov 9–15, 2026”. Use America/New_York for all displayed event times and show the timezone.

Use a vertical daily agenda: Monday heading followed by its event cards in chronological order, then Tuesday, etc. This is a calendar organized by day, not a generic card grid. Show a quiet “No networking events” state on empty days. Each card includes time, title, event type, location, brief status, and a clear “Open brief” action. The whole card can open the event without interfering with other controls.

Seed only these four authorized calendar examples:

| ID | Date | Local start–end | Exact event title | Location | Type |
|---|---|---|---|---|---|
| joseph-mock | 2026-11-09 | 17:00–17:45 | NYU Stern: Alumni Tech Mock Interview - Joseph Morvan | US-NYC-9TH-5-E-305-Florent (4) [GVC, Preview] | Mock interview |
| media-night | 2026-11-09 | 18:00–20:00 | Entertainment Media & Sports Alumni Networking Night | KMC 11-85 (Abbe Bogen) | Networking night |
| gtm-panel | 2026-11-10 | 16:30–17:30 | A Day in the Life: Go-to-Market & Sales | KMC 2-70 | Career panel |
| siemens | 2026-11-12 | 16:30–18:00 | Presentation: Siemens: Company Overview and Programs | KMC 5-50 | Company presentation |

Store these as ISO timestamps with -05:00 offset, not date-only strings parsed in an arbitrary timezone. Preserve Joseph’s location text as calendar metadata; do not infer that it is a public meeting address or invent a meeting link.

For deterministic status demos set demoNow to 2026-11-09T09:00:00-05:00. Three earlier events have ready sample briefs; Siemens starts Scheduled. Show “Generate demo brief now” on scheduled events, so nobody needs to wait to explore. Its action transitions Scheduled → Generating → Ready after a short simulated delay. Prevent duplicate clicks and retain state on reload.

Display intended production timing: brief scheduled 48 hours before the event; email reminder scheduled 24 hours before. In demo mode label these as simulated schedules; no background emails or real timers spanning days. For already-ready seeded briefs say “Sample brief · production timing: 48 hours before”. Provide an email-preview action on the event page that opens a preview, never sends anything.

## 5. Event detail and brief

Use a calm document-style reading experience inspired by meeting-note apps, with a conversational panel below the brief. Header: Back to calendar, title, type, date/time, location, and sample-content badge. The brief should start with a concise preparation summary, followed by expandable detail. Avoid squeezing the complete research into two tiny pages.

Required sections:
1. Event essentials and what to prepare for.
2. People and roles, including known/unknown state.
3. Company overview, business model, and relevant products.
4. Latest financial-report highlights, if applicable and available.
5. Five company news items from the preceding three months in the eventual live product.
6. Five industry news items with “Why it matters”.
7. Ten suggested questions, grouped by company strategy, role/team, industry, and career advice, adapted to event type and career preferences.
8. Sources with descriptive link labels.

Demo content policy: use substantive sample preparation copy and sample questions, but label fictional news and financial examples explicitly as “Illustrative demo content”. Never fabricate a real-looking article URL, financial report, role, or quotation. Unknown facts must say “Not available in this demo”. A source area can link only to verified source URLs supplied here, or to a real corporate homepage clearly labeled as a homepage rather than as evidence of a fabricated claim. Missing financial data may be a designed empty state. For mock news use an honest “Sample article — no original source” state instead of a fake link. The final live product’s source requirements must remain documented in the README.

Adaptation by event:
- Joseph: known name, role/company not confirmed in supplied data. Focus on mock interview preparation, product reasoning practice, and questions for interviewer feedback. No invented employer or biography.
- Media night: multi-company networking, attendee list not provided. Say “Confirmed attendee list not available”. Do not present historical attendees as confirmed. Provide conversation starters and a user-editable list of companies to prioritize.
- GTM panel: use these speakers from the calendar description, labeled “From event description”: Anthony Abdelnour — BD & Partnerships at Fever; Josh Kravitz — Head of Partner and Growth Sales GTM at Amazon Ads; John O’Keefe — Customer Success Engineer at Swarmia; Naama Shaham — Technical Business Development Manager, DTC Partner Growth at The Walt Disney Company. Provide selectable speaker chips, multi-company overview cards, and questions tied to selected speakers. Do not treat this panel as one company.
- Siemens: company presentation with overview and program questions; no named speaker supplied. Do not invent program eligibility or application dates.

Provided event source links:
- Media night: https://nyustern.12twenty.com/events/30006101391449
- GTM panel: https://nyustern.12twenty.com/events/30006101389179
Label these “Event details (may require Stern login)”.

Questions: initially show ten relevant seeded questions for each event. Each can be saved/unsaved and copied. “Generate more questions” adds a small new batch from curated event-specific variants, deduplicates, and shows an honest exhausted state when variants run out. Allow selection of Strategy / Role / Career focus. Saved questions persist per event.

Chat: place a “Ask about this brief” composer below the document, with shortcuts “Give me a 60-second recap”, “Help me ask a stronger question”, and “What should I prioritize?”. Provide meaningful event-specific deterministic responses for these intents, with a short simulated typing state. Accept free text, retain messages per event, and explicitly say when the demo cannot answer a freeform request. Do not return the same generic answer to every prompt or claim live AI. Label “Demo assistant · sample responses”. Never let one event’s chat appear in another event.

## 6. Contacts

Heading: “Your people”. Use a readable table on desktop and labeled cards on mobile.

Fields: Name, Role, Company, Last contact, Open to referral?, Conversation notes. Referral options: Not asked yet, Yes, No, Unknown. Last contact must support blank values. Blank is “Not recorded”, not an invented date.

Provide global text search across all textual fields; column filters for name, role, company, last-contact date range, referral status, and notes. Combine filters with AND, support sorting, show result count, active-filter chips, Clear filters, and a useful no-results state.

Support Add contact, Edit contact, Delete with confirmation, and a side drawer for longer notes. Validate required name, allow optional role/company, preserve edits on reload, and show accessible save feedback.

Seed eight contacts. Include “Joe (Yannaphol Kaewbaidhoon)” at Mastercard and “Trip” at Warner Music, with unknown role/date/referral status unless supplied. Do not invent private conversation details for those real contacts. The other six contacts may be fictional and must be marked sample contacts; use varied roles, companies, dates, referral states, and short fictional notes to demonstrate filters. Use initials rather than scraped photos.

## 7. Industry News and Lab

Three tabs: New, Saved, Lab. All share the same article records and saved state. Each article has one primary industry for grouping plus optional topic tags. Default industries: Fintech & Payments, Technology & AI, Media & Entertainment, Industrial Technology. This is an illustrative initial profile; it is editable in Settings.

New: clean article cards with title, primary industry, topic chips, sample/source label, date, a short summary, “Why it matters for your goals”, Save/Unsave, and Open summary. Seed twelve illustrative articles across the four industries, with six initially saved. Mark all fictional articles as examples. Filter by industry and search. Order industry groups by user priority; within groups order by date. Unselected industries remain available through an All industries filter.

Saved: display bookmarked articles with industry filter and search. Saving anywhere updates Saved and Lab immediately with no duplicate records. Unsave removes the article from both Saved and Lab, retaining it in New.

Lab: an automatic mind map grouped BY INDUSTRY, inspired by a Fringe Sketch. Use a subtle dotted canvas, pastel industry hub nodes and smaller readable article-card nodes connected to the appropriate hub. No radial trend radar and no arbitrary topic-first grouping. Lay out industry clusters in a roomy 2×2 arrangement on desktop with sufficient separation and no initial overlap. Label each hub with industry name and article count. This is a curated map, not a dense hairball.

Support pan, zoom, fit-to-view, reset layout, industry filtering, dragging article nodes, and click-to-open a summary drawer. Persist user-moved node positions. A newly saved article gets a collision-aware default position within its industry cluster without resetting existing positions. Reset layout returns visible nodes to the automatic layout. Distinguish drag from click so moving a node does not open its drawer.

The drawer includes title, summary, why it matters, industry, source/date, Save/Unsave, and “Read full article” only when a genuine original-article URL exists. For mock articles explain “Illustrative article. Original source unavailable in this demo.” External links open safely in a new tab. Provide an accessible list-view toggle for keyboard users and narrow mobile screens. Do not implement manual edge creation, freeform sticky notes, AI clustering, or cross-industry inference in this version.

When nothing is saved, show “Your next conversation starts with a good idea” and “Explore news”; do not render an empty broken map.

## 8. Settings

Upper-right gear opens Settings from every screen. Sections:
- Profile: name, school/program, city, timezone, career-goal text.
- Industries: ordered multiselect with visible priority numbers.
- Target roles: ordered multiselect with visible priority numbers.
- Target companies: add/remove chips, prevent case-insensitive duplicates.
- Connectors: Google Calendar only. Clearly labeled demo connection with “Simulate connection” and disconnect. No real Google sign-in popup. Disconnect does not silently delete seeded demo events; explain they are local samples.
- Brief preferences: show 48h preparation and 24h email-reminder timing, with demo-only email-preview option.
- Demo controls: Reset demo data with confirmation.

Priority ordering must work with accessible Move up/Move down controls; drag-and-drop is optional. Provide Save and Cancel, success feedback, validation, and persistence. Changing priorities changes news group order and visible goal context. Mock question responses should reflect the selected focus/role through curated variants; never imply actual AI personalization.

Seed profile: Michaela, NYU Stern MBA, New York, America/New_York; target roles Product Management, Product Strategy, Innovation; target companies Mastercard, Microsoft, Amazon, Siemens. Mark as editable demo preferences rather than verified current recruiting choices.

## 9. Data and behavior

Use typed records for Profile, NetworkingEvent, Brief, Question, ChatMessage, Contact, Article, and LabNodePosition. Give all records stable IDs. Keep source provenance and illustrative-content flags in data rather than guessing in rendering. Use a single shared saved-article state, per-event chat/question state, and versioned persistence. Handle corrupt/unavailable localStorage gracefully; the app must still work in memory and explain when changes cannot persist.

All visible primary controls must work. Support loading, empty, error and success states where relevant. Do not simulate failures randomly. Provide an explicit developer fixture or documented way to inspect error states if implemented. Preserve state across route changes and browser refresh. Never display raw exceptions to users.

Accessibility: semantic buttons and headings, visible keyboard focus, associated input labels, Escape to close dialogs, sensible focus restoration, readable contrast, keyboard-operable tabs and filters, adequate touch targets, and a list alternative to the graph. Avoid relying on color alone for status.

## 10. Build sequence and verification

Implement in this order within one working project:
1. App shell, design tokens, routes, seed data, persistence.
2. Calendar → brief → questions/chat flow.
3. Contact CRUD and filters.
4. News save/unsave and industry Lab.
5. Settings and cross-screen state updates.
6. Responsive polish, accessibility, and verification.

Run appropriate build/type checks and meaningful interaction checks. Prefer existing testing infrastructure. Verify these acceptance criteria:
- Default agenda shows the exact four events, correctly ordered in New York time, even if opened months later.
- Each event opens its own substantive brief and returns to the same week.
- Siemens can generate a demo brief immediately; repeated clicks do not duplicate work.
- Multi-person events show multiple people or explicit missing-attendee information.
- Generating/saving questions and chatting work per event and survive refresh.
- Contact edits persist; all described filters combine correctly; clearing filters restores results.
- Saving one article adds exactly one Saved card and one Lab article node in its industry.
- Unsave removes it from both Saved and Lab.
- Dragging a Lab article persists its position; opening its drawer still works; reset layout works.
- Settings priorities persist and reorder news groups. Cancel discards unsaved changes.
- Calendar connection and email preview never perform or imply real external actions.
- No invented article source links, financial claims, or biographies are presented as verified facts.
- Main flows remain usable at approximately 1440px desktop and 390px mobile widths.
- No broken routes, missing keys, uncaught errors, or dead primary buttons.

Deliver the runnable project and a concise README with install/run/build commands, data-reset instructions, the fixed demo date/timezone, implementation summary, verified checks, known limitations, and a clearly separated future-integration section. If git is available, follow existing repository practices and avoid overwriting unrelated user changes. Do not deploy publicly unless explicitly requested. At completion state exactly what was implemented, how to run it, what was checked, and what remains simulated.
