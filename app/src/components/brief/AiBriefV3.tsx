// Brief written by the research agent (version 3): event + your angle, people (light), companies (the focus),
// latest results, company and industry news with "why it matters today", questions with context, sources.
// Source numbers like "[3]" in the text become small clickable links to the web source (clicks are not tracked).
import { AlertTriangle, Building2, ExternalLink, Sparkles, UserRound } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { formatUsd } from '../../services/aiBrief';
import type { AiBriefRun, AiBriefV3, UserEvent, WebSources } from '../../types';
import { AiQuestions, stripActive } from './AiBriefDocument';

const LABELS = {
  en: {
    draft: 'AI-generated draft',
    withWeb: 'Researched with Google Search: numbers next to facts link to their sources.',
    event: 'Event',
    when: 'Date and time',
    where: 'Place',
    format: 'Format',
    topic: 'Topic',
    tbc: 'To be confirmed',
    angle: 'Your angle',
    big: 'Big picture',
    bigCompany: "What's happening at the company",
    bigIndustry: 'Industry shifts',
    bigCompetition: 'Competition',
    bigChallenges: 'Challenges and open questions',
    piece: 'Piece',
    people: 'People',
    path: 'Career path',
    years: 'Years',
    company: 'Company',
    role: 'Role',
    education: 'Education',
    why: 'Why they matter to you',
    companies: 'Company overview',
    business: 'Business',
    what: 'What it does',
    keyFact: 'Key figure',
    model: 'The logic of the business',
    bottomLine: (area: string) => `Bottom line on ${area}`,
    watch: 'Watch out',
    results: 'Latest financial results',
    metric: 'Metric',
    result: 'Result',
    vs: 'vs. a year before',
    companyNews: 'Company news',
    industryNews: 'Industry news',
    date: 'Date',
    news: 'News',
    matters: 'Why it matters today',
    questions: 'Suggested questions',
    questionsNote: 'In conversation order, each theme with the context you need. Questions are in English so you can ask them as written.',
    context: 'Context',
    sources: 'Sources & what to verify',
    verify: 'What to verify before the event',
    webSources: 'Web sources (Google Search)',
  },
  es: {
    draft: 'Borrador generado con IA',
    withWeb: 'Investigado con Google Search: los números junto a cada dato llevan a su fuente.',
    event: 'Evento',
    when: 'Fecha y hora',
    where: 'Lugar',
    format: 'Formato',
    topic: 'Tema',
    tbc: 'Por confirmar',
    angle: 'Tu ángulo',
    big: 'Big picture',
    bigCompany: 'Qué está pasando en la empresa',
    bigIndustry: 'Cambios en la industria',
    bigCompetition: 'Competencia',
    bigChallenges: 'Desafíos y preguntas abiertas',
    piece: 'Pieza',
    people: 'Personas',
    path: 'Trayectoria',
    years: 'Años',
    company: 'Empresa',
    role: 'Rol',
    education: 'Formación',
    why: 'Por qué te sirve',
    companies: 'Overview de la empresa',
    business: 'Negocio',
    what: 'Qué hace',
    keyFact: 'Dato clave',
    model: 'La lógica del negocio',
    bottomLine: (area: string) => `En resumen: ${area}`,
    watch: 'Ojo',
    results: 'Último reporte financiero',
    metric: 'Métrica',
    result: 'Resultado',
    vs: 'vs. un año antes',
    companyNews: 'Noticias de la empresa',
    industryNews: 'Noticias de la industria',
    date: 'Fecha',
    news: 'Noticia',
    matters: 'Por qué importa hoy',
    questions: 'Preguntas sugeridas',
    questionsNote: 'Ordenadas como una conversación; cada tema trae el contexto que necesitas. Las preguntas están en inglés para usarlas tal cual.',
    context: 'Contexto',
    sources: 'Fuentes y qué verificar',
    verify: 'Qué verificar antes del evento',
    webSources: 'Fuentes web (Google Search)',
  },
};

/** Text with clickable source numbers: "Revenue grew 12% [3][5]" → text + links 3 and 5. */
export function Cited({ text, web }: { text: string; web?: WebSources }) {
  const parts = text.split(/(\[\d{1,2}\])/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^\[(\d{1,2})\]$/);
        if (!m) return <Fragment key={i}>{p}</Fragment>;
        const k = Number(m[1]) - 1;
        const src = web?.sources[k];
        if (!src) return null;
        return (
          <a key={i} className="cite ph-no-capture" href={src.uri} target="_blank" rel="noopener noreferrer" title={src.title || 'Source'} aria-label={`Source ${k + 1}: ${src.title || 'web page'}`}>
            {k + 1}
          </a>
        );
      })}
    </>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  const id = `ai3-s-${n}`;
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

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="table-wrap brief-table">
      <table className="data">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AiBriefV3Document({ run, brief: b, event }: { run: AiBriefRun; brief: AiBriefV3; event: UserEvent }) {
  const L = LABELS[b.language === 'es' ? 'es' : 'en'];
  const web = b.web;
  const C = ({ t }: { t: string }) => <Cited text={t} web={web} />;
  let n = 0;
  const next = () => (n += 1);
  const contexts = new Map(b.questionThemes.map((t) => [t.theme.toLowerCase(), t.context]));
  const fin = b.financials;

  return (
    <article className="card doc ai-brief brief-v3" aria-label="AI-generated brief">
      <div className="ai-brief-head">
        <span className="ai-draft-badge">
          <Sparkles size={14} aria-hidden /> {L.draft}
        </span>
        <span className="muted small">{web ? L.withWeb : b.webSearchNote}</span>
      </div>

      <Section n={next()} title={L.event}>
        <div className="summary-box">
          <p style={{ margin: 0 }}>
            <C t={b.headline} />
          </p>
        </div>
        <dl className="event-facts">
          <dt>{L.event}</dt>
          <dd>{b.event.title || event.title}</dd>
          <dt>{L.when}</dt>
          <dd>{b.event.when || L.tbc}</dd>
          <dt>{L.where}</dt>
          <dd>{b.event.where || L.tbc}</dd>
          {b.event.format && (
            <>
              <dt>{L.format}</dt>
              <dd>{b.event.format}</dd>
            </>
          )}
          {b.event.topic && (
            <>
              <dt>{L.topic}</dt>
              <dd>
                <C t={b.event.topic} />
              </dd>
            </>
          )}
        </dl>
        {b.angle && (
          <div className="angle-box">
            <strong>{L.angle}:</strong> <C t={b.angle} />
            {b.angleBullets.length > 0 && (
              <ul className="clean" style={{ marginTop: 6 }}>
                {b.angleBullets.map((x, i) => (
                  <li key={i}>
                    <C t={x} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Section>

      {b.bigPicture && (b.bigPicture.company.length + b.bigPicture.industry.length + b.bigPicture.competition.length + b.bigPicture.challenges.length > 0) && (
        <Section n={next()} title={L.big}>
          <div className="big-picture">
            {[
              { title: L.bigCompany, items: b.bigPicture.company },
              { title: L.bigIndustry, items: b.bigPicture.industry },
              { title: L.bigCompetition, items: b.bigPicture.competition },
              { title: L.bigChallenges, items: b.bigPicture.challenges },
            ]
              .filter((g) => g.items.length > 0)
              .map((g) => (
                <div key={g.title} className="big-block">
                  <h3>{g.title}</h3>
                  <ul className="clean">
                    {g.items.map((x, i) => (
                      <li key={i}>
                        <C t={x} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        </Section>
      )}

      {(b.people.length > 0 || b.peopleNote) && (
        <Section n={next()} title={L.people}>
          {b.people.length === 0 && <p className="muted">{b.peopleNote}</p>}
          {b.people.map((p, i) => (
            <div className="person-v3" key={i}>
              <h3>
                <UserRound size={17} aria-hidden /> {p.name}
                {p.affiliation && <span className="chip small">{p.affiliation}</span>}
              </h3>
              <p className="person-role">
                <C t={p.roleNow} />
              </p>
              {p.summary && (
                <p>
                  <C t={p.summary} />
                </p>
              )}
              {p.timeline.length > 0 && (
                <>
                  <p className="small muted" style={{ margin: '8px 0 4px' }}>
                    {L.path}
                  </p>
                  <Table head={[L.years, L.company, L.role]} rows={p.timeline.map((t) => [t.years, <C key="c" t={t.company} />, <C key="r" t={t.role} />])} />
                </>
              )}
              {p.education && (
                <p className="small">
                  <span className="muted">{L.education}: </span>
                  <C t={p.education} />
                </p>
              )}
              {p.highlights.length > 0 && (
                <ul className="clean">
                  {p.highlights.map((h, j) => (
                    <li key={j}>
                      <C t={h} />
                    </li>
                  ))}
                </ul>
              )}
              {p.whyItMatters && (
                <p>
                  <strong>{L.why}:</strong> <C t={p.whyItMatters} />
                </p>
              )}
              {p.caveat && (
                <p className="caveat small">
                  <AlertTriangle size={14} aria-hidden /> <C t={p.caveat} />
                </p>
              )}
            </div>
          ))}
          {b.people.length > 0 && b.peopleNote && <p className="muted small">{b.peopleNote}</p>}
        </Section>
      )}

      {b.companies.length > 0 && (
        <Section n={next()} title={L.companies}>
          {b.companies.map((c, i) => (
            <div className="company-v3" key={i}>
              <h3>
                <Building2 size={17} aria-hidden /> {c.name}
              </h3>
              <p>
                <C t={c.summary} />
              </p>
              {c.modelInsight && (
                <p className="conclusion">
                  <strong>{L.model}:</strong> <C t={c.modelInsight} />
                </p>
              )}
              {c.businessLines.length > 0 && <Table head={[L.business, L.what, L.keyFact]} rows={c.businessLines.map((x) => [<strong key="n">{x.name}</strong>, <C key="w" t={x.what} />, <C key="k" t={x.keyFact} />])} />}
              {c.focus && (
                <div className="focus-area">
                  <h3>{c.focus.area}</h3>
                  {c.focus.summary && (
                    <p>
                      <C t={c.focus.summary} />
                    </p>
                  )}
                  {c.focus.pieces.length > 0 && <Table head={[L.piece, L.what, L.keyFact]} rows={c.focus.pieces.map((x) => [<strong key="n">{x.name}</strong>, <C key="w" t={x.what} />, <C key="k" t={x.keyFact} />])} />}
                  {c.focus.logic && (
                    <p className="conclusion">
                      <strong>{L.bottomLine(c.focus.area)}:</strong> <C t={c.focus.logic} />
                    </p>
                  )}
                </div>
              )}
              {c.watchOut && (
                <p className="caveat small">
                  <AlertTriangle size={14} aria-hidden /> <strong>{L.watch}:</strong> <C t={c.watchOut} />
                </p>
              )}
            </div>
          ))}
        </Section>
      )}

      {(fin.metrics.length > 0 || fin.takeaway || fin.highlights.length > 0) && (
      <Section n={next()} title={`${L.results}${fin.period ? `: ${fin.period}` : ''}`}>
        {fin.takeaway && (
          <p>
            <C t={fin.takeaway} />
          </p>
        )}
        {fin.metrics.length > 0 && <Table head={[L.metric, `${L.result}${fin.period ? ` (${fin.period})` : ''}`, L.vs]} rows={fin.metrics.map((m) => [m.metric, <C key="v" t={m.value} />, <C key="c" t={m.change} />])} />}
        {fin.highlights.length > 0 && (
          <ul className="clean" style={{ marginTop: 10 }}>
            {fin.highlights.map((h, i) => (
              <li key={i}>
                <C t={h} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      )}

      {[
        { title: L.companyNews, block: b.companyNews },
        { title: L.industryNews, block: b.industryNews },
      ].map(
        ({ title, block }) =>
          block.items.length > 0 && (
            <Section key={title} n={next()} title={title}>
              {block.lead && (
                <p>
                  <C t={block.lead} />
                </p>
              )}
              <Table head={[L.date, L.news, L.matters]} rows={block.items.map((x) => [<span key="d" className="nowrap">{x.date}</span>, <C key="h" t={x.headline} />, <C key="w" t={x.whyItMatters} />])} />
            </Section>
          ),
      )}

      <Section n={next()} title={L.questions}>
        <p className="muted small">{L.questionsNote}</p>
        <AiQuestions
          run={run}
          eventId={event.id}
          renderContext={(theme) => {
            const ctx = contexts.get(theme.toLowerCase());
            return ctx ? (
              <p className="q-context small">
                <strong>{L.context}:</strong> <C t={ctx} />
              </p>
            ) : null;
          }}
        />
      </Section>

      <Section n={next()} title={L.sources}>
        {b.verify.length > 0 && (
          <>
            <h3 style={{ margin: '0 0 6px' }}>{L.verify}</h3>
            <ul className="verify-list">
              {b.verify.map((v, i) => (
                <li key={i}>
                  <AlertTriangle size={15} aria-hidden /> <C t={v} />
                </li>
              ))}
            </ul>
          </>
        )}
        {web && (
          // Google's terms: show the sources and Search Suggestions with grounded results; clicks here are not tracked.
          <div className="ph-no-capture">
            <h3 style={{ margin: '14px 0 6px' }}>{L.webSources}</h3>
            <ol className="research-sources">
              {web.sources.map((s) => (
                <li key={s.uri}>
                  <a href={s.uri} target="_blank" rel="noopener noreferrer">
                    {s.title || 'Source'} <ExternalLink size={12} aria-hidden />
                  </a>
                </li>
              ))}
            </ol>
            {web.suggestionsHtml && <div className="search-suggestions no-print" dangerouslySetInnerHTML={{ __html: stripActive(web.suggestionsHtml) }} />}
          </div>
        )}
      </Section>

      <footer className="ai-usage muted small" aria-label="Usage and cost for this run">
        Model {run.model} · {run.usage.inputTokens.toLocaleString('en-US')} input + {run.usage.outputTokens.toLocaleString('en-US')} output tokens
        {run.usage.searches ? ` · ${run.usage.searches} web searches` : ''} · Cost {formatUsd(run.costUsd)} (estimate at paid rates) · Generated {new Date(run.generatedAt).toLocaleString('en-US')}
      </footer>
    </article>
  );
}
