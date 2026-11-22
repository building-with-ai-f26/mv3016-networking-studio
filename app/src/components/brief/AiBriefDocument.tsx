// Renders a REAL AI-generated brief with the same 8 sections (and look) as the sample briefs.
import { AlertTriangle, Bookmark, BookmarkCheck, Building2, Copy, ExternalLink, FileQuestion, Loader2, Search, Sparkles, UserRound } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { track } from '../../lib/analytics';
import { requestMoreQuestions } from '../../services/aiBrief';
import { useStore } from '../../state/store';
import { useToast } from '../Toast';
import { copyText } from './copy';
import { companiesFromAttendees } from '../../lib/classifier';
import { formatUsd } from '../../services/aiBrief';
import type { AiBrief, AiBriefRun, UserEvent } from '../../types';
import { AiBriefV3Document } from './AiBriefV3';

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

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  const id = `ai-s-${n}`;
  return (
    <section className="doc-section" aria-labelledby={id}>
      <h2 id={id}>
        <span className="section-num" aria-hidden>
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function ToCheck({ intro, items }: { intro: string; items: string[] }) {
  return (
    <div className="empty-state">
      <Search size={20} aria-hidden />
      <div>
        <strong>
          <mark className="not-verified">Not verified</mark> {intro}
        </strong>
        {items.length > 0 && (
          <ul className="clean" style={{ marginTop: 6 }}>
            {items.map((x, i) => (
              <li key={i}>
                <Flagged text={x} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2);

/** Second line of defense (the server sanitizes too, and the CSP blocks inline scripts): nothing executable is rendered. */
export function stripActive(html: string): string {
  return html
    .replace(/<\s*(script|iframe|object|embed|form|link|meta|base)\b[\s\S]*?(<\s*\/\s*\1\s*>|\/?>)/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
}

/** Clickable source numbers next to a fact, e.g. [1][3]: each opens that web source (clicks not tracked). */
function Refs({ refs, web, required = false }: { refs?: number[]; web?: AiBrief['web']; required?: boolean }) {
  // A web fact with no linked source is flagged instead of shown as if it were sourced.
  if (web && required && !refs?.some((k) => web.sources[k])) return <mark className="not-verified cite-missing">Not verified</mark>;
  if (!web || !refs?.length) return null;
  return (
    <sup className="cites">
      {refs
        .filter((k) => web.sources[k])
        .map((k) => (
          <a key={k} className="cite ph-no-capture" href={web.sources[k].uri} target="_blank" rel="noopener noreferrer" title={web.sources[k].title || 'Source'} aria-label={`Source ${k + 1}: ${web.sources[k].title || 'web page'}`}>
            {k + 1}
          </a>
        ))}
    </sup>
  );
}

export function AiBriefDocument({ run, event }: { run: AiBriefRun; event: UserEvent }) {
  // Briefs written by the research agent (version 3) have their own layout; older briefs keep this one.
  if (run.brief.version === 3) return <AiBriefV3Document run={run} brief={run.brief} event={event} />;
  const brief = run.brief;
  const domainCompanies = event.google ? companiesFromAttendees(event) : [];
  return (
    <article className="card doc ai-brief" aria-label="AI-generated brief">
      <div className="ai-brief-head">
        <span className="ai-draft-badge">
          <Sparkles size={14} aria-hidden /> AI-generated draft
        </span>
        <span className="muted small">
          {brief.web ? 'Written with Google Search: news and figures come from the sources in section 8.' : (brief.webSearchNote ?? 'No web search: news and financials are not filled in.')} Check anything marked “Not verified” before the event.
        </span>
      </div>

      <Section n={1} title="Event essentials & what to prepare">
        <div className="summary-box">
          <span className="label-tag">Preparation summary</span>
          <p style={{ margin: '4px 0 0' }}>
            <Flagged text={brief.essentials.summary} />
          </p>
        </div>
        {brief.essentials.goal && (
          <p style={{ marginTop: 12 }}>
            <strong>Your goal:</strong> <Flagged text={brief.essentials.goal} />
          </p>
        )}
        <h3 style={{ margin: '14px 0 6px' }}>Prepare for</h3>
        <ul className="clean">
          {brief.essentials.prepareFor.map((p, i) => (
            <li key={i}>
              <Flagged text={p} />
            </li>
          ))}
        </ul>
      </Section>

      <Section n={2} title="People & roles">
        {brief.people.length === 0 ? (
          <div className="empty-state">
            <FileQuestion size={22} aria-hidden />
            <div>No speaker or host is named in this event. Check the invitation or the event page.</div>
          </div>
        ) : (
          <div className="people-grid">
            {brief.people.map((p, i) => (
              <div className="person-card" key={i}>
                <div className="person-cell">
                  <span className="initials" aria-hidden>
                    {initials(p.name) || <UserRound size={16} />}
                  </span>
                  <span className="name">{p.name}</span>
                </div>
                <div className="small" style={{ marginTop: 8 }}>
                  <div>
                    <span className="muted">Role: </span>
                    {p.role ? <Flagged text={p.role} /> : <span className="unknown">Not in the event details</span>}
                    <Refs refs={p.refs} web={brief.web} />
                  </div>
                  <div>
                    <span className="muted">Company: </span>
                    {p.company ? <Flagged text={p.company} /> : <span className="unknown">Not in the event details</span>}
                  </div>
                  {p.howToConnect && (
                    <p style={{ margin: '6px 0 0' }}>
                      <span className="muted">How to connect: </span>
                      <Flagged text={p.howToConnect} />
                    </p>
                  )}
                </div>
                {p.foundIn && <span className="prov">Found in: {p.foundIn}</span>}
              </div>
            ))}
          </div>
        )}
      </Section>

      {brief.peopleWeb && brief.peopleWeb.length > 0 && (
        <div className="web-facts" style={{ margin: '-4px 0 18px' }}>
          <p className="muted small" style={{ margin: 0 }}>
            From the web (public professional info)
          </p>
          {brief.peopleWeb.map((p, i) => (
            <div className="web-fact" key={i}>
              <strong>{p.name}</strong>: <Flagged text={p.info} />
              <Refs refs={p.refs} web={brief.web} required />
            </div>
          ))}
        </div>
      )}

      <Section n={3} title="Companies">
        {brief.companies.length === 0 ? (
          <div className="empty-state">
            <FileQuestion size={22} aria-hidden />
            <div>No company could be identified from this event. Check the invitation for the host company.</div>
          </div>
        ) : (
          <>
            <p className="muted small">General background for preparation, from the model’s general knowledge. Verify details before the event.</p>
            <div className="company-grid">
              {brief.companies.map((c, i) => (
                <div className="company-card" key={i}>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Building2 size={17} aria-hidden /> {c.name}
                  </h3>
                  <p className="small" style={{ margin: '6px 0' }}>
                    <Flagged text={c.overview} />
                    <Refs refs={c.refs} web={brief.web} />
                  </p>
                  {c.businessModel && (
                    <p className="small" style={{ margin: '6px 0' }}>
                      <span className="muted">Business model: </span>
                      <Flagged text={c.businessModel} />
                    </p>
                  )}
                  {c.products.length > 0 && (
                    <>
                      <p className="small muted" style={{ margin: '8px 0 4px' }}>
                        Relevant products
                      </p>
                      <ul className="clean small">
                        {c.products.map((p, j) => (
                          <li key={j}>
                            <strong>
                              <Flagged text={p.name} />
                            </strong>
                            : <Flagged text={p.whyItMatters} />
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {c.foundIn && <span className="prov">Found in: {c.foundIn}</span>}
                </div>
              ))}
            </div>
          </>
        )}
      </Section>

      <Section n={4} title="Latest financial-report highlights">
        {brief.financialHighlights?.length ? (
          <>
            <div className="web-facts">
              {brief.financialHighlights.map((f, i) => (
                <div className="web-fact" key={i}>
                  <Flagged text={f.fact} />
                  <Refs refs={f.refs} web={brief.web} required />
                  <div className="web-meta">{[f.period, f.source].filter(Boolean).join(' · ')}</div>
                </div>
              ))}
            </div>
            {brief.financialsToCheck.length > 0 && <ToCheck intro="— also check:" items={brief.financialsToCheck} />}
          </>
        ) : (
          <ToCheck intro={brief.web ? '— no reliable figures found in the web search. Look up:' : '— no web search, so no figures are shown. Look up:'} items={brief.financialsToCheck} />
        )}
      </Section>

      <Section n={5} title="Company news (last 3 months)">
        {brief.companyNews?.length ? (
          <>
            <div className="web-facts">
              {brief.companyNews.map((n, i) => (
                <div className="web-fact" key={i}>
                  <strong>
                    <Flagged text={n.headline} />
                  </strong>
                  <Refs refs={n.refs} web={brief.web} required />
                  <div className="web-meta">{[n.date, n.source].filter(Boolean).join(' · ')}</div>
                  {n.whyItMatters && (
                    <p className="small" style={{ margin: '6px 0 0' }}>
                      <span className="muted">Why it matters: </span>
                      <Flagged text={n.whyItMatters} />
                    </p>
                  )}
                </div>
              ))}
            </div>
            {brief.companyNewsToCheck.length > 0 && <ToCheck intro="— also check:" items={brief.companyNewsToCheck} />}
          </>
        ) : (
          <ToCheck intro={brief.web ? '— no recent news found in the web search. Look up:' : '— no web search, so no news is shown. Look up:'} items={brief.companyNewsToCheck} />
        )}
      </Section>

      <Section n={6} title="Industry themes & why they matter">
        <p className="muted small">Long-running themes in the industry (not news). Good starting points for conversation.</p>
        <ul className="clean">
          {brief.industryThemes.map((t, i) => (
            <li key={i}>
              <strong>
                <Flagged text={t.theme} />
              </strong>
              : <Flagged text={t.whyItMatters} />
            </li>
          ))}
        </ul>
      </Section>

      <Section n={7} title="Suggested questions">
        <AiQuestions run={run} eventId={event.id} />
      </Section>

      <Section n={8} title="Sources & what to verify">
        <ul className="clean small">
          <li>{event.source === 'google' ? 'Your Google Calendar event: title, time, location and description (emails, links and numbers removed).' : 'The event details you typed.'}</li>
          {domainCompanies.length > 0 && <li>Company guessed from attendee email domains: {domainCompanies.join(', ')}.</li>}
          <li>{brief.web ? 'Google Search results (listed below) and the model’s general knowledge.' : 'The model’s general knowledge (not checked against the web).'}</li>
        </ul>
        {brief.web && (
          // Google's terms: show the sources and Search Suggestions with grounded results; clicks here are not tracked.
          <div className="ph-no-capture">
            {brief.web.sources.length > 0 && (
              <>
                <h3 style={{ margin: '14px 0 6px' }}>Web sources (Google Search)</h3>
                <ol className="research-sources">
                  {brief.web.sources.map((s) => (
                    <li key={s.uri}>
                      <a href={s.uri} target="_blank" rel="noopener noreferrer">
                        {s.title || 'Source'} <ExternalLink size={12} aria-hidden />
                      </a>
                    </li>
                  ))}
                </ol>
              </>
            )}
            {brief.web.suggestionsHtml && <div className="search-suggestions no-print" dangerouslySetInnerHTML={{ __html: stripActive(brief.web.suggestionsHtml) }} />}
          </div>
        )}
        {brief.verifyBeforeEvent.length > 0 && (
          <>
            <h3 style={{ margin: '14px 0 6px' }}>What to verify before the event</h3>
            <ul className="verify-list">
              {brief.verifyBeforeEvent.map((v, i) => (
                <li key={i}>
                  <AlertTriangle size={15} aria-hidden /> <Flagged text={v} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <footer className="ai-usage muted small" aria-label="Usage and cost for this run">
        Model {run.model} · {run.usage.inputTokens.toLocaleString('en-US')} input + {run.usage.outputTokens.toLocaleString('en-US')} output tokens · Cost per run{' '}
        {formatUsd(run.costUsd)} (at paid rates) · Generated {new Date(run.generatedAt).toLocaleString('en-US')}
      </footer>
    </article>
  );
}

/** All questions of a run, grouped by theme: the brief's 10 plus any added with "Generate more questions". */
export function allAiQuestions(run: AiBriefRun): Array<{ theme: string; questions: string[] }> {
  const groups = run.brief.questionThemes.map((t) => ({ theme: t.theme, questions: [...t.questions] }));
  for (const q of run.extraQuestions ?? []) {
    const g = groups.find((x) => x.theme.toLowerCase() === q.theme.toLowerCase());
    if (g) g.questions.push(q.question);
    else groups.push({ theme: q.theme, questions: [q.question] });
  }
  return groups;
}

/** Section 7 of an AI brief: save, copy, "Saved only", and "Generate more questions" (real AI). */
export function AiQuestions({ run, eventId, renderContext }: { run: AiBriefRun; eventId: string; renderContext?: (theme: string) => ReactNode }) {
  const { updateAiRun, aiInputOf } = useStore();
  const [savedOnly, setSavedOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  const [toast, showToast] = useToast();
  const saved = run.savedQuestions ?? [];
  const groups = allAiQuestions(run);

  const toggle = (q: string) => {
    if (!saved.includes(q)) track('question_saved', { event_id: eventId, source: 'ai' });
    updateAiRun(eventId, (r) => {
      const cur = r.savedQuestions ?? [];
      return { ...r, savedQuestions: cur.includes(q) ? cur.filter((x) => x !== q) : [...cur, q] };
    });
  };

  const more = async () => {
    const input = aiInputOf(eventId);
    if (!input) return;
    setBusy(true);
    setError(null);
    try {
      const existing = groups.flatMap((g) => g.questions);
      const { questions } = await requestMoreQuestions(input, run.brief, existing);
      updateAiRun(eventId, (r) => ({ ...r, extraQuestions: [...(r.extraQuestions ?? []), ...questions] }));
      setFresh(questions.map((q) => q.question));
      track('questions_generated', { event_id: eventId, count: questions.length });
      showToast(`Added ${questions.length} new questions`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate questions.');
    } finally {
      setBusy(false);
    }
  };

  let n = 0;
  return (
    <>
      <div className="q-toolbar no-print">
        <button type="button" className={savedOnly ? 'chip' : 'chip outline'} aria-pressed={savedOnly} onClick={() => setSavedOnly((v) => !v)}>
          <BookmarkCheck size={14} aria-hidden /> Saved only ({saved.length})
        </button>
        <button type="button" className="btn secondary small" onClick={() => void more()} disabled={busy}>
          {busy ? <Loader2 size={15} className="spin" aria-hidden /> : <Sparkles size={15} aria-hidden />} {busy ? 'Generating…' : 'Generate more questions'}
        </button>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {savedOnly && saved.length === 0 && <p className="muted small">No saved questions yet. Use the bookmark on a question to save it.</p>}
      {groups.map((g) => {
        const list = g.questions.filter((q) => !savedOnly || saved.includes(q));
        if (list.length === 0) return null;
        return (
          <div key={g.theme} className="ai-theme">
            <h3>{g.theme}</h3>
            {!savedOnly && renderContext?.(g.theme)}
            <ul className="q-list">
              {list.map((q) => {
                n += 1;
                const isSaved = saved.includes(q);
                return (
                  <li key={q} className={fresh.includes(q) ? 'q-item new' : 'q-item'}>
                    <span className="q-num" aria-hidden>
                      {n}.
                    </span>
                    <div className="q-text">
                      <Flagged text={q} />
                    </div>
                    <div className="q-actions no-print">
                      <button type="button" className="icon-btn" aria-pressed={isSaved} aria-label={isSaved ? `Unsave question: ${q}` : `Save question: ${q}`} title={isSaved ? 'Saved' : 'Save'} onClick={() => toggle(q)}>
                        {isSaved ? <BookmarkCheck size={18} aria-hidden /> : <Bookmark size={18} aria-hidden />}
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Copy question: ${q}`}
                        title="Copy"
                        onClick={async () => showToast((await copyText(q)) ? 'Question copied' : 'Could not copy. Select the text instead.')}
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
      })}
      {toast}
    </>
  );
}
