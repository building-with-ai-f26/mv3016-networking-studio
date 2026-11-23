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
  type: 'linkedin' | 'thanks' | 'reply' | 'followup';
  /** Day it is due (New York date, YYYY-MM-DD). */
  due: string;
  label: string;
}

const dayAfter = (iso: string, days: number) => nyDateKey(new Date(Date.parse(iso) + days * DAY).toISOString());

/** Deadlines: LinkedIn within 3 days of meeting; thank-you by the next day (also after a coffee chat); reply within 1 day; follow up after 7 days without a reply. */
export const DEADLINES = { linkedin: 3, thanks: 1, reply: 1, followup: FOLLOW_UP_DAYS };

/** What to do next for each contact, with the day it is due. */
export function followUpTasks(contacts: Contact[], now = Date.now()): FollowUpTask[] {
  void now;
  const tasks: FollowUpTask[] = [];
  for (const c of contacts) {
    if (c.isSample) continue;
    const met = c.events?.at(-1)?.date ?? c.addedAt;
    if (!met) continue;
    const emails = [...(c.emails ?? [])].sort((x, y) => x.sentAt.localeCompare(y.sentAt));
    const sentAfter = (iso: string) => emails.some((e) => e.sentAt > iso);
    if (!c.linkedinAt) tasks.push({ id: `${c.id}-li`, contactId: c.id, name: c.name, type: 'linkedin', due: dayAfter(met, DEADLINES.linkedin), label: `Connect with ${c.name} on LinkedIn` });
    if (c.coffeeAt) {
      if (!sentAfter(c.coffeeAt)) tasks.push({ id: `${c.id}-thx-coffee`, contactId: c.id, name: c.name, type: 'thanks', due: dayAfter(c.coffeeAt, DEADLINES.thanks), label: `Thank ${c.name} for the coffee chat` });
    } else if (!emails.length) {
      tasks.push({ id: `${c.id}-thx`, contactId: c.id, name: c.name, type: 'thanks', due: dayAfter(met, DEADLINES.thanks), label: `Send a thank-you email to ${c.name}` });
    }
    const lastReply = emails.map((e) => e.repliedAt ?? '').filter(Boolean).sort().at(-1);
    if (lastReply && !sentAfter(lastReply) && !(c.coffeeAt && c.coffeeAt > lastReply)) {
      tasks.push({ id: `${c.id}-reply-${lastReply}`, contactId: c.id, name: c.name, type: 'reply', due: dayAfter(lastReply, DEADLINES.reply), label: `Reply to ${c.name}` });
    } else {
      const last = emails.at(-1);
      if (last && !last.repliedAt && !c.coffeeAt) tasks.push({ id: `${c.id}-fu-${last.threadId}`, contactId: c.id, name: c.name, type: 'followup', due: dayAfter(last.sentAt, DEADLINES.followup), label: `Follow up with ${c.name} (no reply yet)` });
    }
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

/** One message exchanged with a contact (from Gmail, metadata only). */
export interface GmailActivity {
  id: string;
  threadId: string;
  date: string;
  direction: 'sent' | 'received';
  subject: string;
}

/**
 * Adds Gmail messages exchanged with a contact (sent from the app or from Gmail) to their emails and history.
 * Messages already seen are skipped. A received message after a sent one marks that email as replied.
 * Returns the same object when nothing changed.
 */
export function mergeActivity(c: Contact, items: GmailActivity[]): Contact {
  const seen = new Set(c.gmailSeen ?? []);
  const fresh = items.filter((m) => m.id && !seen.has(m.id)).sort((a, b) => a.date.localeCompare(b.date));
  if (!fresh.length) return c;
  let next: Contact = { ...c, emails: [...(c.emails ?? [])], gmailSeen: [...seen, ...fresh.map((m) => m.id)].slice(-300) };
  for (const m of fresh) {
    if (m.direction === 'sent') {
      const known = next.emails!.find((e) => e.threadId === m.threadId && Math.abs(Date.parse(e.sentAt) - Date.parse(m.date)) < 10 * 60_000);
      if (!known) {
        next.emails!.push({ threadId: m.threadId, sentAt: m.date, kind: 'gmail', subject: m.subject });
        next = withHistory(next, 'email', `Email sent: “${m.subject || '(no subject)'}”`, m.date);
      }
    } else {
      // The latest email you sent before this message and still waiting for an answer counts as replied.
      const pending = [...next.emails!].reverse().find((e) => !e.repliedAt && e.sentAt < m.date);
      if (pending) next.emails = next.emails!.map((e) => (e === pending ? { ...e, repliedAt: m.date } : e));
      next = withHistory(next, 'reply', `Email from ${c.name}: “${m.subject || '(no subject)'}”`, m.date);
    }
    if (m.date.slice(0, 10) > (next.lastContact || '')) next = { ...next, lastContact: m.date.slice(0, 10) };
  }
  next.emails = next.emails!.sort((a, b) => a.sentAt.localeCompare(b.sentAt)).slice(-50);
  next.history = [...(next.history ?? [])].sort((a, b) => a.at.localeCompare(b.at)).slice(-200);
  return next;
}
