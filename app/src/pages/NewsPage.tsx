import { Bookmark, BookmarkCheck, PanelRightOpen, Search } from 'lucide-react';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArticleDrawer } from '../components/news/ArticleDrawer';
import { LabView } from '../components/news/LabView';
import { useToast } from '../components/Toast';
import { SEED_ARTICLES } from '../data/seed';
import { groupByIndustry } from '../lib/labLayout';
import { slug } from '../lib/slug';
import { formatShortDate } from '../lib/time';
import { useStore } from '../state/store';
import type { Article } from '../types';

type Tab = 'new' | 'saved' | 'lab';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'new', label: 'New' },
  { id: 'saved', label: 'Saved' },
  { id: 'lab', label: 'Lab' },
];

function ArticleCard({ article, onOpen, onToggle, saved }: { article: Article; onOpen: () => void; onToggle: () => void; saved: boolean }) {
  return (
    <article className="card article-card" data-testid="article-card">
      <div className="article-top">
        <span className="chip">{article.industry}</span>
        {article.illustrative && <span className="illustrative-tag">Example</span>}
      </div>
      <h3>{article.title}</h3>
      <p className="muted small" style={{ margin: 0 }}>
        {article.sourceLabel} · {formatShortDate(article.date)}
      </p>
      <div className="chip-row">
        {article.tags.map((t) => (
          <span key={t} className="chip outline small">
            {t}
          </span>
        ))}
      </div>
      <p className="small" style={{ margin: 0 }}>
        {article.summary}
      </p>
      <div className="why">
        <strong>Why it matters for your goals:</strong> {article.whyItMatters}
      </div>
      <div className="actions">
        <button type="button" className={saved ? 'btn secondary small' : 'btn small'} aria-pressed={saved} onClick={onToggle} aria-label={`${saved ? 'Unsave' : 'Save'}: ${article.title}`}>
          {saved ? <BookmarkCheck size={15} aria-hidden /> : <Bookmark size={15} aria-hidden />}
          {saved ? 'Saved' : 'Save'}
        </button>
        <button type="button" className="btn ghost small" onClick={onOpen} aria-label={`Open summary: ${article.title}`}>
          <PanelRightOpen size={15} aria-hidden /> Open summary
        </button>
      </div>
    </article>
  );
}

export function NewsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = raw === 'saved' || raw === 'lab' ? raw : 'new';
  const { state, toggleSaveArticle } = useStore();
  const [industry, setIndustry] = useState<string>('mine');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Article | null>(null);
  const [toast, showToast] = useToast();
  const uid = useId();
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ new: null, saved: null, lab: null });

  const setTab = (t: Tab) => setParams(t === 'new' ? {} : { tab: t }, { replace: false });
  const onTabKey = (e: KeyboardEvent, i: number) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = TABS[(i + dir + TABS.length) % TABS.length].id;
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  const myIndustries = state.profile.industries;
  const savedSet = useMemo(() => new Set(state.savedArticleIds), [state.savedArticleIds]);
  const industriesWithArticles = useMemo(() => Array.from(new Set(SEED_ARTICLES.map((a) => a.industry))), []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return SEED_ARTICLES.filter((a) => {
      if (tab === 'saved' && !savedSet.has(a.id)) return false;
      if (industry === 'mine' && myIndustries.length > 0 && !myIndustries.includes(a.industry)) return false;
      if (industry !== 'mine' && industry !== 'all' && a.industry !== industry) return false;
      if (q && ![a.title, a.summary, a.whyItMatters, a.industry, ...a.tags].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tab, savedSet, industry, myIndustries, search]);
  const groups = groupByIndustry(visible, myIndustries);

  const toggle = (a: Article) => {
    const wasSaved = savedSet.has(a.id);
    toggleSaveArticle(a.id);
    showToast(wasSaved ? 'Removed from Saved and Lab' : 'Saved — added to your Lab');
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Industry News</h1>
          <p className="subtitle">Save ideas worth bringing to your next conversation.</p>
        </div>
      </div>
      <div className="notice info small">
        All articles here are illustrative examples with no original source. In the live product, this tab will show real, linked news for your industries.
      </div>

      <div className="tabs" role="tablist" aria-label="Industry News views">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => (tabRefs.current[t.id] = el)}
            id={`${uid}-tab-${t.id}`}
            role="tab"
            type="button"
            className="tab"
            aria-selected={tab === t.id}
            aria-controls={`${uid}-panel`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t.label}
            {t.id !== 'new' && <span className="count">{state.savedArticleIds.length}</span>}
          </button>
        ))}
      </div>

      <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${tab}`}>
        {tab === 'lab' ? (
          <div style={{ marginTop: 16 }}>
            <LabView onOpen={setOpen} onExplore={() => setTab('new')} />
          </div>
        ) : (
          <>
            <div className="news-toolbar">
              <div className="search">
                <Search size={17} aria-hidden />
                <label htmlFor={`${uid}-search`} className="sr-only">
                  Search articles
                </label>
                <input id={`${uid}-search`} type="search" className="input" placeholder="Search articles…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <label htmlFor={`${uid}-industry`} className="sr-only">
                Filter by industry
              </label>
              <select id={`${uid}-industry`} className="select" style={{ width: 'auto', minWidth: 200 }} value={industry} onChange={(e) => setIndustry(e.target.value)}>
                <option value="mine">My industries</option>
                <option value="all">All industries</option>
                {industriesWithArticles.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </div>
            {groups.length === 0 ? (
              <div className="card empty-state" style={{ display: 'block', textAlign: 'center' }}>
                {tab === 'saved' && state.savedArticleIds.length === 0 ? (
                  <>
                    <p>
                      <strong>Nothing saved yet.</strong> Save articles from the New tab to collect ideas for conversations.
                    </p>
                    <button type="button" className="btn" onClick={() => setTab('new')}>
                      Explore news
                    </button>
                  </>
                ) : (
                  <p style={{ margin: 0 }}>
                    <strong>No articles match.</strong> Try “All industries” or a different search.
                  </p>
                )}
              </div>
            ) : (
              groups.map((g) => {
                const prio = myIndustries.indexOf(g.industry);
                return (
                  <section className="industry-group" key={g.industry} aria-labelledby={`${uid}-g-${slug(g.industry)}`}>
                    <h2 id={`${uid}-g-${slug(g.industry)}`}>
                      {prio >= 0 && (
                        <span className="priority-num" aria-label={`Priority ${prio + 1}`}>
                          #{prio + 1}
                        </span>
                      )}
                      {g.industry}
                    </h2>
                    <div className="article-grid">
                      {g.articles.map((a) => (
                        <ArticleCard key={a.id} article={a} saved={savedSet.has(a.id)} onToggle={() => toggle(a)} onOpen={() => setOpen(a)} />
                      ))}
                    </div>
                  </section>
                );
              })
            )}
            <p className="muted small">
              Industry order follows your priorities in <Link to="/settings">Settings</Link>.
            </p>
          </>
        )}
      </div>

      {open && <ArticleDrawer article={open} onClose={() => setOpen(null)} />}
      {toast}
    </div>
  );
}
