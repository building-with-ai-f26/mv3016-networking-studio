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
  | 'Company presentation';

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
}
