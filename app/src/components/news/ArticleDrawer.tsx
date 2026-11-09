import { Bookmark, BookmarkCheck, ExternalLink, Info } from 'lucide-react';
import { formatShortDate } from '../../lib/time';
import { useStore } from '../../state/store';
import type { Article } from '../../types';
import { Dialog } from '../Dialog';

export function ArticleDrawer({ article, onClose }: { article: Article; onClose: () => void }) {
  const { state, toggleSaveArticle } = useStore();
  const saved = state.savedArticleIds.includes(article.id);
  return (
    <Dialog variant="drawer" title={article.title} onClose={onClose}>
      <div className="chip-row" style={{ marginBottom: 12 }}>
        <span className="chip">{article.industry}</span>
        {article.tags.map((t) => (
          <span className="chip outline" key={t}>
            {t}
          </span>
        ))}
      </div>
      <p className="muted small">
        {article.sourceLabel} · {formatShortDate(article.date)}
      </p>
      <h3 style={{ marginTop: 16 }}>Summary</h3>
      <p>{article.summary}</p>
      <h3 style={{ marginTop: 16 }}>Why it matters for your goals</h3>
      <p>{article.whyItMatters}</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
        <button type="button" className={saved ? 'btn secondary' : 'btn'} onClick={() => toggleSaveArticle(article.id)} aria-pressed={saved}>
          {saved ? <BookmarkCheck size={16} aria-hidden /> : <Bookmark size={16} aria-hidden />}
          {saved ? 'Saved · Unsave' : 'Save'}
        </button>
        {article.sourceUrl && (
          <a className="btn secondary" href={article.sourceUrl} target="_blank" rel="noopener noreferrer">
            Read full article <ExternalLink size={15} aria-hidden />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
      </div>
      {!article.sourceUrl && (
        <p className="notice info small" style={{ marginTop: 16 }}>
          <Info size={16} aria-hidden style={{ flex: 'none', marginTop: 2 }} />
          Illustrative article. Original source unavailable in this demo.
        </p>
      )}
    </Dialog>
  );
}
