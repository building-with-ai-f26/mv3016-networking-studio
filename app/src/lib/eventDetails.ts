// What we know about an event before generating its brief: company, people, topic, and matches in your Contacts.
// Used for the "Missing…" indicator, the "Confirm details" step, and the text sent to the AI.
import type { Contact, EventDetails, UserEvent } from '../types';
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

/** Best guess of company / person / role / topic from the event, the classifier and what you typed. */
export function knownDetails(ev: UserEvent, cls?: Classification, d?: EventDetails): Known {
  const g = ev.google;
  // Only people from outside the school (classmates and club hosts are not who you are preparing to meet).
  const namedAttendees = (g?.attendees ?? []).filter((a) => !a.self && a.name && companyOf(a.domain)).map((a) => a.name);
  return {
    company: d?.company || ev.company || cls?.company || companyFromText(ev.title) || companiesFromAttendees(ev)[0] || companyFromText(g?.description ?? '') || companyOf(g?.organizerDomain ?? '') || '',
    person: d?.person || ev.person || cls?.person || personFromTitle(ev.title) || namedAttendees.slice(0, 3).join(', ') || '',
    role: d?.role || ev.role || cls?.role || '',
    topic: d?.topic || (g?.description ?? '').slice(0, 200) || ev.notes || d?.extra?.slice(0, 200) || '',
  };
}

/** Fields worth asking for before generating (empty list = enough to generate). */
/**
 * What to ask before generating. Only the person's name and their company matter; everything else is optional.
 * If the event has a real description (or you added notes), the AI reads it, so nothing is asked.
 */
export function missingDetails(ev: UserEvent, cls?: Classification, d?: EventDetails): MissingField[] {
  const text = `${ev.google?.description ?? ''} ${ev.notes ?? ''} ${d?.extra ?? ''}`.trim();
  if (text.length >= 80) return [];
  const k = knownDetails(ev, cls, d);
  const out: MissingField[] = [];
  if (!k.person) out.push('person');
  if (!k.company) out.push('company');
  return out;
}

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
