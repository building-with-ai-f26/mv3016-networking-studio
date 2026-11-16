// Renders a REAL AI-generated brief with the same 8 sections (and look) as the sample briefs.
import { AlertTriangle, Building2, FileQuestion, Search, Sparkles, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { companiesFromAttendees } from '../../lib/classifier';
import { formatUsd } from '../../services/aiBrief';
import type { AiBriefRun, UserEvent } from '../../types';

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

export function AiBriefDocument({ run, event }: { run: AiBriefRun; event: UserEvent }) {
  const { brief } = run;
  const domainCompanies = event.google ? companiesFromAttendees(event) : [];
  let n = 0;
  return (
    <article className="card doc ai-brief" aria-label="AI-generated brief">
      <div className="ai-brief-head">
        <span className="ai-draft-badge">
          <Sparkles size={14} aria-hidden /> AI-generated draft
        </span>
        <span className="muted small">No web search: news and financials are not filled in. Check anything marked “Not verified” before the event.</span>
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
        <ToCheck intro="— no web search, so no figures are shown. Look up:" items={brief.financialsToCheck} />
      </Section>

      <Section n={5} title="Company news (last 3 months)">
        <ToCheck intro="— no web search, so no news is shown. Look up:" items={brief.companyNewsToCheck} />
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
        {brief.questionThemes.map((t, i) => (
          <div key={i} className="ai-theme">
            <h3>{t.theme}</h3>
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

      <Section n={8} title="Sources & what to verify">
        <ul className="clean small">
          <li>{event.source === 'google' ? 'Your Google Calendar event: title, time, location and description (emails, links and numbers removed).' : 'The event details you typed.'}</li>
          {domainCompanies.length > 0 && <li>Company guessed from attendee email domains: {domainCompanies.join(', ')}.</li>}
          <li>The model’s general knowledge (not checked against the web).</li>
        </ul>
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
