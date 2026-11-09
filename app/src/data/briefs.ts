// Seeded sample briefs. Policy:
// - No invented biographies, roles, quotations, article URLs or financial figures.
// - Unknown facts say "Not available in this demo".
// - News items are fictional and flagged `illustrative: true` with no source URL.
// - Source links are limited to the event pages supplied in the spec and real corporate homepages.
import type { Brief, BriefNewsItem, Question, QuestionCategory, SourceLink } from '../types';

function news(id: string, title: string, summary: string, whyItMatters?: string): BriefNewsItem {
  return { id, title, summary, whyItMatters, illustrative: true, sourceUrl: null };
}

function q(eventId: string, n: number | string, category: QuestionCategory, text: string, extra: Partial<Question> = {}): Question {
  return { id: `${eventId}-q${n}`, eventId, category, text, ...extra };
}

const home = (id: string, company: string, url: string): SourceLink => ({ id, label: `${company} — company homepage`, url, kind: 'homepage' });

const EVENT_PAGE_LABEL = 'Event details (may require Stern login)';

// ---------------------------------------------------------------------------
// Joseph Morvan — alumni mock interview
// ---------------------------------------------------------------------------
const J = 'joseph-mock';
const joseph: Brief = {
  eventId: J,
  summary:
    'A 45-minute, alumni-led mock interview for tech roles. Treat it as practice, not evaluation: give one structured product answer, ask for direct feedback, and leave with two concrete things to improve before real interviews.',
  prepareFor: [
    'Practice one product-design answer out loud (for example, “improve an app you use every day”) using a clear structure: user, problem, options, prioritization, success metrics.',
    'Prepare a 60-second “why product, why tech” story that connects your background to your goal of shaping product strategy.',
    'Have one metrics question ready to practice, such as choosing a north-star metric for a feature.',
    'Bring a notebook and plan to ask for one specific thing to fix, not general impressions.',
    'Confirm the format with the organizer. The location below is shown exactly as it appears in the calendar.',
  ],
  people: [{ id: 'p-joseph', name: 'Joseph Morvan', provenance: 'calendar-title' }],
  peopleNote:
    'Joseph Morvan’s name comes from the calendar title. His role and employer are not confirmed in the supplied data. Ask him at the start rather than assuming.',
  companiesHeading: 'Company overview & relevant products',
  companies: [],
  companiesNote:
    'No company is confirmed for this mock interview. Practice product reasoning on products you know well — for example, products from your target companies.',
  financials: { kind: 'not-applicable', reason: 'This is a practice interview, not a company event, so there are no financial highlights to review.' },
  companyNews: [],
  companyNewsNote:
    'Not applicable: no company is confirmed for this event. In the live product, this section lists five news items from the last three months for the person’s company when it is known.',
  industryNews: [
    news('j-in1', 'Example: Interviewers ask more about AI product judgment', 'An illustrative trend: product interviews increasingly include a question on when an AI feature is (and is not) the right solution.', 'Prepare a short point of view on evaluating an AI feature by user value and risk, not novelty.'),
    news('j-in2', 'Example: Metrics questions focus on outcomes over activity', 'An illustrative scenario in which interviewers push candidates past vanity metrics toward retention and task success.', 'Practice naming one outcome metric and one guardrail metric for any product you discuss.'),
    news('j-in3', 'Example: Teams expect PMs to work closely with data and design', 'An illustrative look at product roles that emphasize collaboration across engineering, design and analytics.', 'Have one story ready that shows how you worked across functions.'),
    news('j-in4', 'Example: Companies hire fewer generalists for early-career PM roles', 'An illustrative picture of a market where candidates stand out with a clear domain focus.', 'Be ready to explain why your target industries (payments, AI, media, industrial tech) fit you.'),
    news('j-in5', 'Example: Case interviews include more real product critiques', 'An illustrative trend toward asking candidates to critique a live product instead of a hypothetical one.', 'Pick two products from your target companies and practice a five-minute critique of each.'),
  ],
  sources: [],
  questions: [
    q(J, 1, 'strategy', 'In my product answer, was my prioritization convincing? What would have made it stronger?'),
    q(J, 2, 'strategy', 'How do strong candidates explain trade-offs between user value and business impact?'),
    q(J, 3, 'role', 'Which part of my answer sounded least like a product manager, and why?'),
    q(J, 4, 'role', 'How would you judge my choice of success metrics if this were a real interview?'),
    q(J, 5, 'role', 'What signals in the first five minutes tell an interviewer a candidate is strong?'),
    q(J, 6, 'industry', 'Which technology trends do interviewers expect candidates to have an opinion on right now?'),
    q(J, 7, 'industry', 'How can I talk about AI features in a product case without sounding generic?'),
    q(J, 8, 'career', 'What is one habit I should practice every day before real interviews?'),
    q(J, 9, 'career', 'When you were recruiting, what helped you prepare most for interviews?'),
    q(J, 10, 'career', 'Would you be open to a short follow-up practice session after I work on your feedback?'),
  ],
  questionVariants: [
    q(J, 'v1', 'strategy', 'If I had five more minutes, which part of my answer should I have gone deeper on?', { roles: ['Product Strategy'] }),
    q(J, 'v2', 'strategy', 'How would you have scoped the problem differently from me?'),
    q(J, 'v3', 'role', 'Did I ask enough clarifying questions before jumping to solutions?', { roles: ['Product Management'] }),
    q(J, 'v4', 'role', 'How should I talk about working with engineers when I do not have a technical background?', { roles: ['Product Management'] }),
    q(J, 'v5', 'role', 'How would my answer change for an innovation or new-products team?', { roles: ['Innovation'] }),
    q(J, 'v6', 'career', 'Which kinds of companies do you think fit my profile best for product roles?'),
    q(J, 'v7', 'career', 'What do candidates from MBA programs often get wrong in product interviews?'),
  ],
  chat: {
    recap:
      '60-second recap: This is a 45-minute alumni mock interview with Joseph Morvan, focused on tech roles. His role and employer are not confirmed, so ask at the start. Your goal is practice: give one structured product answer (user → problem → options → prioritization → metrics), then ask for specific feedback. Leave with two things to fix and, if it feels natural, ask about a follow-up session.',
    strongerQuestion:
      'Instead of “How did I do?”, try: “Which single part of my answer would most likely cost me an offer, and what would a stronger version sound like?” It is specific, invites honest feedback, and gives you something concrete to practice.',
    prioritize:
      'Prioritize in this order:\n1. One clean, structured product answer.\n2. Specific feedback on prioritization and metrics.\n3. Your 60-second “why product” story.\nSkip broad company research — no company is confirmed for this session.',
    people:
      'Joseph Morvan is named in the calendar title. His role and company are not available in this demo, so don’t assume them — a simple “Could you tell me a bit about your current role?” is a good opener.',
    company:
      'No company is confirmed for this mock interview. A good use of prep time is practicing a product critique of something from one of your target companies.',
  },
};

// ---------------------------------------------------------------------------
// Entertainment Media & Sports Alumni Networking Night
// ---------------------------------------------------------------------------
const M = 'media-night';
const media: Brief = {
  eventId: M,
  summary:
    'A two-hour alumni networking night focused on entertainment, media and sports. Several companies may be represented, but no confirmed attendee list was provided. Aim for three or four real conversations rather than many short ones, and capture names right after each.',
  prepareFor: [
    'A 30-second introduction that links your interest in media to product and strategy work.',
    'A short list of companies to prioritize (edit it below) so you know who to look for.',
    'Two or three conversation starters about trends in streaming, music, sports or live events.',
    'A simple follow-up plan: ask if you can follow up, then add each person to Contacts the same evening.',
    'An easy exit line so you can move between conversations politely.',
  ],
  people: [],
  peopleNote:
    'Confirmed attendee list not available. People who attended similar events in the past are not shown here as confirmed attendees. Add the people you meet to Contacts afterwards.',
  companiesHeading: 'Companies to prioritize',
  companies: [],
  companiesNote:
    'This is a multi-company event. Use the editable list below to decide who you most want to meet. It is your plan, not a list of confirmed attendees.',
  priorityCompaniesSeed: ['Warner Music', 'Streaming platforms', 'Sports leagues & teams', 'Live events & ticketing'],
  conversationStarters: [
    '“What part of the business are you most excited about this year?”',
    '“How is your team thinking about fans who pay for premium experiences?”',
    '“How has the shift to streaming changed the way your team works?”',
    '“What do people from business school often underestimate about working in media?”',
    '“Is there someone else here tonight you think I should meet?”',
  ],
  financials: { kind: 'not-applicable', reason: 'This is a multi-company networking event, so there is no single company’s financial report to summarize.' },
  companyNews: [
    news('m-cn1', 'Example: A music company tests a premium tier for superfans', 'An illustrative scenario of a label offering early access and exclusive content to dedicated fans.'),
    news('m-cn2', 'Example: A streaming service adds live sports to its ad-supported plan', 'An illustrative look at bundling sports with cheaper plans to keep subscribers.'),
    news('m-cn3', 'Example: A sports team launches a direct-to-fan app', 'An illustrative case of a team selling tickets, merchandise and content in one app.'),
    news('m-cn4', 'Example: A studio licenses older shows to several platforms', 'An illustrative shift from exclusive deals toward wider licensing.'),
    news('m-cn5', 'Example: A live-events platform expands to new cities', 'An illustrative story of an events marketplace growing through local partnerships.'),
  ],
  companyNewsNote: 'In the live product, these would be five real news items from the last three months for the companies you prioritize.',
  industryNews: [
    news('m-in1', 'Example: Ad-supported streaming keeps growing', 'An illustrative trend of viewers choosing cheaper plans with ads.', 'Advertising products are creating new product and partnership roles in media.'),
    news('m-in2', 'Example: Sports rights move to streaming platforms', 'An illustrative scenario of leagues splitting rights between TV and streaming.', 'A natural conversation starter with anyone working in sports media.'),
    news('m-in3', 'Example: Music companies invest in fan data', 'An illustrative look at labels using listening data to plan releases and tours.', 'Shows where product and analytics skills fit inside music companies.'),
    news('m-in4', 'Example: Live experiences compete for weekend time', 'An illustrative trend of immersive events and pop-ups competing with streaming.', 'Useful if you meet people from live entertainment or ticketing.'),
    news('m-in5', 'Example: Media companies test AI tools in production', 'An illustrative scenario of studios using AI for editing and localization.', 'Connects your AI interest to media — ask how teams decide what to automate.'),
  ],
  sources: [{ id: 'm-src-1', label: EVENT_PAGE_LABEL, url: 'https://nyustern.12twenty.com/events/30006101391449', kind: 'event-page' }],
  questions: [
    q(M, 1, 'strategy', 'Where do you see the biggest growth opportunity for your company in the next two years?'),
    q(M, 2, 'strategy', 'How is your team balancing subscriptions, advertising and live revenue?'),
    q(M, 3, 'role', 'What does a typical week look like in your role?'),
    q(M, 4, 'role', 'Where do product or strategy people add the most value on your team?'),
    q(M, 5, 'role', 'How do business and creative teams make decisions together at your company?'),
    q(M, 6, 'industry', 'How is the move to streaming changing the way your part of the industry works?'),
    q(M, 7, 'industry', 'Which trend in media or sports do you think people are underestimating?'),
    q(M, 8, 'career', 'What helped you most when you moved into entertainment or sports?'),
    q(M, 9, 'career', 'What would you recommend an MBA student do this year to break into media?'),
    q(M, 10, 'career', 'Is there anyone else here tonight you think I should talk to?'),
  ],
  questionVariants: [
    q(M, 'v1', 'strategy', 'How does your company decide which fan experiences to build next?', { roles: ['Product Strategy', 'Innovation'] }),
    q(M, 'v2', 'strategy', 'Which partnerships matter most to your business right now?'),
    q(M, 'v3', 'role', 'How does your company use data to understand fans or listeners?', { roles: ['Product Management'] }),
    q(M, 'v4', 'role', 'Are there teams working on new products or innovation where MBAs typically join?', { roles: ['Innovation'] }),
    q(M, 'v5', 'career', 'What skills from outside media turned out to be most useful for you?'),
    q(M, 'v6', 'career', 'Would it be okay if I followed up with a couple of questions next week?'),
  ],
  chat: {
    recap:
      '60-second recap: A two-hour alumni networking night for entertainment, media and sports. There is no confirmed attendee list, so plan around the companies you want to prioritize (your list is in section 3). Aim for three or four good conversations: introduce yourself in 30 seconds, use a trend-based starter, ask one thoughtful question, and ask if you can follow up. Add everyone to Contacts the same evening.',
    strongerQuestion:
      'Instead of “What do you do?”, try: “What part of your business is changing fastest right now, and how is your team responding?” It shows curiosity about their work and gives you a natural follow-up.',
    prioritize:
      'Prioritize:\n1. Find people from the top two companies on your list.\n2. Have three real conversations, not ten quick ones.\n3. Ask each person if you can follow up — then log them in Contacts tonight.',
    people:
      'Confirmed attendee list not available. I won’t guess who will be there. Bring a few conversation starters and add the people you meet to Contacts.',
    company:
      'This is a multi-company event. Your priority list in section 3 is the best guide — edit it so you know who to look for first.',
  },
};

// ---------------------------------------------------------------------------
// A Day in the Life: Go-to-Market & Sales (panel)
// ---------------------------------------------------------------------------
const G = 'gtm-panel';
const gtm: Brief = {
  eventId: G,
  summary:
    'A one-hour career panel on go-to-market and sales roles, with four speakers from four different companies. Listen for how each company sells and partners, and prepare one question per speaker you care most about. It is a panel, so keep questions short and relevant to the whole room.',
  prepareFor: [
    'Pick one or two speakers whose work is closest to your goals (use the speaker chips below).',
    'Understand how each company makes money — partnerships and sales look very different at an events platform, an ads business, a software startup and a large media company.',
    'Prepare one short question for the Q&A and one for a conversation after the panel.',
    'Notice how each speaker describes working with product teams; it helps you compare GTM and product roles.',
  ],
  people: [
    { id: 'sp-anthony', name: 'Anthony Abdelnour', role: 'BD & Partnerships', company: 'Fever', provenance: 'event-description' },
    { id: 'sp-josh', name: 'Josh Kravitz', role: 'Head of Partner and Growth Sales GTM', company: 'Amazon Ads', provenance: 'event-description' },
    { id: 'sp-john', name: 'John O’Keefe', role: 'Customer Success Engineer', company: 'Swarmia', provenance: 'event-description' },
    { id: 'sp-naama', name: 'Naama Shaham', role: 'Technical Business Development Manager, DTC Partner Growth', company: 'The Walt Disney Company', provenance: 'event-description' },
  ],
  peopleNote: 'Names and roles come from the event description. No other background is included in this demo.',
  companiesHeading: 'Company overviews (four companies)',
  companies: [
    {
      id: 'co-fever',
      name: 'Fever',
      overview: 'A live-entertainment discovery platform that helps people find and book local events and experiences.',
      businessModel: 'Earns revenue from ticket and experience sales, working with venues, creators and brand partners.',
      products: ['Consumer app and website for discovering events', 'Ticketed experiences created with partners'],
      personIds: ['sp-anthony'],
      homepage: home('g-src-fever', 'Fever', 'https://feverup.com'),
    },
    {
      id: 'co-amazon-ads',
      name: 'Amazon Ads',
      overview: 'Amazon’s advertising business, which helps brands reach customers across Amazon’s store and media properties.',
      businessModel: 'Advertisers pay for ad placements and campaigns; partners help brands plan and run them.',
      products: ['Sponsored ads in Amazon’s store', 'Display and video advertising', 'Measurement and audience tools'],
      personIds: ['sp-josh'],
      homepage: home('g-src-amazon-ads', 'Amazon Ads', 'https://advertising.amazon.com'),
    },
    {
      id: 'co-swarmia',
      name: 'Swarmia',
      overview: 'A software company that gives engineering teams visibility into how they work and where they can improve.',
      businessModel: 'Subscription software (SaaS) sold to engineering organizations; customer success helps teams adopt it.',
      products: ['Engineering metrics and insights', 'Tools that support team working agreements'],
      personIds: ['sp-john'],
      homepage: home('g-src-swarmia', 'Swarmia', 'https://www.swarmia.com'),
    },
    {
      id: 'co-disney',
      name: 'The Walt Disney Company',
      overview: 'A global entertainment company spanning studios, streaming, parks and experiences, and consumer products.',
      businessModel: 'Revenue from streaming subscriptions, advertising, parks and experiences, content licensing and merchandise.',
      products: ['Direct-to-consumer streaming services', 'Parks and experiences', 'Film and TV studios'],
      personIds: ['sp-naama'],
      homepage: home('g-src-disney', 'The Walt Disney Company', 'https://thewaltdisneycompany.com'),
    },
  ],
  financials: {
    kind: 'unavailable',
    reason:
      'Amazon and The Walt Disney Company are public companies, but their latest reported results are not summarized in this demo. Fever and Swarmia are private, so detailed financials may not be public. In the live product, this section links to official investor-relations sources.',
  },
  companyNews: [
    news('g-cn1', 'Example: An events platform signs new venue partnerships', 'An illustrative story about expanding through local partners.'),
    news('g-cn2', 'Example: An ads business adds new measurement tools for brands', 'An illustrative look at proving advertising results to partners.'),
    news('g-cn3', 'Example: A developer-tools startup grows its customer success team', 'An illustrative scenario about helping customers adopt software.'),
    news('g-cn4', 'Example: A media company expands streaming distribution partners', 'An illustrative case of reaching viewers through device and telecom partners.'),
    news('g-cn5', 'Example: Companies shift sales teams toward partner-led growth', 'An illustrative trend across all four types of companies.'),
  ],
  companyNewsNote: 'In the live product, these would be real news items from the last three months for each speaker’s company.',
  industryNews: [
    news('g-in1', 'Example: Partner-led growth becomes a core GTM strategy', 'An illustrative trend of companies growing through partners rather than only direct sales.', 'Partnership roles often sit close to product — a useful bridge to your product goals.'),
    news('g-in2', 'Example: Retail media networks attract more ad budgets', 'An illustrative look at retailers selling ads based on shopper data.', 'Helps you ask informed questions about advertising businesses.'),
    news('g-in3', 'Example: Customer success teams are measured on expansion', 'An illustrative scenario where CS teams own renewal and growth targets.', 'Shows how post-sale roles shape product feedback loops.'),
    news('g-in4', 'Example: Streaming services grow through distribution deals', 'An illustrative trend of bundles with telecom and device partners.', 'Relevant to direct-to-consumer partner growth roles.'),
    news('g-in5', 'Example: Experiences and events use data to price and promote', 'An illustrative look at data-driven marketing in live entertainment.', 'A good bridge between GTM, product and analytics.'),
  ],
  sources: [
    { id: 'g-src-event', label: EVENT_PAGE_LABEL, url: 'https://nyustern.12twenty.com/events/30006101389179', kind: 'event-page' },
    home('g-src-fever', 'Fever', 'https://feverup.com'),
    home('g-src-amazon-ads', 'Amazon Ads', 'https://advertising.amazon.com'),
    home('g-src-swarmia', 'Swarmia', 'https://www.swarmia.com'),
    home('g-src-disney', 'The Walt Disney Company', 'https://thewaltdisneycompany.com'),
  ],
  questions: [
    q(G, 1, 'strategy', 'How do you decide which partners are worth investing in first?', { personId: 'sp-anthony' }),
    q(G, 2, 'role', 'What does success look like in a BD & Partnerships role at an events platform?', { personId: 'sp-anthony' }),
    q(G, 3, 'strategy', 'How do partner and growth sales teams work with the product organization at Amazon Ads?', { personId: 'sp-josh' }),
    q(G, 4, 'industry', 'What are advertisers asking for most from ad platforms right now?', { personId: 'sp-josh' }),
    q(G, 5, 'role', 'How does a customer success engineer turn customer feedback into product changes?', { personId: 'sp-john' }),
    q(G, 6, 'strategy', 'How do you help customers see value early in a software subscription?', { personId: 'sp-john' }),
    q(G, 7, 'role', 'What makes a business development role “technical” in direct-to-consumer partner growth?', { personId: 'sp-naama' }),
    q(G, 8, 'industry', 'How do distribution partners shape the growth of a streaming service?', { personId: 'sp-naama' }),
    q(G, 9, 'career', 'For someone aiming at product roles, what GTM experience would you recommend getting first?'),
    q(G, 10, 'career', 'What surprised each of you most about working in go-to-market?'),
  ],
  questionVariants: [
    q(G, 'v1', 'strategy', 'How do you balance short-term partner revenue with long-term brand fit?', { personId: 'sp-anthony', roles: ['Product Strategy'] }),
    q(G, 'v2', 'role', 'Which metrics matter most for partner growth sales?', { personId: 'sp-josh', roles: ['Product Management'] }),
    q(G, 'v3', 'role', 'How technical does a customer success engineer need to be day to day?', { personId: 'sp-john' }),
    q(G, 'v4', 'strategy', 'How do you evaluate a new distribution partnership for a streaming product?', { personId: 'sp-naama', roles: ['Product Strategy', 'Innovation'] }),
    q(G, 'v5', 'career', 'How do people move between GTM and product roles at your companies?', { roles: ['Product Management'] }),
    q(G, 'v6', 'career', 'What would you look for in an MBA intern on your team?'),
    q(G, 'v7', 'strategy', 'Where do you see new partnership models emerging in your industry?', { roles: ['Innovation'] }),
  ],
  chat: {
    recap:
      '60-second recap: A one-hour panel on go-to-market and sales with four speakers from four companies — Anthony Abdelnour (BD & Partnerships, Fever), Josh Kravitz (Partner and Growth Sales GTM, Amazon Ads), John O’Keefe (Customer Success Engineer, Swarmia) and Naama Shaham (Technical BD, DTC Partner Growth, Disney). Treat it as four different businesses, not one. Pick one or two speakers closest to your product goals and prepare one short question for each.',
    strongerQuestion:
      'Instead of “What’s your day like?”, try for Josh or Naama: “How do partner teams and product teams decide together what to build for partners?” It connects GTM to your product interest and works for a panel audience.',
    prioritize:
      'Prioritize:\n1. Choose one or two speakers (the chips in section 2 help).\n2. Ask one short Q&A question that the whole room benefits from.\n3. After the panel, speak to one speaker and ask about GTM ↔ product collaboration.',
    people:
      'From the event description: Anthony Abdelnour (BD & Partnerships, Fever); Josh Kravitz (Head of Partner and Growth Sales GTM, Amazon Ads); John O’Keefe (Customer Success Engineer, Swarmia); Naama Shaham (Technical Business Development Manager, DTC Partner Growth, The Walt Disney Company). No other background is included in this demo.',
    company:
      'Four companies, four business models: Fever (events and experiences), Amazon Ads (advertising), Swarmia (software subscription for engineering teams) and Disney (entertainment, streaming and parks). See the overview cards in section 3.',
  },
};

// ---------------------------------------------------------------------------
// Siemens company presentation
// ---------------------------------------------------------------------------
const S = 'siemens';
const siemens: Brief = {
  eventId: S,
  summary:
    'A 90-minute company presentation about Siemens and its programs. Listen for how the business is organized and which programs fit MBA students. Prepare questions about technology strategy and about the programs themselves — eligibility and dates are not included in this demo, so ask directly.',
  prepareFor: [
    'Understand the main areas Siemens works in: industrial automation and software, buildings and grids, and transport.',
    'Think about where product and innovation roles fit in an industrial technology company.',
    'Prepare one question on technology strategy and one on the programs.',
    'Note the presenters’ names and roles during the event — no speaker was named in the calendar.',
    'Siemens is on your target-company list, so plan a follow-up step (for example, connecting with one presenter).',
  ],
  people: [],
  peopleNote: 'No named speaker was supplied for this presentation. Note presenters’ names and roles during the event.',
  companiesHeading: 'Company overview & relevant products',
  companies: [
    {
      id: 'co-siemens',
      name: 'Siemens',
      overview: 'A global technology company working across industry, infrastructure, transport and healthcare.',
      businessModel: 'Sells hardware, software and services to industrial, infrastructure and transport customers.',
      products: ['Industrial automation and software', 'Building and power-grid technology', 'Rail and transport solutions'],
      homepage: home('s-src-home', 'Siemens', 'https://www.siemens.com'),
    },
  ],
  financials: {
    kind: 'unavailable',
    reason:
      'Siemens is a public company, but its latest reported results are not summarized in this demo. In the live product, this section links to Siemens’ official investor-relations reports.',
  },
  companyNews: [
    news('s-cn1', 'Example: An industrial company expands its digital-twin software', 'An illustrative scenario of virtual factory models sold as software.'),
    news('s-cn2', 'Example: An infrastructure firm wins a grid modernization project', 'An illustrative story about software and hardware for electrification.'),
    news('s-cn3', 'Example: A rail technology unit launches a new signaling product', 'An illustrative look at digital signaling in transport.'),
    news('s-cn4', 'Example: An industrial company partners on AI for engineers', 'An illustrative case of AI assistants for automation engineers.'),
    news('s-cn5', 'Example: An industrial technology firm grows its graduate programs', 'An illustrative note about early-career hiring. Ask presenters about real program details.'),
  ],
  companyNewsNote: 'In the live product, these would be real Siemens news items from the last three months.',
  industryNews: [
    news('s-in1', 'Example: Manufacturers scale digital twins', 'An illustrative trend of linking virtual models across factories.', 'Shows where software product roles are growing inside industrial companies.'),
    news('s-in2', 'Example: Electrification drives grid software demand', 'An illustrative look at utilities buying tools to manage new loads.', 'A strong theme for strategy questions to industrial companies.'),
    news('s-in3', 'Example: Industrial AI moves from pilots to production', 'An illustrative scenario of AI used for maintenance and quality checks.', 'Connects your AI interest with industrial technology.'),
    news('s-in4', 'Example: Software subscriptions grow in industrial markets', 'An illustrative shift from one-time sales to recurring software revenue.', 'Business-model change creates product and pricing roles.'),
    news('s-in5', 'Example: Companies invest in resilient supply chains', 'An illustrative trend toward regional manufacturing and better planning tools.', 'A good topic for questions on strategy and operations.'),
  ],
  sources: [home('s-src-home', 'Siemens', 'https://www.siemens.com')],
  questions: [
    q(S, 1, 'strategy', 'Which parts of the business do you expect to grow fastest over the next few years?'),
    q(S, 2, 'strategy', 'How is Siemens balancing hardware and software in its strategy?'),
    q(S, 3, 'strategy', 'Where does AI fit into Siemens’ products today?'),
    q(S, 4, 'role', 'Where do product managers sit at Siemens, and how do they work with engineering?'),
    q(S, 5, 'role', 'What kinds of projects do people in your programs work on in their first year?'),
    q(S, 6, 'industry', 'How are customers’ expectations of industrial software changing?'),
    q(S, 7, 'industry', 'How does electrification change what customers need from Siemens?'),
    q(S, 8, 'career', 'Which programs are open to MBA students, and how do candidates usually apply?'),
    q(S, 9, 'career', 'What background do successful people in your programs tend to have?'),
    q(S, 10, 'career', 'Who would be a good person to follow up with after today?'),
  ],
  questionVariants: [
    q(S, 'v1', 'strategy', 'How does Siemens decide which new technologies to invest in?', { roles: ['Innovation', 'Product Strategy'] }),
    q(S, 'v2', 'strategy', 'How does Siemens compete with software-only companies?', { roles: ['Product Strategy'] }),
    q(S, 'v3', 'role', 'How are product teams measured at Siemens?', { roles: ['Product Management'] }),
    q(S, 'v4', 'role', 'Are there innovation or venture teams that MBA hires can join?', { roles: ['Innovation'] }),
    q(S, 'v5', 'career', 'Are there roles in the U.S. that combine strategy and product?'),
    q(S, 'v6', 'career', 'What advice would you give someone moving into industrial technology from another industry?'),
  ],
  chat: {
    recap:
      '60-second recap: A 90-minute Siemens company presentation covering the company and its programs. Siemens works across industrial automation and software, buildings and grids, and transport. No speaker was named, so note presenters during the event. Program eligibility and dates are not in this demo — ask about them directly. Siemens is on your target list, so plan one follow-up.',
    strongerQuestion:
      'Instead of “What programs do you have?”, try: “For someone aiming at product roles, which program gives the most exposure to software and digital products, and what does a typical first project look like?” It is specific and shows you understand the business.',
    prioritize:
      'Prioritize:\n1. Learn which programs are open to MBA students and how to apply.\n2. Ask one technology-strategy question (hardware vs. software, or AI).\n3. Get the name of one presenter to follow up with.',
    people: 'No named speaker was supplied for this presentation. Note presenters’ names and roles during the event, then add them to Contacts.',
    company:
      'Siemens is a global technology company working in industrial automation and software, building and grid technology, and rail and transport. See section 3 for the overview and the company homepage link.',
  },
};

export const BRIEFS: Record<string, Brief> = {
  [J]: joseph,
  [M]: media,
  [G]: gtm,
  [S]: siemens,
};

export function getBrief(eventId: string): Brief | undefined {
  return BRIEFS[eventId];
}
