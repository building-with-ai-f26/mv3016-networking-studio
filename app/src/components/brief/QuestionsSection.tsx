import { Bookmark, BookmarkCheck, Copy, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { allQuestions, nextQuestionBatch } from '../../services/mockServices';
import { useStore } from '../../state/store';
import type { Brief, Question, QuestionCategory, QuestionState } from '../../types';
import { copyText } from './copy';

const CATEGORY_LABEL: Record<QuestionCategory, string> = {
  strategy: 'Company strategy',
  role: 'Role & team',
  industry: 'Industry',
  career: 'Career advice',
};
const CATEGORY_ORDER: QuestionCategory[] = ['strategy', 'role', 'industry', 'career'];
const FOCUS: Array<{ id: QuestionState['focus']; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'role', label: 'Role' },
  { id: 'career', label: 'Career' },
];

interface Props {
  brief: Brief;
  selectedSpeakers: string[];
  onToast: (msg: string) => void;
}

export function QuestionsSection({ brief, selectedSpeakers, onToast }: Props) {
  const { state, getQuestionState, updateQuestionState } = useStore();
  const defaultIds = useMemo(() => brief.questions.map((x) => x.id), [brief]);
  const qs = getQuestionState(brief.eventId, defaultIds);
  const [savedOnly, setSavedOnly] = useState(false);
  const [newIds, setNewIds] = useState<string[]>([]);
  const [exhausted, setExhausted] = useState<string | null>(null);

  const byId = useMemo(() => new Map(allQuestions(brief).map((x) => [x.id, x])), [brief]);
  const people = useMemo(() => new Map(brief.people.map((p) => [p.id, p])), [brief]);
  const shown = qs.shownIds.map((id) => byId.get(id)).filter((x): x is Question => !!x);
  const visible = shown.filter(
    (x) => (!savedOnly || qs.savedIds.includes(x.id)) && (selectedSpeakers.length === 0 || !x.personId || selectedSpeakers.includes(x.personId)),
  );

  const generate = () => {
    const batch = nextQuestionBatch(brief, qs, state.profile.roles);
    if (batch.length === 0) {
      const focusLabel = FOCUS.find((f) => f.id === qs.focus)?.label ?? 'All';
      setExhausted(
        qs.focus === 'all'
          ? 'You’ve seen all the curated questions for this event.'
          : `No more ${focusLabel} questions for this event. Try another focus.`,
      );
      return;
    }
    setExhausted(null);
    setNewIds(batch.map((b) => b.id));
    updateQuestionState(brief.eventId, defaultIds, (cur) => ({ ...cur, shownIds: [...cur.shownIds, ...batch.map((b) => b.id).filter((id) => !cur.shownIds.includes(id))] }));
    onToast(`Added ${batch.length} new question${batch.length > 1 ? 's' : ''}`);
  };

  const toggleSave = (id: string) =>
    updateQuestionState(brief.eventId, defaultIds, (cur) => ({
      ...cur,
      savedIds: cur.savedIds.includes(id) ? cur.savedIds.filter((x) => x !== id) : [...cur.savedIds, id],
    }));

  const setFocus = (focus: QuestionState['focus']) => {
    setExhausted(null);
    updateQuestionState(brief.eventId, defaultIds, (cur) => ({ ...cur, focus }));
  };

  return (
    <div>
      <p className="muted small">
        Curated sample questions, adapted to this event type and your saved preferences ({state.profile.roles.slice(0, 2).join(', ') || 'no roles selected'}). Not live AI.
      </p>
      <div className="q-toolbar">
        <div>
          <span className="small muted" id={`focus-label-${brief.eventId}`}>
            Focus for new questions
          </span>
          <div className="chip-row" role="group" aria-labelledby={`focus-label-${brief.eventId}`} style={{ marginTop: 4 }}>
            {FOCUS.map((f) => (
              <button key={f.id} type="button" className="chip" aria-pressed={qs.focus === f.id} onClick={() => setFocus(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="chip outline" aria-pressed={savedOnly} onClick={() => setSavedOnly((v) => !v)}>
            Saved only ({qs.savedIds.length})
          </button>
          <button type="button" className="btn small" onClick={generate}>
            <Sparkles size={15} aria-hidden /> Generate more questions
          </button>
        </div>
      </div>
      {selectedSpeakers.length > 0 && (
        <p className="small notice info" style={{ marginBottom: 12 }}>
          Showing questions for the selected speakers plus general questions.
        </p>
      )}
      {exhausted && (
        <p className="notice info small" role="status">
          {exhausted}
        </p>
      )}
      {visible.length === 0 ? (
        <p className="empty-state">{savedOnly ? 'No saved questions yet. Use the bookmark icon to save one.' : 'No questions match the current selection.'}</p>
      ) : (
        CATEGORY_ORDER.map((cat) => {
          const list = visible.filter((x) => x.category === cat);
          if (list.length === 0) return null;
          return (
            <div className="q-group" key={cat}>
              <h3>{CATEGORY_LABEL[cat]}</h3>
              <ul className="q-list">
                {list.map((x) => {
                  const saved = qs.savedIds.includes(x.id);
                  const speaker = x.personId ? people.get(x.personId) : undefined;
                  return (
                    <li key={x.id} className={newIds.includes(x.id) ? 'q-item new' : 'q-item'} data-testid="question">
                      <div className="q-text">
                        {x.text}
                        {speaker && <span className="speaker-tag">For {speaker.name}</span>}
                      </div>
                      <div className="q-actions">
                        <button
                          type="button"
                          className="icon-btn"
                          aria-pressed={saved}
                          aria-label={saved ? `Unsave question: ${x.text}` : `Save question: ${x.text}`}
                          title={saved ? 'Saved' : 'Save'}
                          onClick={() => toggleSave(x.id)}
                        >
                          {saved ? <BookmarkCheck size={18} aria-hidden /> : <Bookmark size={18} aria-hidden />}
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Copy question: ${x.text}`}
                          title="Copy"
                          onClick={async () => onToast((await copyText(x.text)) ? 'Question copied' : 'Could not copy — select the text instead')}
                        >
                          <Copy size={17} aria-hidden />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })
      )}
    </div>
  );
}
