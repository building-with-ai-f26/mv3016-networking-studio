// Networking classifier for Google Calendar events.
// Step 1: clear rules (free, instant, explainable). Step 2: only ambiguous events go to the AI (see server/classify.mjs).
import type { UserEvent } from '../types';

export type NetworkingType = 'coffee_chat' | 'networking_event' | 'company_presentation' | 'career_panel' | 'mock_interview' | 'interview' | 'not_networking';

export const TYPE_LABELS: Record<NetworkingType, string> = {
  coffee_chat: 'Coffee chat',
  networking_event: 'Networking event',
  company_presentation: 'Company presentation',
  career_panel: 'Career panel',
  mock_interview: 'Mock interview',
  interview: 'Interview',
  not_networking: 'Not networking',
};

/** Types you can pick for an event (everything except not_networking; removing an event is its own button). */
export const NETWORKING_TYPES = (Object.keys(TYPE_LABELS) as NetworkingType[]).filter((t) => t !== 'not_networking');

export interface Classification {
  type: NetworkingType;
  confidence: number; // 0..1
  reason: string;
  company: string;
  person: string;
  role: string;
  source: 'rules' | 'ai' | 'you';
}

/** Email domains that are a school or a personal mailbox, so they don't tell us the company. */
const NON_COMPANY_DOMAINS = [
  'nyu.edu', 'stern.nyu.edu', 'gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
  'group.calendar.google.com', 'resource.calendar.google.com', 'calendar.google.com',
];
const isSchoolOrPersonal = (domain: string) => domain.endsWith('.edu') || NON_COMPANY_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));

/** "meta.com" -> "Meta", "jpmorgan.com" -> "Jpmorgan", "mail.goldmansachs.com" -> "Goldmansachs". */
export function companyFromDomain(domain: string): string {
  const parts = domain.toLowerCase().split('.').filter(Boolean);
  if (parts.length < 2) return '';
  const name = parts.length >= 3 && ['co', 'com', 'org'].includes(parts[parts.length - 2]) ? parts[parts.length - 3] : parts[parts.length - 2];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Companies suggested by attendees' email domains (school and personal domains ignored). */
export function companiesFromAttendees(ev: UserEvent): string[] {
  const out = new Set<string>();
  for (const a of ev.google?.attendees ?? []) {
    if (a.self) continue;
    const domain = a.email.split('@')[1]?.toLowerCase() ?? '';
    if (domain && !isSchoolOrPersonal(domain)) out.add(companyFromDomain(domain));
  }
  return [...out].filter(Boolean);
}

const COURSE_CODE = /\b[A-Z]{2,5}-[A-Z]{2}\s?\d{3,4}\b/; // e.g. TECH-GB 2160
const CLASS_WORDS = /\b(class|lecture|recitation|section|exam|midterm|final exam|quiz|office hours|problem set|study group)\b/i;
const PERSONAL = /\b(gym|workout|lunch with mom|dinner with|birthday|doctor|dentist|haircut|flight|commute)\b/i;
// Student rules (from user feedback): fellowship programs and regular team/club syncs are not networking.
const FELLOWS = /\b(fellows?|fellowship|EFL)\b/i;
const REGULAR_SYNC = /\b(weekly|bi-?weekly|daily|stand-?up|sync|check-?in|team meeting|board meeting|planning)\b/i;
// Club coordination: STA / TechCon / corporate-relations items with no named guest in the title.
const CLUB_COORDINATION = /\b(STA|Stern Technology Association|TechCon|DevSummit|Corp Rel|corporate relations)\b/i;

const SIGNALS: Array<{ re: RegExp; type: NetworkingType; reason: string }> = [
  { re: /\bmock interview/i, type: 'mock_interview', reason: 'Title says “mock interview”' },
  { re: /\b(superday|interview)\b/i, type: 'interview', reason: 'Title says “interview”' },
  { re: /\bcoffee( chat)?\b/i, type: 'coffee_chat', reason: 'Title says “coffee chat”' },
  { re: /\S\s*<>\s*\S/, type: 'coffee_chat', reason: 'Title looks like “Name <> Name” (a 1:1 intro)' },
  { re: /\bpanel\b/i, type: 'career_panel', reason: 'Title says “panel”' },
  { re: /\b(info(rmation)? session|lunch (and|&) learn|fireside|company presentation|corporate presentation|tech talk|speaker series)\b/i, type: 'company_presentation', reason: 'Company talk or info session in the title' },
  { re: /\b(networking|mixer|happy hour|meet (and|&) greet|reception)\b/i, type: 'networking_event', reason: 'Networking event in the title' },
  { re: /\b(alumni|career|recruiting|recruitment|trek|employer)\b/i, type: 'networking_event', reason: 'Alumni / career / recruiting event' },
];

/** Person from titles like "Coffee chat with Jordan Lee" or "Ana <> Jordan". */
export function personFromTitle(title: string): string {
  const withName = title.match(/\bwith\s+([A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){0,2})/u);
  if (withName) return withName[1];
  const arrows = title.split(/\s*<>\s*/);
  return arrows.length === 2 ? arrows[1].trim() : '';
}

export interface RuleContext {
  targetCompanies: string[];
}

/**
 * Rules first. Returns a Classification when the rules are confident, or null when the event is ambiguous
 * (then the AI decides). Manual events are always treated as networking (the user added them on purpose).
 */
export function classifyByRules(ev: UserEvent, ctx: RuleContext): Classification | null {
  const g = ev.google;
  const companies = companiesFromAttendees(ev);
  const base = { company: companies[0] ?? '', person: personFromTitle(ev.title), role: '' };
  const no = (reason: string): Classification => ({ type: 'not_networking', confidence: 0.95, reason, ...base, source: 'rules' });
  if (!g) return null;

  // 1) Exclusions: things that are clearly not networking.
  if (g.eventType === 'outOfOffice') return no('Out of office');
  if (g.eventType === 'focusTime') return no('Focus time');
  if (g.eventType === 'workingLocation') return no('Working location');
  if (g.allDay) return no('All-day event');
  if (g.selfResponse === 'declined') return no('You declined this event');
  if (COURSE_CODE.test(ev.title)) return no('Course code in the title (a class)');
  if (CLASS_WORDS.test(ev.title)) return no('Class, lecture, section or exam');
  if (PERSONAL.test(ev.title)) return no('Personal event');
  if (FELLOWS.test(ev.title)) return no('Fellows program meeting');
  if (g.recurringEventId) return no('Recurring meeting (regular series, not networking)');
  if (REGULAR_SYNC.test(ev.title)) return no('Regular team or club meeting');
  if (CLUB_COORDINATION.test(ev.title) && !personFromTitle(ev.title)) return no('Club coordination (no guest named in the title)');

  // 2) Networking signals in the title, then in the description.
  const text = `${ev.title}\n${g.description}`;
  const target = ctx.targetCompanies.find((c) => c && new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
  for (const s of SIGNALS) {
    if (s.re.test(ev.title)) return { type: s.type, confidence: 0.9, reason: s.reason, ...base, company: base.company || target || '', source: 'rules' };
  }

  const others = g.attendees.filter((a) => !a.self);
  if (others.length === 0 && !target) {
    const inDescription = SIGNALS.find((s) => s.re.test(g.description));
    if (!inDescription) return no('No other attendees and no networking signals');
  }
  // Company attendee or target company, but no clear type: let the AI decide (with these hints).
  return null;
}

/** Fallback when the AI is unavailable for an ambiguous event. */
export function fallbackForAmbiguous(ev: UserEvent, ctx: RuleContext): Classification {
  const companies = companiesFromAttendees(ev);
  const target = ctx.targetCompanies.find((c) => c && ev.title.toLowerCase().includes(c.toLowerCase()));
  if (companies.length || target)
    return {
      type: 'networking_event',
      confidence: 0.5,
      reason: companies.length ? `Attendee from ${companies[0]} (not a school email)` : `Mentions your target company ${target}`,
      company: companies[0] ?? target ?? '',
      person: personFromTitle(ev.title),
      role: '',
      source: 'rules',
    };
  return { type: 'not_networking', confidence: 0.5, reason: 'No clear networking signals', company: '', person: '', role: '', source: 'rules' };
}

/** Hints we send to the AI for ambiguous events: no emails, only company names guessed from domains. */
export function aiClassifyInput(ev: UserEvent, ctx: RuleContext) {
  return {
    title: ev.title,
    description: ev.google?.description ?? '',
    attendeeCompanies: companiesFromAttendees(ev),
    attendeeCount: (ev.google?.attendees ?? []).filter((a) => !a.self).length,
    targetCompanies: ctx.targetCompanies,
  };
}
