import { CalendarDays, ChevronLeft, ChevronRight, Clock, Loader2, MapPin, Plus, RotateCcw, Sparkles } from 'lucide-react';
import { useLayoutEffect, useMemo, useState } from 'react';
import { AddEventDialog } from '../components/AddEventDialog';
import { useToast } from '../components/Toast';
import { Link, useLocation, useNavigationType, useSearchParams } from 'react-router-dom';
import { BriefStatusPill } from '../components/BriefStatusPill';
import { Illustration } from '../components/Illustration';
import { DEMO_WEEK_START, SEED_EVENTS } from '../data/seed';
import { addDays, formatDayHeading, formatTime, formatWeekRange, isValidDateKey, mondayOf, nyDateKey, tzAbbrev, weekDays } from '../lib/time';
import { useStore } from '../state/store';
import type { BriefStatus, NetworkingEvent, UserEvent } from '../types';

type CalendarEvent = NetworkingEvent | UserEvent;
const isUserEvent = (ev: CalendarEvent): ev is UserEvent => 'source' in ev;

const scrollKey = (week: string) => `ns-calendar-scroll:${week}`;

export function saveCalendarScroll(week: string) {
  try {
    sessionStorage.setItem(scrollKey(week), String(window.scrollY));
  } catch {
    /* ignore */
  }
}

export function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navType = useNavigationType();
  const { state, generateBrief, addUserEvent, generateAiBrief, aiPending, aiErrors, google, googleEvents, googleError, googleLoading, reloadGoogleCalendar } = useStore();
  const [adding, setAdding] = useState(false);
  const [toast, showToast] = useToast();
  const raw = params.get('week');
  // With Google Calendar connected, the calendar opens on the real current week; otherwise on the demo week.
  const thisWeek = mondayOf(nyDateKey(new Date().toISOString()));
  const homeWeek = google.calendarConnected ? thisWeek : DEMO_WEEK_START;
  const week = isValidDateKey(raw) ? mondayOf(raw) : homeWeek;
  const isDemoWeek = week === DEMO_WEEK_START;
  const days = weekDays(week);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of [...SEED_EVENTS, ...state.userEvents, ...googleEvents].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())) {
      const key = nyDateKey(ev.start);
      map.set(key, [...(map.get(key) ?? []), ev]);
    }
    return map;
  }, [state.userEvents, googleEvents]);

  const statusOf = (ev: CalendarEvent): BriefStatus => {
    if (!isUserEvent(ev)) return state.briefStatus[ev.id] ?? ev.seedBriefStatus;
    if (aiPending[ev.id]) return 'generating';
    return state.aiBriefs[ev.id] ? 'ready' : 'scheduled';
  };

  const saveNewEvent = (ev: UserEvent) => {
    addUserEvent(ev);
    setAdding(false);
    const evWeek = mondayOf(nyDateKey(ev.start));
    if (evWeek !== week) goWeek(evWeek);
    showToast('Event added. Generate its brief with AI when you are ready.');
  };

  // Restore scroll position when returning from an event.
  useLayoutEffect(() => {
    const returning = navType === 'POP' || (location.state as { restoreScroll?: boolean } | null)?.restoreScroll;
    if (!returning) {
      window.scrollTo(0, 0);
      return;
    }
    let y = 0;
    try {
      y = Number(sessionStorage.getItem(scrollKey(week)) ?? 0);
    } catch {
      /* ignore */
    }
    window.scrollTo(0, y);
  }, [location.key, navType, week, location.state]);

  const goWeek = (w: string) => setParams(w === homeWeek ? {} : { week: w });
  const tz = tzAbbrev(`${week}T12:00:00-05:00`);
  const roles = state.profile.roles.slice(0, 2);
  const inds = state.profile.industries.slice(0, 2);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Your networking week</h1>
          <p className="subtitle">A little preparation. Better conversations.</p>
        </div>
        <button type="button" className="btn" onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden /> Add event
        </button>
      </div>

      <div className="week-bar">
        <div>
          <div className="week-label" aria-live="polite">
            {isDemoWeek ? `Sample week · ${formatWeekRange(week)}` : `Week of ${formatWeekRange(week)}`}
          </div>
          <div className="muted small">Times shown in New York time ({tz})</div>
        </div>
        <div className="week-controls">
          <button type="button" className="btn secondary small" onClick={() => goWeek(addDays(week, -7))}>
            <ChevronLeft size={16} aria-hidden /> Previous week
          </button>
          <button type="button" className="btn secondary small" onClick={() => goWeek(addDays(week, 7))}>
            Next week <ChevronRight size={16} aria-hidden />
          </button>
          {google.calendarConnected && (
            <button type="button" className="btn ghost small" onClick={() => goWeek(thisWeek)} disabled={week === thisWeek}>
              <CalendarDays size={15} aria-hidden /> This week
            </button>
          )}
          <button type="button" className="btn ghost small" onClick={() => goWeek(DEMO_WEEK_START)} disabled={isDemoWeek}>
            <RotateCcw size={15} aria-hidden /> Demo week
          </button>
        </div>
      </div>
      {google.calendarConnected && (
        <div className="notice info small" role="status">
          {googleLoading
            ? 'Loading your Google Calendar…'
            : googleError
              ? `Google Calendar: ${googleError}`
              : `Google Calendar connected (read-only) · ${google.email ?? ''} · ${googleEvents.length} events in the next 14 days.`}{' '}
          {!googleLoading && (
            <button type="button" className="btn ghost small" onClick={() => void reloadGoogleCalendar()}>
              Refresh
            </button>
          )}
        </div>
      )}
      <p className="goal-context">
        Preparing for <strong>{roles.join(' · ') || 'your target roles'}</strong>
        {inds.length > 0 && (
          <>
            {' '}
            in <strong>{inds.join(' · ')}</strong>
          </>
        )}
        . <Link to="/settings">Edit goals</Link>
      </p>

      <div className="card" style={{ padding: '6px 22px' }}>
        {days.map((day) => {
          const events = eventsByDay.get(day) ?? [];
          const h = formatDayHeading(day);
          return (
            <section className="day" key={day} aria-labelledby={`day-${day}`}>
              <h2 className="day-head" id={`day-${day}`}>
                <span className="weekday">{h.weekday}</span>
                <span className="date">{h.date}</span>
              </h2>
              <div className="day-events">
                {events.length === 0 ? (
                  <p className="day-empty">
                    <Illustration kind="calm-day" size={22} /> No networking events
                  </p>
                ) : (
                  events.map((ev) => {
                    const status = statusOf(ev);
                    const userEv = isUserEvent(ev);
                    const seededReady = !userEv && ev.seedBriefStatus === 'ready';
                    const aiError = userEv ? aiErrors[ev.id] : '';
                    return (
                      <article className="card event-card" key={ev.id} data-testid={`event-${ev.id}`}>
                        <div className="event-time">
                          {formatTime(ev.start)}
                          <span className="end">to {formatTime(ev.end)}</span>
                        </div>
                        <div className="event-body">
                          <h3 className="event-title">
                            <Link to={`/events/${ev.id}`} state={{ from: 'calendar', week }} onClick={() => saveCalendarScroll(week)}>
                              {ev.title}
                            </Link>
                          </h3>
                          <div className="event-meta">
                            <span className="chip outline">{ev.type}</span>
                            {userEv && <span className="chip">{ev.source === 'google' ? 'Google Calendar' : 'Added by you'}</span>}
                            {ev.location && (
                              <span>
                                <MapPin size={14} aria-hidden /> {ev.location}
                              </span>
                            )}
                          </div>
                          <div className="event-foot">
                            <div style={{ display: 'grid', gap: 4, justifyItems: 'start' }}>
                              <BriefStatusPill status={status} />
                              <span className="timing">
                                <Clock size={12} aria-hidden />{' '}
                                {userEv
                                  ? ev.source === 'google'
                                    ? 'AI brief uses only the title, time and location'
                                    : 'Brief written by AI from the details you added'
                                  : status === 'ready' && seededReady
                                    ? 'Sample brief · production timing: 48 hours before'
                                    : 'Simulated schedule: brief 48h before · email reminder 24h before'}
                              </span>
                              {aiError && (
                                <span className="field-error" role="alert">
                                  {aiError}
                                </span>
                              )}
                            </div>
                            <div className="event-actions">
                              {status === 'scheduled' && userEv && (
                                <button type="button" className="btn secondary small" onClick={() => void generateAiBrief(ev.id)}>
                                  <Sparkles size={15} aria-hidden /> {aiError ? 'Try again' : 'Generate brief with AI'}
                                </button>
                              )}
                              {status === 'scheduled' && !userEv && (
                                <button type="button" className="btn secondary small" onClick={() => generateBrief(ev.id)}>
                                  <Sparkles size={15} aria-hidden /> Generate demo brief now
                                </button>
                              )}
                              {status === 'generating' && (
                                <button type="button" className="btn secondary small" disabled aria-busy="true">
                                  <Loader2 size={15} className="spin" aria-hidden /> Generating…
                                </button>
                              )}
                              <Link
                                to={`/events/${ev.id}`}
                                state={{ from: 'calendar', week }}
                                className="btn small"
                                onClick={() => saveCalendarScroll(week)}
                                aria-label={`Open brief: ${ev.title}`}
                              >
                                Open brief
                              </Link>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>
      {adding && <AddEventDialog defaultDate={isDemoWeek ? DEMO_WEEK_START : week} onSave={saveNewEvent} onClose={() => setAdding(false)} />}
      {toast}
    </div>
  );
}
