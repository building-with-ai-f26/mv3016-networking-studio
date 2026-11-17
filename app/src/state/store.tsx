// App-wide state: one shared store, persisted to localStorage on every change.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SEED_ARTICLES } from '../data/seed';
import { layoutCluster, findFreeSlot } from '../lib/labLayout';
import { clearState, createAccountState, createSeedState, loadState, parseState, saveState, type StorageHealth } from '../services/storage';
import { BRIEF_GENERATION_MS } from '../services/mockServices';
import { track } from '../lib/analytics';
import { formatDateTime, formatLongDate, formatTimeRange, tzAbbrev } from '../lib/time';
import { requestAiBrief, type BriefAttachment } from '../services/aiBrief';
import { attendeeLines, contactsText, knownDetails, matchingContacts } from '../lib/eventDetails';
import { companiesFromAttendees, companyFromDomain, TYPE_LABELS, type Classification, type NetworkingType } from '../lib/classifier';
import { trackOverride, useClassifications, type ClassifiedEvent } from './classification';
import { extractionFingerprint, useExtractions } from './extraction';
import { DEMO_GOOGLE_EVENTS } from '../data/demoCalendar';
import { fetchAccount, fetchAccountState, fetchCalendarEvents, postAuth, saveAccountState, SIGNED_OUT, toUserEvent } from '../services/google';
import type { AiBriefRun, AiEventInput, ChatMessage, ClassCacheEntry, Contact, EventDetails, EventExtraction, GoogleAccount, LabNodePosition, PersistedState, Profile, QuestionState, UserEvent } from '../types';

export type PersistStatus = StorageHealth | 'write-failed';

interface StoreValue {
  state: PersistedState;
  persistStatus: PersistStatus;
  generateBrief: (eventId: string) => void;
  getQuestionState: (eventId: string, defaultIds: string[]) => QuestionState;
  updateQuestionState: (eventId: string, defaultIds: string[], fn: (q: QuestionState) => QuestionState) => void;
  addChatMessage: (msg: ChatMessage) => void;
  setPriorityCompanies: (eventId: string, list: string[]) => void;
  upsertContact: (c: Contact) => void;
  deleteContact: (id: string) => void;
  toggleSaveArticle: (id: string) => void;
  setLabPosition: (articleId: string, x: number, y: number) => void;
  resetLabPositions: (articleIds: string[]) => void;
  updateProfile: (p: Profile) => void;
  setCalendarConnected: (v: boolean) => void;
  resetDemo: () => void;
  addUserEvent: (ev: UserEvent) => void;
  deleteUserEvent: (id: string) => void;
  /** Calls the local server for a REAL AI brief. */
  generateAiBrief: (eventId: string, attachment?: BriefAttachment, detailsNow?: EventDetails) => Promise<void>;
  /** In-memory status of AI generation, by event id. */
  aiPending: Record<string, boolean>;
  aiErrors: Record<string, string>;
  /** Real Google account (via the local server). */
  google: GoogleAccount;
  /** Events from Google Calendar, next 14 days. Kept in memory only. */
  googleEvents: UserEvent[];
  googleError: string | null;
  googleLoading: boolean;
  reloadGoogleCalendar: () => Promise<void>;
  signOutGoogle: () => Promise<void>;
  disconnectGoogle: () => Promise<void>;
  /** Finds a manual or Google event by id. */
  findUserEvent: (id: string) => UserEvent | undefined;
  /** True when the user chose "Explore the demo" on the login screen (no Google account). */
  demoMode: boolean;
  enterDemo: () => void;
  exitDemo: () => void;
  /** Signed in: true once this account's data has been loaded from the server. */
  accountReady: boolean;
  completeOnboarding: (p: Profile) => void;
  /** Networking classification of Google events, by event id. */
  classified: Record<string, ClassifiedEvent>;
  setClassOverride: (eventId: string, type: NetworkingType) => void;
  ignoreSeries: (eventId: string, seriesId: string) => void;
  unignoreSeries: (seriesId: string) => void;
  removeEvent: (ev: UserEvent, scope: 'event' | 'series') => () => void;
  updateAiRun: (eventId: string, fn: (run: AiBriefRun) => AiBriefRun) => void;
  setEventDetails: (eventId: string, d: EventDetails) => void;
  /** AI reading of a calendar event (reads it now if needed). */
  readEvent: (eventId: string) => Promise<EventExtraction | null>;
  /** What the AI receives for this event (used by follow-ups). */
  aiInputOf: (eventId: string) => AiEventInput | null;
  restoreRemoved: (key: string) => void;
  addFromCalendar: (eventId: string, type: NetworkingType) => void;
}

const EMPTY_EVENTS: UserEvent[] = [];
const DEMO_KEY = 'networking-studio:demo-mode';
function readDemoFlag(): boolean {
  try {
    return localStorage.getItem(DEMO_KEY) === '1';
  } catch {
    return false;
  }
}
function writeDemoFlag(on: boolean) {
  try {
    if (on) localStorage.setItem(DEMO_KEY, '1');
    else localStorage.removeItem(DEMO_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * What we send to the AI. Manual events: the fields you typed. Google events: title, time, location, the cleaned
 * description, and the classifier's type/company/person. Never attendee emails.
 */
export function aiInputFor(ev: UserEvent, cls?: Classification, opts: { details?: EventDetails; contacts?: Contact[]; extraction?: EventExtraction } = {}): AiEventInput {
  const d = opts.details;
  const known = knownDetails(ev, cls, d, opts.extraction);
  const exPeople = (opts.extraction?.people ?? []).map((p) => [p.name, [p.role, p.company].filter(Boolean).join(', ')].filter(Boolean).join(' · '));
  const g = ev.google;
  const organizer = g?.organizerName || g?.organizerDomain ? [g?.organizerName, g?.organizerDomain && !/\.edu$/i.test(g.organizerDomain) ? companyFromDomain(g.organizerDomain) : ''].filter(Boolean).join(' · ') : '';
  // Never send links (e.g. Zoom URLs with passwords) or emails to the AI.
  const place = ev.location.replace(/https?:\/\/\S+|www\.\S+/gi, 'online link').replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '').trim();
  const when = `${formatLongDate(ev.start)}, ${formatTimeRange(ev.start, ev.end)} ${tzAbbrev(ev.start)}${place ? ` · ${place}` : ''}`;
  return {
    title: ev.title,
    datetime: when.slice(0, 200),
    eventType: cls && cls.type !== 'not_networking' ? TYPE_LABELS[cls.type] : ev.type !== 'Other' ? ev.type : '',
    company: known.company.slice(0, 120),
    person: known.person.slice(0, 200),
    role: known.role.slice(0, 120),
    topic: (d?.topic ?? '').slice(0, 300),
    format: g ? (g.online ? 'Online' : ev.location ? 'In person' : '') : '',
    organizer: organizer.slice(0, 200),
    attendees: [...exPeople, ...attendeeLines(ev)].filter((x, i, a) => a.indexOf(x) === i).join('; ').slice(0, 1500),
    attendeeCompanies: ev.google ? companiesFromAttendees(ev).join(', ').slice(0, 300) : '',
    contacts: contactsText(matchingContacts(opts.contacts ?? [], ev, known)),
    extraContext: (d?.extra ?? '').slice(0, 6000),
    description: ev.google?.description ?? '',
    notes: ev.notes,
  };
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(() => loadState(), []);
  const [state, setState] = useState<PersistedState>(initial.state);
  const [persistStatus, setPersistStatus] = useState<PersistStatus>(initial.health);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const stateRef = useRef(state);
  stateRef.current = state;
  const [aiPending, setAiPending] = useState<Record<string, boolean>>({});
  const [aiErrors, setAiErrors] = useState<Record<string, string>>({});
  const [google, setGoogle] = useState<GoogleAccount>({ ...SIGNED_OUT, status: 'loading' });
  const [realGoogleEvents, setGoogleEvents] = useState<UserEvent[]>([]);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [demoMode, setDemoMode] = useState(readDemoFlag);
  const enterDemo = useCallback(() => {
    writeDemoFlag(true);
    setDemoMode(true);
  }, []);
  const exitDemo = useCallback(() => {
    writeDemoFlag(false);
    setDemoMode(false);
  }, []);
  // Calendar events: the real Google Calendar when connected; a fictional calendar in demo mode.
  const demoEvents = useMemo(() => DEMO_GOOGLE_EVENTS.map(toUserEvent), []);
  const googleEvents = google.calendarConnected ? realGoogleEvents : demoMode && !google.signedIn ? demoEvents : EMPTY_EVENTS;
  const googleEventsRef = useRef(googleEvents);
  googleEventsRef.current = googleEvents;

  const reloadGoogleCalendar = useCallback(async () => {
    setGoogleLoading(true);
    setGoogleError(null);
    try {
      setGoogleEvents((await fetchCalendarEvents()).map(toUserEvent));
    } catch (e) {
      setGoogleError(e instanceof Error ? e.message : 'Could not load your Google Calendar.');
    } finally {
      setGoogleLoading(false);
    }
  }, []);

  // Account data lives on the local server (one file per Google account). Demo mode keeps using this browser.
  const [accountReady, setAccountReady] = useState(false);
  const loadAccountState = useCallback(async (name: string) => {
    const remote = await fetchAccountState();
    setState(remote ? (parseState(remote) ?? createAccountState(name)) : createAccountState(name));
    setAccountReady(true);
  }, []);

  // On start: ask the local server who is signed in, load that account's data, then the calendar if connected.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const acc = await fetchAccount();
      if (!alive) return;
      if (acc.signedIn) await loadAccountState(acc.name ?? '');
      if (!alive) return;
      setGoogle(acc);
      const flag = new URLSearchParams(window.location.search).get('google');
      if ((flag === 'signed-in' || flag === 'calendar-connected') && acc.signedIn) track('signed_in', { provider: 'google' });
      if (flag === 'calendar-connected' && acc.calendarConnected) track('calendar_connected', { source: 'google' });
      if (acc.calendarConnected) await reloadGoogleCalendar();
    })();
    return () => {
      alive = false;
    };
  }, [reloadGoogleCalendar, loadAccountState]);

  // After leaving an account, go back to this browser's demo data (the account's data stays on the server).
  const leaveAccount = useCallback(() => {
    writeDemoFlag(false);
    setDemoMode(false);
    setAccountReady(false);
    setGoogle((g) => ({ ...g, signedIn: false, email: null, name: null, calendarConnected: false }));
    setGoogleEvents([]);
    setState(loadState().state);
  }, []);

  const signOutGoogle = useCallback(async () => {
    await postAuth('/auth/signout');
    leaveAccount();
  }, [leaveAccount]);

  const disconnectGoogle = useCallback(async () => {
    await postAuth('/auth/disconnect');
    leaveAccount();
  }, [leaveAccount]);

  /** "Almost set!": save the welcome answers and finish onboarding. */
  const completeOnboarding = useCallback((p: Profile) => setState((s) => ({ ...s, profile: p, onboarded: true })), []);

  const saveClassification = useCallback(
    (eventId: string, entry: ClassCacheEntry) => setState((s) => ({ ...s, aiClassCache: { ...s.aiClassCache, [eventId]: entry } })),
    [],
  );
  const classified = useClassifications({
    events: googleEvents,
    targetCompanies: state.profile.companies,
    overrides: state.classOverrides as Record<string, NetworkingType>,
    ignoredSeries: state.ignoredSeries,
    cache: state.aiClassCache,
    onCache: saveClassification,
  });
  const classifiedRef = useRef(classified);
  classifiedRef.current = classified;

  // AI reading of each visible networking event (people, companies, topic), saved with the account.
  const saveExtraction = useCallback((eventId: string, ex: EventExtraction) => setState((s) => ({ ...s, aiExtractions: { ...s.aiExtractions, [eventId]: ex } })), []);
  const visibleGoogle = useMemo(() => googleEvents.filter((ev) => !classified[ev.id]?.hidden), [googleEvents, classified]);
  const studentNames = useMemo(() => [state.profile.name, google.name ?? ''].filter(Boolean), [state.profile.name, google.name]);
  const { readNow } = useExtractions({ events: visibleGoogle, saved: state.aiExtractions, studentNames, onSave: saveExtraction });
  /** Reads an event now (if needed) and returns what the AI found. Used by Generate. */
  const readEvent = useCallback(
    async (eventId: string): Promise<EventExtraction | null> => {
      const ev = googleEventsRef.current.find((e) => e.id === eventId);
      if (!ev) return null;
      const saved = stateRef.current.aiExtractions[eventId];
      if (saved && saved.fingerprint === extractionFingerprint(ev)) return saved;
      return readNow(ev);
    },
    [readNow],
  );

  const setClassOverride = useCallback((eventId: string, type: NetworkingType) => {
    const from = classifiedRef.current[eventId]?.classification.type ?? 'not_networking';
    trackOverride(eventId, from, type);
    setState((s) => ({ ...s, classOverrides: { ...s.classOverrides, [eventId]: type } }));
  }, []);

  const ignoreSeries = useCallback((eventId: string, seriesId: string) => {
    trackOverride(eventId, classifiedRef.current[eventId]?.classification.type ?? 'not_networking', 'ignore_series');
    setState((s) => (s.ignoredSeries.includes(seriesId) ? s : { ...s, ignoredSeries: [...s.ignoredSeries, seriesId] }));
  }, []);

  const unignoreSeries = useCallback((seriesId: string) => setState((s) => ({ ...s, ignoredSeries: s.ignoredSeries.filter((x) => x !== seriesId) })), []);

  /** Remove button: hides one event, or every event of its recurring series. Returns an undo function. */
  const removeEvent = useCallback((ev: UserEvent, scope: 'event' | 'series'): (() => void) => {
    const before = stateRef.current;
    const seriesId = ev.google?.recurringEventId ?? null;
    const when = formatDateTime(ev.start);
    track('event_removed', { event_id: ev.id, scope, source: ev.source });
    if (ev.source === 'manual') {
      setState((s) => {
        const aiBriefs = { ...s.aiBriefs };
        delete aiBriefs[ev.id];
        return { ...s, userEvents: s.userEvents.filter((e) => e.id !== ev.id), aiBriefs };
      });
    } else if (scope === 'series' && seriesId) {
      const inSeries = googleEventsRef.current.filter((e) => e.google?.recurringEventId === seriesId).map((e) => e.id);
      setState((s) => {
        const classOverrides = { ...s.classOverrides };
        for (const id of inSeries) delete classOverrides[id];
        return {
          ...s,
          classOverrides,
          ignoredSeries: s.ignoredSeries.includes(seriesId) ? s.ignoredSeries : [...s.ignoredSeries, seriesId],
          removed: { ...s.removed, [seriesId]: { kind: 'series', title: ev.title, when: `Repeats · e.g. ${when}`, restoreType: null, removedAt: new Date().toISOString() } },
        };
      });
    } else {
      const prev = before.classOverrides[ev.id] ?? null;
      setState((s) => ({
        ...s,
        classOverrides: { ...s.classOverrides, [ev.id]: 'not_networking' },
        removed: { ...s.removed, [ev.id]: { kind: 'event', title: ev.title, when, restoreType: prev, removedAt: new Date().toISOString() } },
      }));
    }
    // Undo puts back exactly the fields this action changed.
    return () =>
      setState((s) => ({ ...s, userEvents: before.userEvents, aiBriefs: { ...s.aiBriefs, ...before.aiBriefs }, classOverrides: before.classOverrides, ignoredSeries: before.ignoredSeries, removed: before.removed }));
  }, []);

  /** Changes one AI brief run (saved questions, extra questions, chat). */
  const updateAiRun = useCallback((eventId: string, fn: (run: AiBriefRun) => AiBriefRun) => {
    setState((s) => (s.aiBriefs[eventId] ? { ...s, aiBriefs: { ...s.aiBriefs, [eventId]: fn(s.aiBriefs[eventId]) } } : s));
  }, []);

  const aiInputOf = useCallback(
    (eventId: string) => {
      const ev = stateRef.current.userEvents.find((e) => e.id === eventId) ?? googleEventsRef.current.find((e) => e.id === eventId);
      return ev ? aiInputFor(ev, classifiedRef.current[eventId]?.classification, { details: stateRef.current.eventDetails[eventId], contacts: stateRef.current.contacts, extraction: stateRef.current.aiExtractions[eventId] }) : null;
    },
    [],
  );

  /** "Confirm details": save what you added for an event. */
  const setEventDetails = useCallback((eventId: string, d: EventDetails) => setState((s) => ({ ...s, eventDetails: { ...s.eventDetails, [eventId]: d } })), []);

  /** Settings → Removed events → Restore. */
  const restoreRemoved = useCallback((key: string) => {
    setState((s) => {
      const entry = s.removed[key];
      if (!entry) return s;
      const removed = { ...s.removed };
      delete removed[key];
      if (entry.kind === 'series') return { ...s, removed, ignoredSeries: s.ignoredSeries.filter((x) => x !== key) };
      const classOverrides = { ...s.classOverrides };
      if (entry.restoreType && entry.restoreType !== 'not_networking') classOverrides[key] = entry.restoreType;
      else delete classOverrides[key];
      return { ...s, removed, classOverrides };
    });
  }, []);

  /** Add event → From my calendar: shows a hidden Google event as networking, with the type you chose. */
  const addFromCalendar = useCallback((eventId: string, type: NetworkingType) => {
    track('event_added_from_calendar', { event_id: eventId, type });
    setState((s) => {
      const removed = { ...s.removed };
      delete removed[eventId];
      return { ...s, removed, classOverrides: { ...s.classOverrides, [eventId]: type } };
    });
  }, []);

  const findUserEvent = useCallback(
    (id: string) => state.userEvents.find((e) => e.id === id) ?? googleEvents.find((e) => e.id === id),
    [state.userEvents, googleEvents],
  );

  // Persist after every change: signed-in accounts on the server (shortly after the last change), demo in this browser.
  useEffect(() => {
    if (google.signedIn) {
      if (!accountReady) return; // never overwrite the account with data loaded before it
      const t = setTimeout(() => void saveAccountState(state), 400);
      return () => clearTimeout(t);
    }
    if (google.status === 'loading' || persistStatus === 'unavailable') return;
    const ok = saveState(state);
    if (!ok) setPersistStatus('write-failed');
  }, [state, persistStatus, google.signedIn, google.status, accountReady]);

  const finishGeneration = useCallback((eventId: string) => {
    if (timers.current.has(eventId)) return;
    const t = setTimeout(() => {
      timers.current.delete(eventId);
      setState((s) => (s.briefStatus[eventId] === 'generating' ? { ...s, briefStatus: { ...s.briefStatus, [eventId]: 'ready' } } : s));
    }, BRIEF_GENERATION_MS);
    timers.current.set(eventId, t);
  }, []);

  // A reload mid-generation resumes and completes it.
  useEffect(() => {
    for (const [id, status] of Object.entries(state.briefStatus)) {
      if (status === 'generating') finishGeneration(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  const generateBrief = useCallback(
    (eventId: string) => {
      if (stateRef.current.briefStatus[eventId] === 'scheduled') track('brief_generated', { event_id: eventId, source: 'demo' });
      setState((s) => {
        if (s.briefStatus[eventId] !== 'scheduled') return s; // prevents duplicate work
        return { ...s, briefStatus: { ...s.briefStatus, [eventId]: 'generating' } };
      });
      finishGeneration(eventId);
    },
    [finishGeneration],
  );

  const getQuestionState = useCallback(
    (eventId: string, defaultIds: string[]): QuestionState =>
      state.questionState[eventId] ?? { shownIds: defaultIds, savedIds: [], focus: 'all' },
    [state.questionState],
  );

  const updateQuestionState = useCallback((eventId: string, defaultIds: string[], fn: (q: QuestionState) => QuestionState) => {
    setState((s) => {
      const cur = s.questionState[eventId] ?? { shownIds: defaultIds, savedIds: [], focus: 'all' as const };
      return { ...s, questionState: { ...s.questionState, [eventId]: fn(cur) } };
    });
  }, []);

  const addChatMessage = useCallback((msg: ChatMessage) => {
    if (msg.role === 'user') track('chat_message_sent', { event_id: msg.eventId });
    setState((s) => ({ ...s, chats: { ...s.chats, [msg.eventId]: [...(s.chats[msg.eventId] ?? []), msg] } }));
  }, []);

  const setPriorityCompanies = useCallback((eventId: string, list: string[]) => {
    setState((s) => ({ ...s, priorityCompanies: { ...s.priorityCompanies, [eventId]: list } }));
  }, []);

  const upsertContact = useCallback((c: Contact) => {
    if (!stateRef.current.contacts.some((x) => x.id === c.id)) track('contact_added');
    setState((s) => {
      const exists = s.contacts.some((x) => x.id === c.id);
      return { ...s, contacts: exists ? s.contacts.map((x) => (x.id === c.id ? c : x)) : [...s.contacts, c] };
    });
  }, []);

  const deleteContact = useCallback((id: string) => {
    setState((s) => ({ ...s, contacts: s.contacts.filter((c) => c.id !== id) }));
  }, []);

  const toggleSaveArticle = useCallback((id: string) => {
    if (!stateRef.current.savedArticleIds.includes(id)) track('article_saved', { article_id: id });
    setState((s) => {
      if (s.savedArticleIds.includes(id)) {
        const labPositions = { ...s.labPositions };
        delete labPositions[id];
        return { ...s, savedArticleIds: s.savedArticleIds.filter((x) => x !== id), labPositions };
      }
      const article = SEED_ARTICLES.find((a) => a.id === id);
      if (!article) return s;
      // Freeze the current cluster layout, then place the new article in a free slot.
      const clusterIds = SEED_ARTICLES.filter((a) => a.industry === article.industry && s.savedArticleIds.includes(a.id))
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((a) => a.id);
      const current = layoutCluster(clusterIds, s.labPositions);
      const slot = findFreeSlot(Object.values(current));
      const labPositions: Record<string, LabNodePosition> = { ...s.labPositions };
      for (const [aid, off] of Object.entries(current)) labPositions[aid] = { articleId: aid, x: off.x, y: off.y };
      labPositions[id] = { articleId: id, x: slot.x, y: slot.y };
      return { ...s, savedArticleIds: [...s.savedArticleIds, id], labPositions };
    });
  }, []);

  const setLabPosition = useCallback((articleId: string, x: number, y: number) => {
    setState((s) => ({ ...s, labPositions: { ...s.labPositions, [articleId]: { articleId, x, y } } }));
  }, []);

  const resetLabPositions = useCallback((articleIds: string[]) => {
    setState((s) => {
      const labPositions = { ...s.labPositions };
      for (const id of articleIds) delete labPositions[id];
      return { ...s, labPositions };
    });
  }, []);

  const updateProfile = useCallback((p: Profile) => setState((s) => ({ ...s, profile: p })), []);
  const setCalendarConnected = useCallback((v: boolean) => {
    if (v) track('calendar_connected', { source: 'demo' });
    setState((s) => ({ ...s, calendarConnected: v }));
  }, []);

  const addUserEvent = useCallback((ev: UserEvent) => setState((s) => ({ ...s, userEvents: [...s.userEvents, ev] })), []);

  const deleteUserEvent = useCallback((id: string) => {
    setState((s) => {
      const aiBriefs = { ...s.aiBriefs };
      delete aiBriefs[id];
      return { ...s, userEvents: s.userEvents.filter((e) => e.id !== id), aiBriefs };
    });
  }, []);

  const generateAiBrief = useCallback(async (eventId: string, attachment?: BriefAttachment, detailsNow?: EventDetails) => {
    const ev = stateRef.current.userEvents.find((e) => e.id === eventId) ?? googleEventsRef.current.find((e) => e.id === eventId);
    if (!ev) return;
    setAiPending((p) => ({ ...p, [eventId]: true }));
    setAiErrors((e) => ({ ...e, [eventId]: '' }));
    try {
      const s = stateRef.current;
      const input = aiInputFor(ev, classifiedRef.current[eventId]?.classification, { details: detailsNow ?? s.eventDetails[eventId], contacts: s.contacts, extraction: s.aiExtractions[eventId] });
      const run = await requestAiBrief(input, attachment);
      setState((s) => ({ ...s, aiBriefs: { ...s.aiBriefs, [eventId]: run } }));
      track('brief_generated', { source: 'ai', event_id: eventId, model: run.model, input_tokens: run.usage.inputTokens, output_tokens: run.usage.outputTokens, cost_usd: run.costUsd });
    } catch (err) {
      setAiErrors((e) => ({ ...e, [eventId]: err instanceof Error ? err.message : 'Something went wrong.' }));
    } finally {
      setAiPending((p) => ({ ...p, [eventId]: false }));
    }
  }, []);

  const resetDemo = useCallback(() => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current.clear();
    clearState();
    setState(createSeedState());
    setPersistStatus((p) => (p === 'unavailable' ? p : 'ok'));
  }, []);

  const value: StoreValue = {
    state,
    persistStatus,
    generateBrief,
    getQuestionState,
    updateQuestionState,
    addChatMessage,
    setPriorityCompanies,
    upsertContact,
    deleteContact,
    toggleSaveArticle,
    setLabPosition,
    resetLabPositions,
    updateProfile,
    setCalendarConnected,
    resetDemo,
    addUserEvent,
    deleteUserEvent,
    generateAiBrief,
    aiPending,
    aiErrors,
    google,
    googleEvents,
    googleError,
    googleLoading,
    reloadGoogleCalendar,
    signOutGoogle,
    disconnectGoogle,
    findUserEvent,
    demoMode,
    enterDemo,
    exitDemo,
    accountReady,
    completeOnboarding,
    classified,
    setClassOverride,
    ignoreSeries,
    unignoreSeries,
    removeEvent,
    updateAiRun,
    setEventDetails,
    readEvent,
    aiInputOf,
    restoreRemoved,
    addFromCalendar,
  };
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
