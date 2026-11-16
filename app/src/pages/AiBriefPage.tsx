// "AI Brief": add an event and generate a REAL prep brief with AI (through the local server).
import { AlertTriangle, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { track } from '../lib/analytics';
import { EMPTY_EVENT, formatUsd, loadRuns, requestAiBrief, saveRuns } from '../services/aiBrief';
import type { AiBriefRun, AiEventInput } from '../types';

/** Highlights every "Not verified" so the reader sees what still needs checking. */
function Flagged({ text }: { text: string }) {
  const parts = text.split(/(Not verified)/gi);
  return (
    <>
      {parts.map((p, i) =>
        /^not verified$/i.test(p) ? (
          <mark key={i} className="not-verified">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ai-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function AiBriefDocument({ run }: { run: AiBriefRun }) {
  const { brief, event } = run;
  let n = 0;
  return (
    <article className="card ai-brief" aria-labelledby={`brief-${run.id}`}>
      <div className="ai-brief-head">
        <span className="ai-draft-badge">
          <Sparkles size={14} aria-hidden /> AI-generated draft
        </span>
        <span className="muted small">Check facts marked “Not verified” before the event.</span>
      </div>
      <h2 id={`brief-${run.id}`}>{event.title}</h2>
      <p className="muted small">{[event.datetime, event.company, [event.person, event.role].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</p>

      <Section title="Event essentials">
        <p>
          <Flagged text={brief.essentials.summary} />
        </p>
        <p>
          <strong>Who you will meet:</strong> <Flagged text={brief.essentials.whoYouWillMeet} />
        </p>
        <p>
          <strong>Your goal:</strong> <Flagged text={brief.essentials.goalForTheConversation} />
        </p>
        {brief.essentials.prepTips.length > 0 && (
          <ul>
            {brief.essentials.prepTips.map((t, i) => (
              <li key={i}>
                <Flagged text={t} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Company overview">
        <p>
          <Flagged text={brief.companyOverview} />
        </p>
      </Section>

      <Section title="Relevant products">
        <ul>
          {brief.relevantProducts.map((p, i) => (
            <li key={i}>
              <strong>
                <Flagged text={p.name} />
              </strong>
              : <Flagged text={p.whyItMatters} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Questions to ask">
        {brief.questionThemes.map((t, i) => (
          <div key={i} className="ai-theme">
            <h4>{t.theme}</h4>
            <ol start={n + 1}>
              {t.questions.map((q, j) => {
                n += 1;
                return (
                  <li key={j}>
                    <Flagged text={q} />
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </Section>

      <Section title="What to verify before the event">
        <ul className="verify-list">
          {brief.verifyBeforeEvent.map((v, i) => (
            <li key={i}>
              <AlertTriangle size={15} aria-hidden /> <Flagged text={v} />
            </li>
          ))}
        </ul>
      </Section>

      <footer className="ai-usage muted small" aria-label="Usage and cost for this run">
        Model {run.model} · {run.usage.inputTokens.toLocaleString()} input + {run.usage.outputTokens.toLocaleString()} output tokens · Cost per run {formatUsd(run.costUsd)} (at paid rates) ·{' '}
        {new Date(run.generatedAt).toLocaleString()}
      </footer>
    </article>
  );
}

export function AiBriefPage() {
  const uid = useId();
  const location = useLocation();
  const prefill = (location.state as { prefill?: Partial<AiEventInput> } | null)?.prefill;
  const [draft, setDraft] = useState<AiEventInput>({ ...EMPTY_EVENT, ...prefill });
  const [runs, setRuns] = useState<AiBriefRun[]>(() => loadRuns());
  const [selectedId, setSelectedId] = useState<string | null>(() => runs[0]?.id ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof AiEventInput, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const selected = runs.find((r) => r.id === selectedId) ?? null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim()) return setError('Add an event title.');
    if (!draft.company.trim() && !draft.person.trim()) return setError('Add at least a company or a person.');
    setError(null);
    setLoading(true);
    try {
      const run = await requestAiBrief(draft);
      const next = [run, ...runs];
      setRuns(next);
      saveRuns(next);
      setSelectedId(run.id);
      track('brief_generated', { source: 'ai', model: run.model, input_tokens: run.usage.inputTokens, output_tokens: run.usage.outputTokens, cost_usd: run.costUsd });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const remove = (id: string) => {
    const next = runs.filter((r) => r.id !== id);
    setRuns(next);
    saveRuns(next);
    if (selectedId === id) setSelectedId(next[0]?.id ?? null);
  };

  const field = (k: keyof AiEventInput, label: string, placeholder: string, required = false) => (
    <div className="field">
      <label htmlFor={`${uid}-${k}`}>
        {label}
        {required && <span aria-hidden> *</span>}
      </label>
      <input id={`${uid}-${k}`} className="input" value={draft[k]} placeholder={placeholder} onChange={(e) => set(k, e.target.value)} maxLength={k === 'title' ? 200 : 120} />
    </div>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>AI Brief</h1>
          <p className="subtitle">Add an event and get a real AI prep brief in a few seconds.</p>
        </div>
      </div>
      <div className="notice info small">
        This page uses a real AI model through your local server. The brief is a draft: it never includes news or financial figures, and marks anything uncertain as “Not verified”.
      </div>

      <form className="card" onSubmit={submit} noValidate aria-labelledby={`${uid}-form`}>
        <h2 id={`${uid}-form`}>Add event</h2>
        <div className="form-grid">
          {field('title', 'Event title', 'Coffee chat with Jordan', true)}
          {field('datetime', 'Date and time', 'Nov 18, 4:00 pm')}
          {field('company', 'Company', 'Spotify')}
          {field('person', 'Person', 'Jordan Lee')}
          {field('role', 'Role', 'Product Manager')}
        </div>
        <div className="field">
          <label htmlFor={`${uid}-notes`}>Notes</label>
          <textarea id={`${uid}-notes`} className="input" rows={3} value={draft.notes} maxLength={2000} placeholder="What you want from this conversation" onChange={(e) => set('notes', e.target.value)} />
        </div>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn" disabled={loading}>
          {loading ? <Loader2 size={16} className="spin" aria-hidden /> : <Sparkles size={16} aria-hidden />}
          {loading ? 'Generating brief…' : 'Generate brief with AI'}
        </button>
      </form>

      {selected && <AiBriefDocument run={selected} />}

      {runs.length > 1 && (
        <section className="card" aria-label="Previous AI briefs">
          <h2>Previous AI briefs</h2>
          <ul className="ai-history">
            {runs.map((r) => (
              <li key={r.id}>
                <button type="button" className={r.id === selectedId ? 'btn secondary small active' : 'btn ghost small'} onClick={() => setSelectedId(r.id)}>
                  {r.event.title}
                </button>
                <span className="muted small">{formatUsd(r.costUsd)}</span>
                <button type="button" className="icon-btn" aria-label={`Delete brief ${r.event.title}`} onClick={() => remove(r.id)}>
                  <Trash2 size={16} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
