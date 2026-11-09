// App-wide state: one shared store, persisted to localStorage on every change.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SEED_ARTICLES } from '../data/seed';
import { layoutCluster, findFreeSlot } from '../lib/labLayout';
import { clearState, createSeedState, loadState, saveState, type StorageHealth } from '../services/storage';
import { BRIEF_GENERATION_MS } from '../services/mockServices';
import type { ChatMessage, Contact, LabNodePosition, PersistedState, Profile, QuestionState } from '../types';

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
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(() => loadState(), []);
  const [state, setState] = useState<PersistedState>(initial.state);
  const [persistStatus, setPersistStatus] = useState<PersistStatus>(initial.health);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

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
    setState((s) => ({ ...s, chats: { ...s.chats, [msg.eventId]: [...(s.chats[msg.eventId] ?? []), msg] } }));
  }, []);

  const setPriorityCompanies = useCallback((eventId: string, list: string[]) => {
    setState((s) => ({ ...s, priorityCompanies: { ...s.priorityCompanies, [eventId]: list } }));
  }, []);

  const upsertContact = useCallback((c: Contact) => {
    setState((s) => {
      const exists = s.contacts.some((x) => x.id === c.id);
      return { ...s, contacts: exists ? s.contacts.map((x) => (x.id === c.id ? c : x)) : [...s.contacts, c] };
    });
  }, []);

  const deleteContact = useCallback((id: string) => {
    setState((s) => ({ ...s, contacts: s.contacts.filter((c) => c.id !== id) }));
  }, []);

  const toggleSaveArticle = useCallback((id: string) => {
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
  const setCalendarConnected = useCallback((v: boolean) => setState((s) => ({ ...s, calendarConnected: v })), []);

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
  };
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
