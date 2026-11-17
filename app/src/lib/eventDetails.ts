// What we know about an event before generating its brief: company, people, topic, and matches in your Contacts.
// Used for the "Missing…" indicator, the "Confirm details" step, and the text sent to the AI.
import type { Contact, EventDetails, EventExtraction, UserEvent } from '../types';
import { companiesFromAttendees, companyFromDomain, companyFromText, personFromTitle, type Classification } from './classifier';

export interface Known {
  company: string;
  person: string;
  role: string;
  topic: string;
}
export type MissingField = 'company' | 'person';

const SCHOOL_OR_PERSONAL = /(\.edu$|gmail\.com$|googlemail\.com$|yahoo\.com$|outlook\.com$|hotmail\.com$|icloud\.com$|me\.com$|aol\.com$|proton(mail)?\.(me|com)$|calendar\.google\.com$)/i;
const companyOf = (domain: string) => (domain && !SCHOOL_OR_PERSONAL.test(domain) ? companyFromDomain(domain) : '');

/** Other attendees as "Name · Company" (name from the invitation, company from the email domain). Max 15. */
export function attendeeLines(ev: UserEvent): string[] {
  return (ev.google?.attendees ?? [])
    .filter((a) => !a.self && (a.name || companyOf(a.domain)))
    .slice(0, 15)
    .map((a) => [a.name || 'Guest', companyOf(a.domain)].filter(Boolean).join(' · '));
}

export type Source = 'you' | 'title' | 'description' | 'attendees' | 'organizer' | 'contacts' | 'guess' | '';

export interface KnownWithSources extends Known {
  personSource: Source;
  companySource: Source;
}

const fromAi = (src: string): Source => (['title', 'description', 'attendees', 'organizer'].includes(src) ? (src as Source) : 'description');

/**
 * Who you will meet and their company. Order: what you confirmed or typed → what the AI read from the whole event
 * (title, description, attendees, organizer) → simple guesses only when the AI has not read the event.
 */
export function knownDetails(ev: UserEvent, cls?: Classification, d?: EventDetails, ex?: EventExtraction): KnownWithSources {
  const g = ev.google;
  const exPeople = ex?.people ?? [];
  const exPerson = exPeople.map((p) => p.name).slice(0, 4).join(', ');
  const exPersonCompany = exPeople.find((p) => p.company);
  const exCompany = ex?.companies[0]?.name || exPersonCompany?.company || '';
  const exRole = exPeople.find((p) => p.role)?.role ?? '';
  let person = '';
  let personSource: Source = '';
  if (d?.person) [person, personSource] = [d.person, 'you'];
  else if (ev.person) [person, personSource] = [ev.person, 'you'];
  else if (exPerson) [person, personSource] = [exPerson, fromAi(exPeople[0].source)];
  else if (!ex) {
    // Not read by the AI yet (or AI unavailable): simple guesses.
    const named = (g?.attendees ?? []).filter((a) => !a.self && a.name && companyOf(a.domain)).map((a) => a.name);
    const guess = cls?.person || personFromTitle(ev.title) || named.slice(0, 3).join(', ');
    if (guess) [person, personSource] = [guess, 'guess'];
  }
  let company = '';
  let companySource: Source = '';
  if (d?.company) [company, companySource] = [d.company, 'you'];
  else if (ev.company) [company, companySource] = [ev.company, 'you'];
  else if (exCompany) [company, companySource] = [exCompany, fromAi(ex?.companies[0]?.source ?? exPersonCompany?.source ?? '')];
  else if (!ex) {
    const guess = cls?.company || companyFromText(ev.title) || companiesFromAttendees(ev)[0] || '';
    if (guess) [company, companySource] = [guess, 'guess'];
  }
  return {
    person,
    personSource,
    company,
    companySource,
    role: d?.role || ev.role || exRole || cls?.role || '',
    topic: d?.topic || ex?.topic || (g?.description ?? '').slice(0, 200) || ev.notes || '',
  };
}

/** Ask before generating when the person (not you) or their company is still unknown. Everything else is optional. */
export function missingDetails(ev: UserEvent, cls?: Classification, d?: EventDetails, ex?: EventExtraction): MissingField[] {
  const k = knownDetails(ev, cls, d, ex);
  const out: MissingField[] = [];
  if (!k.person) out.push('person');
  if (!k.company) out.push('company');
  return out;
}

export const SOURCE_LABEL: Record<Source, string> = {
  you: 'you added it',
  title: 'from the title',
  description: 'from the description',
  attendees: 'from the attendees',
  organizer: 'from the organizer',
  contacts: 'from your contacts',
  guess: 'best guess',
  '': '',
};

export const MISSING_LABEL: Record<MissingField, string> = { company: 'company', person: 'person' };

/** Contacts that match people at this event (by full name, or first + last name). */
export function matchingContacts(contacts: Contact[], ev: UserEvent, k: Known): Contact[] {
  const names = [
    ...k.person.split(/,|;|\band\b|&/),
    ...(ev.google?.attendees ?? []).filter((a) => !a.self).map((a) => a.name),
  ]
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n.split(/\s+/).length >= 2);
  if (names.length === 0) return [];
  return contacts.filter((c) => {
    const cn = c.name.trim().toLowerCase();
    return cn.split(/\s+/).length >= 2 && names.some((n) => n === cn || n.includes(cn) || cn.includes(n));
  });
}

/** What the brief gets from your Contacts (includes your private notes, by your choice). */
export function contactsText(matches: Contact[]): string {
  return matches
    .map((c) => {
      const parts = [
        `${c.name}${c.role || c.company ? ` (${[c.role, c.company].filter(Boolean).join(', ')})` : ''}`,
        c.lastContact ? `last contact ${c.lastContact}` : 'no last contact recorded',
        c.referral && c.referral !== 'unknown' ? `open to referral: ${c.referral}` : '',
        c.notes ? `your notes: ${c.notes}` : '',
      ].filter(Boolean);
      return parts.join('; ');
    })
    .join('\n')
    .slice(0, 3000);
}
