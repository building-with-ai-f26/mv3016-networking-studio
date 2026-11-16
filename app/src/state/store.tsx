// App-wide state: one shared store, persisted to localStorage on every change.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SEED_ARTICLES } from '../data/seed';
import { layoutCluster, findFreeSlot } from '../lib/labLayout';
import { clearState, createSeedState, loadState, saveState, type StorageHealth } from '../services/storage';
import { BRIEF_GENERATION_MS } from '../services/mockServices';
import { track } from '../lib/analytics';
import { formatLongDate, formatTimeRange, tzAbbrev } from '../lib/time';
import { requestAiBrief } from '../services/aiBrief';
import { fetchAccount, fetchCalendarEvents, postAuth, SIGNED_OUT, toUserEvent } from '../services/google';
import type { AiEventInput, ChatMessage, Contact, GoogleAccount, LabNodePosition, PersistedState, Profile, QuestionState, UserEvent } from '../types';

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
  generateAiBrief: (eventId: string) => Promise<void>;
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
}

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

/** What we send to the AI: only the fields the user typed. */
export function aiInputFor(ev: UserEvent): AiEventInput {
  const when = `${formatLongDate(ev.start)}, ${formatTimeRange(ev.start, ev.end)} ${tzAbbrev(ev.start)}${ev.location ? ` · ${ev.location}` : ''}`;
  return { title: ev.title, datetime: when, company: ev.company, person: ev.person, role: ev.role, notes: [ev.type !== 'Other' ? `Event type: ${ev.type}.` : '', ev.notes].filter(Boolean).join(' ') };
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
  const [googleEvents, setGoogleEvents] = useState<UserEvent[]>([]);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const googleEventsRef = useRef(googleEvents);
  const [demoMode, setDemoMode] = useState(readDemoFlag);
  const enterDemo = useCallback(() => {
    writeDemoFlag(true);
    setDemoMode(true);
  }, []);
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

  // On start: ask the local server who is signed in, then load the calendar if it is connected.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const acc = await fetchAccount();
      if (!alive) return;
      setGoogle(acc);
      const flag = new URLSearchParams(window.location.search).get('google');
      if (flag === 'signed-in' && acc.signedIn) track('signed_in', { provider: 'google' });
      if (flag === 'calendar-connected' && acc.calendarConnected) track('calendar_connected', { source: 'google' });
      if (acc.calendarConnected) await reloadGoogleCalendar();
    })();
    return () => {
      alive = false;
    };
  }, [reloadGoogleCalendar]);

  const signOutGoogle = useCallback(async () => {
    await postAuth('/auth/signout');
    writeDemoFlag(false);
    setDemoMode(false);
    setGoogle((g) => ({ ...g, signedIn: false, email: null, name: null, calendarConnected: false }));
    setGoogleEvents([]);
  }, []);

  const disconnectGoogle = useCallback(async () => {
    await postAuth('/auth/disconnect');
    writeDemoFlag(false);
    setDemoMode(false);
    setGoogle((g) => ({ ...g, signedIn: false, email: null, name: null, calendarConnected: false }));
    setGoogleEvents([]);
  }, []);

  const findUserEvent = useCallback(
    (id: string) => state.userEvents.find((e) => e.id === id) ?? googleEvents.find((e) => e.id === id),
    [state.userEvents, googleEvents],
  );

  // Persist after every change.
  useEffect(() => {
    if (persistStatus === 'unavailable') return;
    const ok = saveState(state);
    if (!ok) setPersistStatus('write-failed');
  }, [state, persistStatus]);

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

  const generateAiBrief = useCallback(async (eventId: string) => {
    const ev = stateRef.current.userEvents.find((e) => e.id === eventId) ?? googleEventsRef.current.find((e) => e.id === eventId);
    if (!ev) return;
    setAiPending((p) => ({ ...p, [eventId]: true }));
    setAiErrors((e) => ({ ...e, [eventId]: '' }));
    try {
      const run = await requestAiBrief(aiInputFor(ev));
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
  };
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
