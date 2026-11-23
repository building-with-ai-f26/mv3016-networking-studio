// Discover: in-person events in NYC that fit your profile, from the web, your newsletters/club emails and CampusGroups.
// Events stay until they happen; new ones are found on their own (web once a day, emails every few hours).
import { CalendarPlus, ExternalLink, Loader2, MapPin, Sparkles, ThumbsDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDiscoverRefresh } from '../components/DiscoverSync';
import { useToast } from '../components/Toast';
import { track } from '../lib/analytics';
import { byWeek, EMPTY_DISCOVER, findEventLink, verifiedLink, googleCalendarLink, isHighPriority, toUserEvent, TYPE_LABEL, visibleEvents } from '../lib/discover';
import { formatDayHeading, formatTime, nyDateKey } from '../lib/time';
import { useStore } from '../state/store';
import type { DiscoverEvent } from '../types';

const FILTERS: Array<{ id: string; label: string; test: (e: DiscoverEvent) => boolean }> = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'networking', label: 'Networking', test: (e) => e.type === 'networking' },
  { id: 'panel', label: 'Panels & talks', test: (e) => e.type === 'panel' || e.type === 'info_session' },
  { id: 'conference', label: 'Conferences', test: (e) => e.type === 'conference' || e.type === 'workshop' },
  { id: 'mine', label: 'From my emails & clubs', test: (e) => e.source !== 'web' },
  { id: 'high', label: 'High priority', test: () => true },
  { id: 'free', label: 'Free', test: (e) => e.free },
];

export function DiscoverPage() {
  const { state, updateDiscover, addUserEvent, googleEvents, google } = useStore();
  // No manual refresh: new events are found on their own (web once a day; emails and CampusGroups every 3 hours).
  const { running, error } = useDiscoverRefresh();
  const [filter, setFilter] = useState('all');
  const [toast, showToast] = useToast();
  const d = state.discover ?? EMPTY_DISCOVER;
  const calendar = useMemo(() => [...state.userEvents, ...googleEvents], [state.userEvents, googleEvents]);
  const list = useMemo(() => visibleEvents(d, state.profile, calendar).filter((e) => (filter === 'high' ? isHighPriority(e, state.profile) : FILTERS.find((f) => f.id === filter)!.test(e))), [d, state.profile, calendar, filter]);

  if (!google.signedIn) {
    return (
      <div className="page">
        <h1>Discover</h1>
        <p className="muted">Sign in to get events in NYC picked for your profile, from the web, your newsletters and CampusGroups.</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Discover</h1>
          <p className="subtitle">In-person events in NYC that fit your goals: from the web, your newsletters and clubs, and CampusGroups.</p>
        </div>
        {running && (
          <span className="muted small" role="status">
            <Loader2 size={15} className="spin" aria-hidden /> Looking for new events…
          </span>
        )}
      </div>
      <p className="muted small">
        {d.lastWebAt ? `Web checked ${new Date(d.lastWebAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Web not checked yet'} ·{' '}
        {google.gmailConnected ? (d.lastMailAt ? `emails checked ${new Date(d.lastMailAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}` : 'emails not checked yet') : <Link to="/settings">connect Gmail to include your newsletters</Link>} ·{' '}
        {d.icalUrl ? 'CampusGroups connected' : <Link to="/settings">add your CampusGroups calendar</Link>}
      </p>
      {google.gmailConnected && d.mailStats && (
        <p className="muted small" role="status">
          {d.mailStats.error
            ? `Last email check failed: ${d.mailStats.error} It will retry next time you open the app.`
            : `Emails: ${d.mailStats.newsletters} newsletters and club emails read (${d.mailStats.newEmails} new emails about events), ${d.mailStats.withEvents} with upcoming NYC events.`}
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <div className="chip-row" role="group" aria-label="Filter events">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={filter === f.id ? 'chip' : 'chip outline'} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="card empty-state" style={{ display: 'block', textAlign: 'center' }}>
          <p>{running ? 'Looking for events that fit you…' : 'No events here yet. New ones are found automatically: the web once a day, your emails every few hours.'}</p>
        </div>
      ) : (
        byWeek(list).map((week) => (
          <section key={week.label} className="discover-week" aria-labelledby={`wk-${week.label}`}>
            <h2 className="discover-week-title" id={`wk-${week.label}`}>
              {week.label} <span className="muted small">({week.events.length})</span>
            </h2>
            <div className="discover-list">
              {week.events.map((e) => {
                const day = formatDayHeading(nyDateKey(e.start));
                const high = isHighPriority(e, state.profile);
                return (
                  <article className={high ? 'card discover-card high' : 'card discover-card'} key={e.id}>
                    <div className="discover-date" aria-hidden>
                      <span>{day.weekday.slice(0, 3)}</span>
                      <strong>{day.date.replace(/^\w+ /, '')}</strong>
                      <span>{day.date.split(' ')[0]}</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="chip-row" style={{ marginBottom: 4 }}>
                        {high && <span className="chip small high-chip">High priority</span>}
                        <span className="chip small">{TYPE_LABEL[e.type]}</span>
                        {e.free ? <span className="chip small">Free</span> : e.price !== 'Not listed' && <span className="chip small peach">Paid</span>}
                        <span className="muted small">{e.sourceLabel}</span>
                      </div>
                      <h3 className="discover-title">{e.title}</h3>
                      <p className="muted small" style={{ margin: '2px 0 6px' }}>
                        {formatTime(e.start)}
                        {e.venue && (
                          <>
                            {' '}
                            · <MapPin size={13} aria-hidden /> {e.venue}
                          </>
                        )}
                        {e.organizer && ` · ${e.organizer}`}
                      </p>
                      {e.why && (
                        <p className="small" style={{ margin: '0 0 8px' }}>
                          <Sparkles size={13} aria-hidden /> <strong>Why it fits you:</strong> {e.why}
                        </p>
                      )}
                      <div className="discover-actions">
                        {verifiedLink(e) ? (
                          <a className="btn small" href={verifiedLink(e)} target="_blank" rel="noopener noreferrer" onClick={() => track('discover_register_clicked', { source: e.source })}>
                            Register <ExternalLink size={14} aria-hidden />
                          </a>
                        ) : (
                          <a className="btn small" href={findEventLink(e)} target="_blank" rel="noopener noreferrer" onClick={() => track('discover_register_clicked', { source: e.source, verified: false })}>
                            Find event <ExternalLink size={14} aria-hidden />
                          </a>
                        )}
                        <button
                          type="button"
                          className="btn secondary small"
                          onClick={() => {
                            addUserEvent(toUserEvent(e));
                            track('discover_added_to_calendar', { source: e.source });
                            showToast('Added to your calendar. You can generate its brief there.');
                          }}
                        >
                          <CalendarPlus size={14} aria-hidden /> Add to my calendar
                        </button>
                        <a className="btn ghost small" href={googleCalendarLink(e)} target="_blank" rel="noopener noreferrer" onClick={() => track('discover_google_calendar_clicked')}>
                          Add to Google Calendar <ExternalLink size={14} aria-hidden />
                        </a>
                        <button
                          type="button"
                          className="btn ghost small"
                          onClick={() => {
                            updateDiscover((cur) => ({ ...cur, dismissed: [...cur.dismissed, e.id].slice(-1000) }));
                            track('discover_dismissed', { source: e.source });
                          }}
                        >
                          <ThumbsDown size={14} aria-hidden /> Not interested
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))
      )}
      {toast}
    </div>
  );
}
