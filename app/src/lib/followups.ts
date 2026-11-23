// Follow-up flow for contacts: stage of each contact, the tasks that are due (shown in Contacts and on the calendar),
// and people suggested from events that already happened.
import type { Contact, ContactStage, EventExtraction, UserEvent } from '../types';
import { nyDateKey } from './time';

export const FOLLOW_UP_DAYS = 7;
const DAY = 24 * 3600_000;

export const STAGE_LABEL: Record<ContactStage, string> = {
  new: 'New',
  linkedin: 'Added on LinkedIn',
  emailed: 'Emailed',
  followup: 'Follow-up due',
  replied: 'Replied',
  coffee: 'Coffee chat done',
};

/** Where a contact is in the flow: New → Added on LinkedIn / Emailed → Follow-up due → Replied → Coffee chat done. */
export function stageOf(c: Contact, now = Date.now()): ContactStage {
  if (c.coffeeAt) return 'coffee';
  const emails = c.emails ?? [];
  if (emails.some((e) => e.repliedAt)) return 'replied';
  const last = emails.at(-1);
  if (last) return now - Date.parse(last.sentAt) >= FOLLOW_UP_DAYS * DAY ? 'followup' : 'emailed';
  if (c.linkedinAt) return 'linkedin';
  return 'new';
}

export interface FollowUpTask {
  id: string;
  contactId: string;
  name: string;
  type: 'linkedin' | 'thanks' | 'followup';
  /** Day it is due (New York date, YYYY-MM-DD). */
  due: string;
  label: string;
}

const dayAfter = (iso: string, days: number) => nyDateKey(new Date(Date.parse(iso) + days * DAY).toISOString());

/** What to do next for each contact, with the day it is due. Contacts that replied or had a coffee chat have no task. */
export function followUpTasks(contacts: Contact[], now = Date.now()): FollowUpTask[] {
  const tasks: FollowUpTask[] = [];
  for (const c of contacts) {
    if (c.isSample) continue;
    const stage = stageOf(c, now);
    if (stage === 'replied' || stage === 'coffee') continue;
    const met = c.events?.at(-1)?.date ?? c.addedAt;
    if (!met) continue;
    if (!c.linkedinAt) tasks.push({ id: `${c.id}-li`, contactId: c.id, name: c.name, type: 'linkedin', due: dayAfter(met, 1), label: `Connect with ${c.name} on LinkedIn` });
    const last = c.emails?.at(-1);
    if (!last) tasks.push({ id: `${c.id}-thx`, contactId: c.id, name: c.name, type: 'thanks', due: dayAfter(met, 1), label: `Send a thank-you email to ${c.name}` });
    else if (!last.repliedAt) tasks.push({ id: `${c.id}-fu-${last.threadId}`, contactId: c.id, name: c.name, type: 'followup', due: dayAfter(last.sentAt, FOLLOW_UP_DAYS), label: `Follow up with ${c.name} (no reply yet)` });
  }
  return tasks.sort((a, b) => a.due.localeCompare(b.due) || a.name.localeCompare(b.name));
}

export interface ContactSuggestion {
  key: string;
  name: string;
  role: string;
  company: string;
  eventId: string;
  eventTitle: string;
  eventDate: string;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * People from events that already ended (last 30 days), not yet in Contacts and not dismissed.
 * Uses the AI reading of the event (name, role, company) or the person typed on the event.
 */
export function contactSuggestions(opts: {
  events: UserEvent[];
  extractions: Record<string, EventExtraction>;
  contacts: Contact[];
  dismissed: string[];
  studentNames: string[];
  isHidden: (eventId: string) => boolean;
  now?: number;
}): ContactSuggestion[] {
  const now = opts.now ?? Date.now();
  const known = new Set(opts.contacts.map((c) => norm(c.name)));
  const me = opts.studentNames.map(norm).filter(Boolean);
  const dismissed = new Set(opts.dismissed);
  const out: ContactSuggestion[] = [];
  const seen = new Set<string>();
  const events = opts.events.filter((ev) => Date.parse(ev.end) < now && now - Date.parse(ev.end) < 30 * DAY && !opts.isHidden(ev.id)).sort((a, b) => b.start.localeCompare(a.start));
  for (const ev of events) {
    const ex = opts.extractions[ev.id];
    const people =
      ex?.people?.length
        ? ex.people.map((p) => ({ name: p.name, role: p.role, company: p.company }))
        : ev.person
            .split(/\s*(?:,|;| and | y )\s*/)
            .filter((n) => n.trim().split(/\s+/).length >= 2)
            .map((name) => ({ name, role: ev.role, company: ev.company }));
    for (const p of people) {
      const n = norm(p.name);
      const key = `${ev.id}|${n}`;
      if (!n || known.has(n) || seen.has(n) || dismissed.has(key) || me.some((m) => m === n || (m && n.startsWith(m.split(' ')[0]) && n.endsWith(m.split(' ').at(-1) ?? '')))) continue;
      seen.add(n);
      out.push({ key, name: p.name.trim(), role: p.role ?? '', company: p.company || ev.company || '', eventId: ev.id, eventTitle: ev.title, eventDate: ev.start });
    }
  }
  return out;
}

/** LinkedIn people search for a name (+ company). The app never sends invitations itself. */
export function linkedinSearchUrl(name: string, company = ''): string {
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent([name, company].filter(Boolean).join(' '))}`;
}

// ---------- updating a contact (pure functions; the store saves the result) ----------

const nowIso = () => new Date().toISOString();
type History = NonNullable<Contact['history']>;
const withHistory = (c: Contact, type: History[number]['type'], text: string, at = nowIso()): Contact => ({ ...c, history: [...(c.history ?? []), { at, type, text }].slice(-200) });

/** A new contact from a person suggested by a past event. */
export function contactFromSuggestion(s: ContactSuggestion): Contact {
  const at = nowIso();
  return withHistory(
    { id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: s.name, role: s.role, company: s.company, lastContact: '', referral: 'not-asked', notes: '', isSample: false, addedAt: at, events: [{ eventId: s.eventId, title: s.eventTitle, date: s.eventDate }] },
    'met',
    `Met at ${s.eventTitle}`,
    s.eventDate,
  );
}

export function recordLinkedin(c: Contact): Contact {
  return withHistory({ ...c, linkedinAt: nowIso() }, 'linkedin', 'LinkedIn invitation sent');
}

export function recordEmail(c: Contact, e: { threadId: string; sentAt: string; kind: string; subject: string; to: string }): Contact {
  const next = { ...c, email: c.email || e.to.split(',')[0].trim(), lastContact: e.sentAt.slice(0, 10), emails: [...(c.emails ?? []), { threadId: e.threadId, sentAt: e.sentAt, kind: e.kind, subject: e.subject }].slice(-50) };
  return withHistory(next, 'email', `Email sent: “${e.subject}”`, e.sentAt);
}

export function recordReply(c: Contact, r: { threadId: string; repliedAt: string; snippet: string }): Contact {
  const emails = (c.emails ?? []).map((e) => (e.threadId === r.threadId && !e.repliedAt ? { ...e, repliedAt: r.repliedAt, replySnippet: r.snippet } : e));
  return withHistory({ ...c, emails, lastContact: r.repliedAt.slice(0, 10) }, 'reply', `Replied: ${r.snippet}`.slice(0, 300), r.repliedAt);
}

export function recordCoffee(c: Contact): Contact {
  return withHistory({ ...c, coffeeAt: nowIso(), lastContact: nowIso().slice(0, 10) }, 'coffee', 'Coffee chat done');
}

/** Sent emails still waiting for a reply (for the Gmail check). */
export function pendingThreads(contacts: Contact[]): Array<{ contactId: string; threadId: string; sentAt: string }> {
  return contacts.flatMap((c) => (c.emails ?? []).filter((e) => !e.repliedAt && e.threadId).map((e) => ({ contactId: c.id, threadId: e.threadId, sentAt: e.sentAt })));
}
