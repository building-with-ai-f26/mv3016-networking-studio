// Renders a REAL AI-generated brief (from app/server) for an event the user added.
import { AlertTriangle, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatUsd } from '../../services/aiBrief';
import type { AiBriefRun } from '../../types';

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
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function AiBriefDocument({ run }: { run: AiBriefRun }) {
  const { brief } = run;
  let n = 0;
  return (
    <article className="card ai-brief" aria-label="AI-generated brief">
      <div className="ai-brief-head">
        <span className="ai-draft-badge">
          <Sparkles size={14} aria-hidden /> AI-generated draft
        </span>
        <span className="muted small">No news or financial figures. Check anything marked “Not verified” before the event.</span>
      </div>

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
        Model {run.model} · {run.usage.inputTokens.toLocaleString('en-US')} input + {run.usage.outputTokens.toLocaleString('en-US')} output tokens · Cost per run{' '}
        {formatUsd(run.costUsd)} (at paid rates) · Generated {new Date(run.generatedAt).toLocaleString('en-US')}
      </footer>
    </article>
  );
}
