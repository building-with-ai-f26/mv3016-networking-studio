// Mock services: simulated brief generation, chat, question variants and email preview.
// Nothing here calls a network, an AI model or an email provider.
import { formatDateTime, formatLongDate, formatTimeRange, tzAbbrev } from '../lib/time';
import type { Brief, NetworkingEvent, Profile, Question, QuestionState } from '../types';

/** Simulated brief generation time. */
export const BRIEF_GENERATION_MS = 1800;
/** Simulated "typing" delay for the demo assistant. */
export const CHAT_TYPING_MS = 700;
export const QUESTION_BATCH_SIZE = 3;

// ---------- Production timing (displayed only; no real schedules run) ----------

export function productionSchedule(ev: NetworkingEvent): { briefAt: string; emailAt: string } {
  const start = new Date(ev.start).getTime();
  const iso = (ms: number) => new Date(ms).toISOString();
  return { briefAt: iso(start - 48 * 3600_000), emailAt: iso(start - 24 * 3600_000) };
}

// ---------- Questions ----------

const FOCUS_CATEGORIES: Record<QuestionState['focus'], Question['category'][]> = {
  all: ['strategy', 'role', 'industry', 'career'],
  strategy: ['strategy', 'industry'],
  role: ['role'],
  career: ['career'],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function allQuestions(brief: Brief): Question[] {
  return [...brief.questions, ...brief.questionVariants];
}

/**
 * Picks the next small batch of curated variants for the selected focus.
 * Variants tagged with the user's higher-priority roles come first.
 * Returns an empty list when variants for that focus are exhausted.
 */
export function nextQuestionBatch(brief: Brief, qs: QuestionState, roles: string[]): Question[] {
  const shown = new Set(qs.shownIds);
  const shownText = new Set(allQuestions(brief).filter((x) => shown.has(x.id)).map((x) => norm(x.text)));
  const cats = FOCUS_CATEGORIES[qs.focus];
  const roleRank = (x: Question) => {
    if (!x.roles?.length) return roles.length;
    const ranks = x.roles.map((r) => roles.indexOf(r)).filter((i) => i >= 0);
    return ranks.length ? Math.min(...ranks) : roles.length;
  };
  const pool = brief.questionVariants
    .filter((x) => !shown.has(x.id) && !shownText.has(norm(x.text)) && cats.includes(x.category))
    .map((x, i) => ({ x, i }))
    .sort((a, b) => roleRank(a.x) - roleRank(b.x) || a.i - b.i)
    .map(({ x }) => x);
  const out: Question[] = [];
  const seen = new Set<string>();
  for (const x of pool) {
    const k = norm(x.text);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
    if (out.length === QUESTION_BATCH_SIZE) break;
  }
  return out;
}

// ---------- Chat ----------

export type ChatIntent = 'recap' | 'strongerQuestion' | 'prioritize';

export const CHAT_SHORTCUTS: Array<{ intent: ChatIntent; label: string }> = [
  { intent: 'recap', label: 'Give me a 60-second recap' },
  { intent: 'strongerQuestion', label: 'Help me ask a stronger question' },
  { intent: 'prioritize', label: 'What should I prioritize?' },
];

/** Deterministic, event-specific demo replies. Never claims live AI. */
export function demoReply(brief: Brief, input: string, profile: Profile): string {
  const text = input.trim();
  const t = text.toLowerCase();
  const shortcut = CHAT_SHORTCUTS.find((s) => s.label.toLowerCase() === t);
  if (shortcut) return brief.chat[shortcut.intent];

  if (/^(add|note|remember)\b|^add:|^note:/.test(t)) {
    return 'Noted — your note is kept in this event’s chat history. In the live product it would be added to the brief itself. (Demo assistant: nothing was sent anywhere.)';
  }
  if (/recap|summar|overview of the event|tl;?dr/.test(t)) return brief.chat.recap;
  if (/question|ask (them|him|her)|what (should|can) i ask/.test(t)) return brief.chat.strongerQuestion;
  if (/priorit|focus on|most important|first\b/.test(t)) return brief.chat.prioritize;
  if (/who\b|people|speaker|attend|person|panelist|interviewer/.test(t)) return brief.chat.people;
  if (/company|companies|business|product|revenue|financ/.test(t)) {
    return brief.financials.kind !== 'not-applicable' && /financ|revenue|earnings|results/.test(t)
      ? `${brief.financials.reason}`
      : brief.chat.company;
  }
  if (/goal|role|career|fit me|for me/.test(t)) {
    const roles = profile.roles.slice(0, 2).join(' and ') || 'your target roles';
    return `Based on your saved demo preferences (${roles}), focus your questions on how this event connects to product work. Use the Strategy / Role / Career focus in section 7 to pull curated questions. (These are curated sample responses, not live AI personalization.)`;
  }
  return 'I can’t answer that freeform request in this demo — there is no live AI behind this assistant. Try one of the shortcuts, or ask about the people, the company, what to prioritize, or a stronger question. You can also start a message with “Note:” to keep a note here.';
}

// ---------- Email preview (never sent) ----------

export function emailPreview(ev: NetworkingEvent, brief: Brief, profile: Profile) {
  const { emailAt } = productionSchedule(ev);
  return {
    to: `${profile.name} (demo profile — no address stored)`,
    scheduledFor: `${formatDateTime(emailAt)} ${tzAbbrev(emailAt)} (24 hours before)`,
    subject: `Tomorrow: ${ev.title} — your prep brief`,
    body: [
      `Hi ${profile.name},`,
      `Your networking event is tomorrow: ${formatLongDate(ev.start)}, ${formatTimeRange(ev.start, ev.end)} ${tzAbbrev(ev.start)} at ${ev.location}.`,
      `Quick summary: ${brief.summary}`,
      `Top things to prepare:\n${brief.prepareFor
        .slice(0, 3)
        .map((p) => `• ${p}`)
        .join('\n')}`,
      'Open your full brief in Networking Studio to review the questions.',
    ].join('\n\n'),
  };
}
