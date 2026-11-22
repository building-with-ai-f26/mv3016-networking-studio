// "Latest public info": live web search (Gemini + Google Search) for the company and person of this event.
// Runs only when the student clicks (each search has a small cost). Following Google's grounding terms, the answer
// is shown exactly as returned, next to its sources and Google's Search Suggestions; clicks inside this section are
// not tracked (ph-no-capture), and the result is never fed into the brief or the chat.
import { ExternalLink, Globe, Loader2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { track } from '../../lib/analytics';
import { formatUsd, requestResearch } from '../../services/aiBrief';
import { useStore } from '../../state/store';
import type { AiBriefRun } from '../../types';

/** Second line of defense (the server sanitizes too, and the CSP blocks inline scripts): nothing executable is rendered. */
export function stripActive(html: string): string {
  return html
    .replace(/<\s*(script|iframe|object|embed|form|link|meta|base)\b[\s\S]*?(<\s*\/\s*\1\s*>|\/?>)/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
}

export function ResearchPanel({ run, eventId }: { run: AiBriefRun; eventId: string }) {
  const { updateAiRun, aiInputOf } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = run.research;
  const input = aiInputOf(eventId) ?? run.event;
  const canSearch = Boolean(input.company || input.person);

  const search = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await requestResearch(input);
      updateAiRun(eventId, (x) => ({ ...x, research: out }));
      track('web_research_run', { event_id: eventId, searches: out.queries.length, sources: out.sources.length });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The web search failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card research ph-no-capture" aria-labelledby={`research-${eventId}`}>
      <div className="chat-head">
        <h2 id={`research-${eventId}`}>Latest public info</h2>
        <span className="chip small">
          <Globe size={14} aria-hidden /> Live web search · Google Search
        </span>
      </div>
      {!r && !busy && (
        <p className="muted small">
          Search the web for recent news, financials and public professional info about {[input.person, input.company].filter(Boolean).join(' and ') || 'this event'}. Only the company, the person&apos;s name and role and the topic are searched.
        </p>
      )}
      {busy && (
        <p className="muted small" role="status">
          <Loader2 size={14} className="spin" aria-hidden /> Searching the web…
        </p>
      )}
      {r && (
        <>
          <div className="research-text">{r.text}</div>
          {r.sources.length > 0 && (
            <>
              <h3 className="small research-h">Sources</h3>
              <ol className="research-sources">
                {r.sources.map((s) => (
                  <li key={s.uri}>
                    <a href={s.uri} target="_blank" rel="noopener noreferrer">
                      {s.title || 'Source'} <ExternalLink size={12} aria-hidden />
                    </a>
                  </li>
                ))}
              </ol>
            </>
          )}
          {/* Google's Search Suggestions, required next to grounded results (HTML from Google, sanitized on the server). */}
          {r.suggestionsHtml && <div className="search-suggestions" dangerouslySetInnerHTML={{ __html: stripActive(r.suggestionsHtml) }} />}
          <p className="muted small research-meta">
            Results from Google Search, shown as returned · {new Date(r.searchedAt).toLocaleString()} · {r.queries.length} search{r.queries.length === 1 ? '' : 'es'} · {formatUsd(r.costUsd)} (first 5,000 searches each month are free). Verify before the event.
          </p>
        </>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className={r ? 'btn secondary small' : 'btn small'} onClick={() => void search()} disabled={busy || !canSearch}>
        {r ? <RefreshCw size={15} aria-hidden /> : <Globe size={15} aria-hidden />} {r ? 'Search again' : 'Search the web'}
      </button>
      {!canSearch && <p className="muted small">Add the company or the person (Edit details) to search.</p>}
    </section>
  );
}
