// Versioned localStorage persistence with defensive parsing.
// If storage is unavailable or corrupt, the app keeps working in memory.
import {
  SEED_CONTACTS,
  SEED_EVENTS,
  SEED_PROFILE,
  SEED_SAVED_ARTICLE_IDS,
} from '../data/seed';
import type {
  BriefStatus,
  ChatMessage,
  Contact,
  LabNodePosition,
  PersistedState,
  Profile,
  QuestionState,
  ReferralStatus,
  UserEvent,
  AiBriefRun,
  ClassCacheEntry,
  EventExtraction,
  EventType,
} from '../types';

export const STORAGE_KEY = 'networking-studio:v1';

export type StorageHealth = 'ok' | 'unavailable' | 'recovered';

export function createSeedState(): PersistedState {
  const briefStatus: Record<string, BriefStatus> = {};
  for (const ev of SEED_EVENTS) briefStatus[ev.id] = ev.seedBriefStatus;
  return {
    version: 1,
    profile: structuredClone(SEED_PROFILE),
    briefStatus,
    questionState: {},
    chats: {},
    priorityCompanies: {},
    contacts: structuredClone(SEED_CONTACTS),
    savedArticleIds: [...SEED_SAVED_ARTICLE_IDS],
    labPositions: {},
    calendarConnected: false,
    userEvents: [],
    aiBriefs: {},
    classOverrides: {},
    ignoredSeries: [],
    removed: {},
    eventDetails: {},
    aiExtractions: {},
    aiClassCache: {},
    onboarded: true,
  };
}

/** Starting state for a new Google account: empty profile (filled in "Almost set!"), no sample contacts. */
export function createAccountState(name: string): PersistedState {
  return {
    ...createSeedState(),
    profile: { name, program: '', city: '', timezone: 'America/New_York', careerGoal: '', industries: [], roles: [], companies: [], showEmailPreview: true },
    contacts: [],
    savedArticleIds: [],
    onboarded: false,
  };
}

/** Developer fixture: open the app with ?fixture=storage-unavailable to see the in-memory state. */
function fixtureForcesUnavailable(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('fixture') === 'storage-unavailable';
  } catch {
    return false;
  }
}

function getStorage(): Storage | null {
  if (fixtureForcesUnavailable()) return null;
  try {
    const s = window.localStorage;
    const probe = '__ns_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const strArr = (v: unknown): string[] | null => (Array.isArray(v) && v.every(isStr) ? v : null);

function parseProfile(v: unknown, fallback: Profile): Profile {
  if (!isObj(v)) return fallback;
  return {
    name: isStr(v.name) ? v.name : fallback.name,
    program: isStr(v.program) ? v.program : fallback.program,
    city: isStr(v.city) ? v.city : fallback.city,
    timezone: isStr(v.timezone) ? v.timezone : fallback.timezone,
    careerGoal: isStr(v.careerGoal) ? v.careerGoal : fallback.careerGoal,
    industries: strArr(v.industries) ?? fallback.industries,
    roles: strArr(v.roles) ?? fallback.roles,
    companies: strArr(v.companies) ?? fallback.companies,
    showEmailPreview: typeof v.showEmailPreview === 'boolean' ? v.showEmailPreview : fallback.showEmailPreview,
    ...(v.briefLanguage === 'es' || v.briefLanguage === 'en' ? { briefLanguage: v.briefLanguage } : {}),
    ...(isStr(v.background) ? { background: v.background.slice(0, 600) } : {}),
  };
}

const STATUSES: BriefStatus[] = ['scheduled', 'generating', 'ready'];
const REFERRALS: ReferralStatus[] = ['not-asked', 'yes', 'no', 'unknown'];

function parseContacts(v: unknown): Contact[] | null {
  if (!Array.isArray(v)) return null;
  const out: Contact[] = [];
  for (const c of v) {
    if (!isObj(c) || !isStr(c.id) || !isStr(c.name)) continue;
    out.push({
      id: c.id,
      name: c.name,
      role: isStr(c.role) ? c.role : '',
      company: isStr(c.company) ? c.company : '',
      lastContact: isStr(c.lastContact) && /^(\d{4}-\d{2}-\d{2})?$/.test(c.lastContact) ? c.lastContact : '',
      referral: REFERRALS.includes(c.referral as ReferralStatus) ? (c.referral as ReferralStatus) : 'unknown',
      notes: isStr(c.notes) ? c.notes : '',
      isSample: c.isSample === true,
    });
  }
  return out;
}

function parseRecord<T>(v: unknown, item: (x: unknown) => T | null): Record<string, T> {
  const out: Record<string, T> = {};
  if (!isObj(v)) return out;
  for (const [k, x] of Object.entries(v)) {
    const parsed = item(x);
    if (parsed !== null) out[k] = parsed;
  }
  return out;
}

const parseQuestionState = (x: unknown): QuestionState | null => {
  if (!isObj(x)) return null;
  const shownIds = strArr(x.shownIds);
  const savedIds = strArr(x.savedIds);
  if (!shownIds || !savedIds) return null;
  const focus = ['all', 'strategy', 'role', 'career'].includes(x.focus as string) ? (x.focus as QuestionState['focus']) : 'all';
  return { shownIds, savedIds, focus };
};

const parseChat = (x: unknown): ChatMessage[] | null => {
  if (!Array.isArray(x)) return null;
  return x.filter(
    (m): m is ChatMessage =>
      isObj(m) && isStr(m.id) && isStr(m.eventId) && (m.role === 'user' || m.role === 'assistant') && isStr(m.text) && isStr(m.createdAt),
  );
};

const parsePosition = (x: unknown): LabNodePosition | null =>
  isObj(x) && isStr(x.articleId) && Number.isFinite(x.x) && Number.isFinite(x.y)
    ? { articleId: x.articleId, x: x.x as number, y: x.y as number }
    : null;

const EVENT_TYPES: EventType[] = ['Mock interview', 'Networking night', 'Career panel', 'Company presentation', 'Coffee chat', 'Interview', 'Other'];

function parseUserEvents(v: unknown): UserEvent[] {
  if (!Array.isArray(v)) return [];
  const out: UserEvent[] = [];
  for (const e of v) {
    if (!isObj(e) || !isStr(e.id) || !isStr(e.title) || !isStr(e.start) || !isStr(e.end) || Number.isNaN(Date.parse(e.start))) continue;
    const s = (k: string) => (isStr(e[k]) ? (e[k] as string) : '');
    out.push({
      id: e.id,
      title: e.title,
      start: e.start,
      end: Number.isNaN(Date.parse(e.end)) ? e.start : e.end,
      location: s('location'),
      type: EVENT_TYPES.includes(e.type as EventType) ? (e.type as EventType) : 'Other',
      company: s('company'),
      person: s('person'),
      role: s('role'),
      notes: s('notes'),
      source: 'manual',
    });
  }
  return out;
}

/** AI briefs come from our own server; keep only the ones with the expected shape. */
const parseAiBriefRun = (x: unknown): AiBriefRun | null =>
  isObj(x) && isStr(x.id) && isObj(x.brief) && isObj(x.event) && isObj(x.usage) && isStr(x.model) && isStr(x.generatedAt) && [2, 3].includes((x.brief as Record<string, unknown>).version as number) && Array.isArray((x.brief as Record<string, unknown>).questionThemes)
    ? (x as unknown as AiBriefRun)
    : null;

/** Parse untrusted JSON into a valid state, falling back to seed values field by field. */
export function parseState(raw: unknown): PersistedState | null {
  if (!isObj(raw) || raw.version !== 1) return null;
  const seed = createSeedState();
  const briefStatus = { ...seed.briefStatus };
  if (isObj(raw.briefStatus)) {
    for (const [k, s] of Object.entries(raw.briefStatus)) {
      if (k in briefStatus && STATUSES.includes(s as BriefStatus)) briefStatus[k] = s as BriefStatus;
    }
  }
  return {
    version: 1,
    profile: parseProfile(raw.profile, seed.profile),
    briefStatus,
    questionState: parseRecord(raw.questionState, parseQuestionState),
    chats: parseRecord(raw.chats, parseChat),
    priorityCompanies: parseRecord(raw.priorityCompanies, strArr),
    contacts: parseContacts(raw.contacts) ?? seed.contacts,
    savedArticleIds: Array.from(new Set(strArr(raw.savedArticleIds) ?? seed.savedArticleIds)),
    labPositions: parseRecord(raw.labPositions, parsePosition),
    calendarConnected: raw.calendarConnected === true,
    userEvents: parseUserEvents(raw.userEvents),
    aiBriefs: parseRecord(raw.aiBriefs, parseAiBriefRun),
    classOverrides: parseRecord(raw.classOverrides, (x) => (isStr(x) ? x : null)),
    ignoredSeries: strArr(raw.ignoredSeries) ?? [],
    removed: parseRecord(raw.removed, (x) =>
      isObj(x) && (x.kind === 'event' || x.kind === 'series') && isStr(x.title)
        ? { kind: x.kind, title: x.title, when: isStr(x.when) ? x.when : '', restoreType: isStr(x.restoreType) ? x.restoreType : null, removedAt: isStr(x.removedAt) ? x.removedAt : '' }
        : null,
    ),
    eventDetails: parseRecord(raw.eventDetails, (x) =>
      isObj(x)
        ? { company: isStr(x.company) ? x.company : '', person: isStr(x.person) ? x.person : '', role: isStr(x.role) ? x.role : '', topic: isStr(x.topic) ? x.topic : '', extra: isStr(x.extra) ? x.extra : '', confirmedAt: isStr(x.confirmedAt) ? x.confirmedAt : '' }
        : null,
    ),
    aiExtractions: parseRecord(raw.aiExtractions, (x) =>
      isObj(x) && Array.isArray(x.people) && Array.isArray(x.companies) && isStr(x.fingerprint) ? (x as unknown as EventExtraction) : null,
    ),
    aiClassCache: parseRecord(raw.aiClassCache, (x) => (isObj(x) && isStr(x.title) && isObj(x.c) && isStr((x.c as Record<string, unknown>).type) ? (x as unknown as ClassCacheEntry) : null)),
    onboarded: raw.onboarded === true,
  };
}

export function loadState(): { state: PersistedState; health: StorageHealth } {
  const storage = getStorage();
  if (!storage) return { state: createSeedState(), health: 'unavailable' };
  const text = storage.getItem(STORAGE_KEY);
  if (text === null) return { state: createSeedState(), health: 'ok' };
  try {
    const parsed = parseState(JSON.parse(text));
    if (parsed) return { state: parsed, health: 'ok' };
  } catch {
    /* fall through */
  }
  return { state: createSeedState(), health: 'recovered' };
}

/** Returns false if the write failed (e.g. quota or blocked storage). */
export function saveState(state: PersistedState): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearState(): void {
  const storage = getStorage();
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
