// Typed records for Networking Studio. All records have stable IDs.
// Provenance and "illustrative" flags live in the data, not in rendering logic.

export type ISODateTime = string; // always with an explicit offset, e.g. 2026-11-09T17:00:00-05:00
export type ISODate = string; // YYYY-MM-DD

export interface Profile {
  name: string;
  program: string;
  city: string;
  timezone: string;
  careerGoal: string;
  /** Ordered by priority (index 0 = priority 1). */
  industries: string[];
  /** Ordered by priority. */
  roles: string[];
  companies: string[];
  showEmailPreview: boolean;
}

export type SourceKind = 'event-page' | 'homepage';

export interface SourceLink {
  id: string;
  label: string;
  url: string;
  kind: SourceKind;
}

export type EventType =
  | 'Mock interview'
  | 'Networking night'
  | 'Career panel'
  | 'Company presentation'
  | 'Coffee chat'
  | 'Interview'
  | 'Other';

export interface NetworkingEvent {
  id: string;
  title: string;
  start: ISODateTime;
  end: ISODateTime;
  location: string;
  /** Explains how to read the location (e.g. it is calendar metadata, not an address). */
  locationNote?: string;
  type: EventType;
  /** Brief status at seed time; runtime status lives in persisted state. */
  seedBriefStatus: BriefStatus;
}

export type BriefStatus = 'scheduled' | 'generating' | 'ready';

export type PersonProvenance = 'calendar-title' | 'event-description';

export interface Person {
  id: string;
  name: string;
  /** Undefined means "Not available in this demo". */
  role?: string;
  company?: string;
  provenance: PersonProvenance;
}

export interface CompanyCard {
  id: string;
  name: string;
  overview: string;
  businessModel: string;
  products: string[];
  /** Person IDs connected to this company (panel events). */
  personIds?: string[];
  homepage?: SourceLink;
}

export type FinancialsState =
  | { kind: 'not-applicable'; reason: string }
  | { kind: 'unavailable'; reason: string };

export interface BriefNewsItem {
  id: string;
  title: string;
  summary: string;
  whyItMatters?: string;
  /** All demo news is illustrative; there is no original source. */
  illustrative: true;
  sourceUrl: null;
}

export type QuestionCategory = 'strategy' | 'role' | 'industry' | 'career';

export interface Question {
  id: string;
  eventId: string;
  text: string;
  category: QuestionCategory;
  /** Ties a question to a specific panel speaker. */
  personId?: string;
  /** Curated variants can be tagged with roles they suit best. */
  roles?: string[];
}

export interface Brief {
  eventId: string;
  summary: string;
  prepareFor: string[];
  people: Person[];
  /** Shown when the attendee list is unknown or incomplete. */
  peopleNote?: string;
  companiesHeading: string;
  companies: CompanyCard[];
  /** Shown instead of company cards when no company is confirmed. */
  companiesNote?: string;
  /** Media night: starter list the user can edit. */
  priorityCompaniesSeed?: string[];
  conversationStarters?: string[];
  financials: FinancialsState;
  companyNews: BriefNewsItem[];
  companyNewsNote?: string;
  industryNews: BriefNewsItem[];
  sources: SourceLink[];
  /** First ten questions shown by default. */
  questions: Question[];
  /** Curated extra variants for "Generate more questions". */
  questionVariants: Question[];
  chat: {
    recap: string;
    strongerQuestion: string;
    prioritize: string;
    people: string;
    company: string;
  };
}

export interface ChatMessage {
  id: string;
  eventId: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: ISODateTime;
}

export type ReferralStatus = 'not-asked' | 'yes' | 'no' | 'unknown';

export interface Contact {
  id: string;
  name: string;
  role: string;
  company: string;
  /** Empty string = "Not recorded". */
  lastContact: ISODate | '';
  referral: ReferralStatus;
  notes: string;
  isSample: boolean;
}

export interface Article {
  id: string;
  title: string;
  industry: string;
  tags: string[];
  date: ISODate;
  summary: string;
  whyItMatters: string;
  illustrative: boolean;
  /** Only set when a genuine original-article URL exists. */
  sourceUrl: string | null;
  sourceLabel: string;
}

export interface LabNodePosition {
  articleId: string;
  x: number;
  y: number;
}

export interface QuestionState {
  shownIds: string[];
  savedIds: string[];
  focus: 'all' | 'strategy' | 'role' | 'career';
}

export interface PersistedState {
  version: 1;
  profile: Profile;
  briefStatus: Record<string, BriefStatus>;
  questionState: Record<string, QuestionState>;
  chats: Record<string, ChatMessage[]>;
  priorityCompanies: Record<string, string[]>;
  contacts: Contact[];
  savedArticleIds: string[];
  labPositions: Record<string, LabNodePosition>;
  calendarConnected: boolean;
  /** Events added by the user; their briefs come from real AI. */
  userEvents: UserEvent[];
  /** Real AI briefs, by event id. */
  aiBriefs: Record<string, AiBriefRun>;
  /** Your corrections to the networking classifier, by event id. */
  classOverrides: Record<string, string>;
  /** Recurring Google series you chose to ignore. */
  ignoredSeries: string[];
  /** Events or series you removed with the Remove button (shown in Settings → Removed events). Key: event id or series id. */
  removed: Record<string, RemovedEntry>;
  /** "Confirm details" answers, by event id. */
  eventDetails: Record<string, EventDetails>;
  /** What the AI read from each calendar event, by event id. */
  aiExtractions: Record<string, EventExtraction>;
  /** AI classifications of unclear events, cached so each event is classified once. */
  aiClassCache: Record<string, ClassCacheEntry>;
  /** True once the account answered the welcome questions ("Almost set!"). Always true in demo mode. */
  onboarded: boolean;
}

/** What the AI read from a calendar event (saved with the account; re-read only if the event changes). */
export interface EventExtraction {
  people: Array<{ name: string; role: string; company: string; source: string }>;
  companies: Array<{ name: string; source: string }>;
  topic: string;
  fingerprint: string;
  at: string;
}

/** Details you confirmed or added for an event in "Confirm details" (saved with your account). */
export interface EventDetails {
  company: string;
  person: string;
  role: string;
  topic: string;
  /** "Paste anything useful", plus the text of an uploaded .txt / .csv file. */
  extra: string;
  confirmedAt: string;
}

export interface RemovedEntry {
  kind: 'event' | 'series';
  title: string;
  /** Human-readable date of the event you removed, e.g. "Wed, Nov 18, 4:00 PM". */
  when: string;
  /** Type to restore (when you had chosen one before removing); null means "let the rules decide again". */
  restoreType: string | null;
  removedAt: string;
}

export interface ClassCacheEntry {
  title: string;
  c: { type: string; confidence: number; reason: string; company: string; person: string; role: string; source: 'rules' | 'ai' | 'you' };
}

/** An event the user added by hand, or read from Google Calendar. Its brief is generated by real AI. */
export interface UserEvent {
  id: string;
  title: string;
  start: ISODateTime;
  end: ISODateTime;
  location: string;
  type: EventType;
  company: string;
  person: string;
  role: string;
  notes: string;
  source: 'manual' | 'google';
  /** Only for events read from Google Calendar (never saved; reloaded from Google). */
  google?: GoogleEventMeta;
}

export interface GoogleAttendee {
  /** Name Google shows next to the email (may be empty). The full email never leaves the server. */
  name: string;
  /** Email domain only, e.g. "stripe.com" (used to guess the company). */
  domain: string;
  self: boolean;
  organizer: boolean;
  responseStatus: string;
}

export interface GoogleEventMeta {
  /** Event description with emails, links and numbers removed (by the server). */
  description: string;
  allDay: boolean;
  eventType: string;
  recurringEventId: string | null;
  selfResponse: string | null;
  attendees: GoogleAttendee[];
  /** Who organized it (name and email domain only). */
  organizerName?: string;
  organizerDomain?: string;
  /** True for Zoom / Meet / Teams events. */
  online?: boolean;
}

/** Shape returned by the local server's /api/calendar/events. */
export interface GoogleCalendarEvent extends GoogleEventMeta {
  id: string;
  title: string;
  start: string;
  end: string;
  location: string;
  status: string;
}

export interface GoogleAccount {
  status: 'loading' | 'unavailable' | 'ready';
  configured: boolean;
  signedIn: boolean;
  email: string | null;
  name: string | null;
  calendarConnected: boolean;
}

/** What the browser sends to the local server for an AI brief (no emails, no links). */
export interface AiEventInput {
  title: string;
  datetime: string;
  company: string;
  person: string;
  role: string;
  notes: string;
  eventType?: string;
  /** Company names guessed from attendee email domains, comma-separated. */
  attendeeCompanies?: string;
  /** Cleaned calendar description (emails, links and numbers removed). */
  description?: string;
  /** What the event is about (from "Confirm details"). */
  topic?: string;
  /** "Online" or "In person". */
  format?: string;
  /** Organizer name and company (no emails). */
  organizer?: string;
  /** Attendees as "Name · Company" (company from the email domain; no emails). */
  attendees?: string;
  /** What the student's Contacts say about people at this event (incl. private notes). */
  contacts?: string;
  /** Text the student pasted (or a text file they uploaded) in "Confirm details". */
  extraContext?: string;
}

/** A real AI-generated brief (version 2: the same 8 sections as the sample briefs). */
export interface AiBrief {
  version: 2;
  essentials: { summary: string; goal: string; prepareFor: string[] };
  people: Array<{ name: string; role: string; company: string; foundIn: string; howToConnect: string }>;
  companies: Array<{ name: string; foundIn: string; overview: string; businessModel: string; products: Array<{ name: string; whyItMatters: string }> }>;
  financialsToCheck: string[];
  companyNewsToCheck: string[];
  industryThemes: Array<{ theme: string; whyItMatters: string }>;
  questionThemes: Array<{ theme: string; questions: string[] }>;
  verifyBeforeEvent: string[];
}

export interface AiBriefRun {
  id: string;
  event: AiEventInput;
  brief: AiBrief;
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
  model: string;
  generatedAt: ISODateTime;
  /** Questions added later with "Generate more questions". */
  extraQuestions?: Array<{ theme: string; question: string }>;
  /** Questions you saved (by text). */
  savedQuestions?: string[];
  /** "Ask about this brief" conversation. */
  chat?: Array<{ role: 'user' | 'assistant'; text: string; at: ISODateTime }>;
  /** "Latest public info": live web search (Google Search grounding), shown as returned. */
  research?: AiResearch;
}

export interface AiResearch {
  text: string;
  sources: Array<{ uri: string; title: string }>;
  queries: string[];
  /** Google's Search Suggestions (HTML, sanitized on the server). */
  suggestionsHtml: string;
  costUsd: number;
  searchedAt: ISODateTime;
}
