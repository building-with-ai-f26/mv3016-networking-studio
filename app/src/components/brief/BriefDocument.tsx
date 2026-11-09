import { Building2, ChevronRight, ExternalLink, FileQuestion, Info, Plus, UserRound, X } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import type { Brief, BriefNewsItem, NetworkingEvent } from '../../types';
import { useStore } from '../../state/store';

function Section({ n, title, children, id }: { n: number; title: string; children: ReactNode; id: string }) {
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

export function IllustrativeTag({ text = 'Illustrative demo content' }: { text?: string }) {
  return (
    <span className="illustrative-tag">
      <Info size={12} aria-hidden /> {text}
    </span>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="empty-state">
      <FileQuestion size={22} aria-hidden />
      <div>{children}</div>
    </div>
  );
}

function NewsList({ items, showWhy }: { items: BriefNewsItem[]; showWhy?: boolean }) {
  return (
    <div className="news-list">
      {items.map((n) => (
        <article className="news-item" key={n.id}>
          <h3>{n.title}</h3>
          <p className="small" style={{ margin: 0 }}>
            {n.summary}
          </p>
          {showWhy && n.whyItMatters && (
            <p className="why" style={{ margin: '6px 0 0' }}>
              <strong>Why it matters:</strong> {n.whyItMatters}
            </p>
          )}
          <p className="muted small" style={{ margin: '6px 0 0' }}>
            Sample article — no original source
          </p>
        </article>
      ))}
    </div>
  );
}

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children} <ExternalLink size={13} aria-hidden />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function PriorityCompanies({ eventId, seed }: { eventId: string; seed: string[] }) {
  const { state, setPriorityCompanies } = useStore();
  const list = state.priorityCompanies[eventId] ?? seed;
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const add = (e: FormEvent) => {
    e.preventDefault();
    const v = draft.trim();
    if (!v) return;
    if (list.some((x) => x.toLowerCase() === v.toLowerCase())) {
      setError(`“${v}” is already on your list.`);
      return;
    }
    setPriorityCompanies(eventId, [...list, v]);
    setDraft('');
    setError('');
  };
  return (
    <div style={{ marginTop: 12 }}>
      <h3 style={{ marginBottom: 8 }}>Your priority list (editable)</h3>
      {list.length === 0 ? (
        <p className="muted small">Your list is empty. Add a company or team you want to meet.</p>
      ) : (
        <ol className="chip-row" style={{ listStyle: 'none', padding: 0, margin: '0 0 10px' }}>
          {list.map((c, i) => (
            <li key={c} className="chip">
              <span className="priority-num">{i + 1}</span> {c}
              <button type="button" className="chip-remove" aria-label={`Remove ${c}`} onClick={() => setPriorityCompanies(eventId, list.filter((x) => x !== c))}>
                <X size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ol>
      )}
      <form onSubmit={add} className="composer" style={{ maxWidth: 440 }}>
        <label htmlFor={`prio-${eventId}`} className="sr-only">
          Add a company to prioritize
        </label>
        <input
          id={`prio-${eventId}`}
          className="input"
          placeholder="Add a company or team"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError('');
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `prio-err-${eventId}` : undefined}
        />
        <button type="submit" className="btn secondary">
          <Plus size={16} aria-hidden /> Add
        </button>
      </form>
      {error && (
        <p className="field-error" id={`prio-err-${eventId}`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface Props {
  event: NetworkingEvent;
  brief: Brief;
  selectedSpeakers: string[];
  onToggleSpeaker: (id: string) => void;
  questions: ReactNode;
}

export function BriefDocument({ event, brief, selectedSpeakers, onToggleSpeaker, questions }: Props) {
  const multiSpeaker = brief.people.length > 1;
  return (
    <article className="card doc" aria-label="Preparation brief">
      <Section n={1} id="s-essentials" title="Event essentials & what to prepare">
        <div className="summary-box">
          <span className="label-tag">Preparation summary</span>
          <p style={{ margin: '4px 0 0' }}>{brief.summary}</p>
        </div>
        <h3 style={{ margin: '14px 0 6px' }}>Prepare for</h3>
        <ul className="clean">
          {brief.prepareFor.slice(0, 3).map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        {brief.prepareFor.length > 3 && (
          <details className="more">
            <summary>
              <ChevronRight size={16} className="chev" aria-hidden /> Show full checklist ({brief.prepareFor.length - 3} more)
            </summary>
            <ul className="clean" style={{ marginTop: 6 }}>
              {brief.prepareFor.slice(3).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </details>
        )}
        {event.locationNote && (
          <p className="muted small" style={{ marginTop: 10 }}>
            <Info size={13} aria-hidden /> Location note: {event.locationNote}
          </p>
        )}
      </Section>

      <Section n={2} id="s-people" title="People & roles">
        {brief.people.length > 0 && (
          <>
            {multiSpeaker && (
              <div style={{ marginBottom: 12 }}>
                <p className="small muted" style={{ marginBottom: 6 }} id="speaker-chips-label">
                  Select speakers to focus on — company cards and questions follow your selection.
                </p>
                <div className="chip-row" role="group" aria-labelledby="speaker-chips-label">
                  {brief.people.map((p) => (
                    <button key={p.id} type="button" className="chip" aria-pressed={selectedSpeakers.includes(p.id)} onClick={() => onToggleSpeaker(p.id)}>
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="people-grid">
              {brief.people.map((p) => (
                <div className="person-card" key={p.id}>
                  <div className="person-cell">
                    <span className="initials" aria-hidden>
                      {p.name
                        .split(/\s+/)
                        .map((x) => x[0])
                        .join('')
                        .slice(0, 2)}
                    </span>
                    <span className="name">{p.name}</span>
                  </div>
                  <div className="small" style={{ marginTop: 8 }}>
                    <div>
                      <span className="muted">Role: </span>
                      {p.role ?? <span className="unknown">Not available in this demo</span>}
                    </div>
                    <div>
                      <span className="muted">Company: </span>
                      {p.company ?? <span className="unknown">Not available in this demo</span>}
                    </div>
                  </div>
                  <span className="prov">
                    <UserRound size={12} aria-hidden /> {p.provenance === 'event-description' ? 'From event description' : 'Name from calendar title'}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
        {brief.peopleNote && (
          <div className="empty-state" style={{ marginTop: brief.people.length ? 12 : 0 }}>
            <Info size={20} aria-hidden />
            <div>{brief.peopleNote}</div>
          </div>
        )}
        {brief.conversationStarters && (
          <>
            <h3 style={{ margin: '16px 0 6px' }}>Conversation starters</h3>
            <ul className="clean">
              {brief.conversationStarters.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section n={3} id="s-company" title={brief.companiesHeading}>
        {brief.companiesNote && <p>{brief.companiesNote}</p>}
        {brief.priorityCompaniesSeed && <PriorityCompanies eventId={event.id} seed={brief.priorityCompaniesSeed} />}
        {brief.companies.length > 0 && (
          <>
            <p className="muted small">General background for preparation — verify details before the event.</p>
            <div className="company-grid">
              {brief.companies.map((c) => {
                const highlight = selectedSpeakers.length > 0 && (c.personIds ?? []).some((id) => selectedSpeakers.includes(id));
                return (
                  <div className={highlight ? 'company-card highlight' : 'company-card'} key={c.id}>
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Building2 size={16} aria-hidden /> {c.name}
                      {highlight && <span className="chip mint small">Selected speaker</span>}
                    </h3>
                    <p className="small" style={{ margin: '6px 0' }}>
                      {c.overview}
                    </p>
                    <details className="more">
                      <summary>
                        <ChevronRight size={16} className="chev" aria-hidden /> Business model & products
                      </summary>
                      <p className="small" style={{ margin: '6px 0' }}>
                        <strong>Business model:</strong> {c.businessModel}
                      </p>
                      <ul className="clean small">
                        {c.products.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    </details>
                    {c.homepage && (
                      <p className="small" style={{ margin: '6px 0 0' }}>
                        <ExtLink href={c.homepage.url}>{c.homepage.label}</ExtLink>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Section>

      <Section n={4} id="s-financials" title="Latest financial-report highlights">
        <EmptyState>
          <strong>{brief.financials.kind === 'not-applicable' ? 'Not applicable for this event' : 'Not available in this demo'}</strong>
          <br />
          {brief.financials.reason}
        </EmptyState>
      </Section>

      <Section n={5} id="s-company-news" title="Company news (last 3 months)">
        {brief.companyNews.length === 0 ? (
          <EmptyState>{brief.companyNewsNote}</EmptyState>
        ) : (
          <>
            <p style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <IllustrativeTag /> <span className="muted small">{brief.companyNewsNote}</span>
            </p>
            <NewsList items={brief.companyNews} />
          </>
        )}
      </Section>

      <Section n={6} id="s-industry-news" title="Industry news & why it matters">
        <p>
          <IllustrativeTag />
        </p>
        <NewsList items={brief.industryNews} showWhy />
      </Section>

      <Section n={7} id="s-questions" title="Suggested questions">
        {questions}
      </Section>

      <Section n={8} id="s-sources" title="Sources">
        {brief.sources.length === 0 ? (
          <EmptyState>No verified sources were supplied for this event. Details come from your calendar entry.</EmptyState>
        ) : (
          <ul className="sources-list">
            {brief.sources.map((s) => (
              <li key={s.id}>
                <span className="chip outline small">{s.kind === 'event-page' ? 'Event page' : 'Homepage'}</span>
                <ExtLink href={s.url}>{s.label}</ExtLink>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small" style={{ marginTop: 10 }}>
          News and financial examples in this demo are illustrative and have no original source. Homepage links point to the company’s site, not to evidence for any claim above.
        </p>
      </Section>
    </article>
  );
}
