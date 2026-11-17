import { ArrowLeft, CalendarDays, Clock, FileDown, FileText, Loader2, Mail, MapPin, PencilLine, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { BriefStatusPill } from '../components/BriefStatusPill';
import { Dialog } from '../components/Dialog';
import { BriefDocument, IllustrativeTag } from '../components/brief/BriefDocument';
import { AiBriefDocument } from '../components/brief/AiBriefDocument';
import { AiChatPanel } from '../components/brief/AiChatPanel';
import { useGenerateBrief } from '../components/ConfirmDetailsDialog';
import { downloadBriefDocx, downloadBriefPdf } from '../lib/briefExport';
import { ChatPanel } from '../components/brief/ChatPanel';
import { QuestionsSection } from '../components/brief/QuestionsSection';
import { useToast } from '../components/Toast';
import { getBrief } from '../data/briefs';
import { track } from '../lib/analytics';
import { TYPE_LABELS } from '../lib/classifier';
import { SEED_EVENTS } from '../data/seed';
import { formatDateTime, formatLongDate, formatTimeRange, mondayOf, nyDateKey, tzAbbrev } from '../lib/time';
import { emailPreview, productionSchedule } from '../services/mockServices';
import { useStore } from '../state/store';
import { NotFoundPage } from './NotFoundPage';

export function EventPage() {
  const { eventId = '' } = useParams();
  const { findUserEvent, google } = useStore();
  if (findUserEvent(eventId)) return <UserEventView key={eventId} eventId={eventId} />;
  if (eventId.startsWith('g-') && google.status === 'loading') return null; // Google events are still loading
  const event = SEED_EVENTS.find((e) => e.id === eventId);
  const brief = getBrief(eventId);
  if (!event || !brief) {
    return <NotFoundPage title="Event not found" message="We couldn’t find this event in your demo calendar. It may have been a broken or old link." />;
  }
  // Keyed so speaker selection and chat typing state never leak between events.
  return <EventView key={event.id} eventId={event.id} />;
}

function EventView({ eventId }: { eventId: string }) {
  const event = SEED_EVENTS.find((e) => e.id === eventId)!;
  const brief = getBrief(eventId)!;
  const { state, generateBrief } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [speakers, setSpeakers] = useState<string[]>([]);
  const [showEmail, setShowEmail] = useState(false);
  const [toast, showToast] = useToast();
  useEffect(() => track('event_opened', { event_id: eventId }), [eventId]);

  const status = state.briefStatus[event.id] ?? event.seedBriefStatus;
  const week = mondayOf(nyDateKey(event.start));
  const fromCalendar = (location.state as { from?: string } | null)?.from === 'calendar';
  const schedule = productionSchedule(event);
  const tz = tzAbbrev(event.start);

  const back = () => {
    if (fromCalendar) navigate(-1);
    else navigate(week === '2026-11-09' ? '/calendar' : `/calendar?week=${week}`, { state: { restoreScroll: true } });
  };

  const toggleSpeaker = (id: string) => setSpeakers((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const email = emailPreview(event, brief, state.profile);

  return (
    <div className="page">
      <button type="button" className="btn ghost small back-link" onClick={back}>
        <ArrowLeft size={16} aria-hidden /> Back to calendar
      </button>

      <header className="event-header">
        <div className="chip-row">
          <span className="chip">{event.type}</span>
          <IllustrativeTag text="Sample content" />
          <BriefStatusPill status={status} />
        </div>
        <h1>{event.title}</h1>
        <div className="meta-grid">
          <span>
            <CalendarDays size={16} aria-hidden /> {formatLongDate(event.start)}
          </span>
          <span>
            <Clock size={16} aria-hidden /> {formatTimeRange(event.start, event.end)} {tz} (New York)
          </span>
          <span>
            <MapPin size={16} aria-hidden /> {event.location}
          </span>
        </div>
      </header>

      <div className="card" style={{ marginBottom: 16, padding: '14px 18px' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="small">
            {status === 'ready' && event.seedBriefStatus === 'ready' ? (
              <strong>Sample brief · production timing: 48 hours before</strong>
            ) : (
              <strong>Simulated schedule (demo mode)</strong>
            )}
            <div className="muted">
              In the live product: brief prepared {formatDateTime(schedule.briefAt)} {tz} (48h before) · email reminder {formatDateTime(schedule.emailAt)} {tz} (24h
              before). No emails are sent in this demo.
            </div>
          </div>
          {state.profile.showEmailPreview && status === 'ready' && (
            <button type="button" className="btn secondary small" onClick={() => setShowEmail(true)}>
              <Mail size={15} aria-hidden /> Preview reminder email
            </button>
          )}
        </div>
      </div>

      <p className="goal-context">
        Prepared with your demo preferences in mind: <strong>{state.profile.roles.slice(0, 3).join(' · ') || 'no target roles selected'}</strong>
      </p>

      {status !== 'ready' ? (
        <div className="card" style={{ textAlign: 'center', padding: 36 }}>
          {status === 'scheduled' ? (
            <>
              <h2>Brief scheduled</h2>
              <p className="muted" style={{ maxWidth: 520, margin: '8px auto 16px' }}>
                In the live product, this brief would be prepared 48 hours before the event. In demo mode you can generate the sample brief right away.
              </p>
              <button type="button" className="btn" onClick={() => generateBrief(event.id)}>
                <Sparkles size={16} aria-hidden /> Generate demo brief now
              </button>
            </>
          ) : (
            <div role="status">
              <Loader2 size={28} className="spin" aria-hidden style={{ color: 'var(--primary)' }} />
              <h2 style={{ marginTop: 8 }}>Preparing your demo brief…</h2>
              <p className="muted">Loading sample content. No live research is happening.</p>
            </div>
          )}
        </div>
      ) : (
        <>
          <BriefDocument
            event={event}
            brief={brief}
            selectedSpeakers={speakers}
            onToggleSpeaker={toggleSpeaker}
            questions={<QuestionsSection brief={brief} selectedSpeakers={speakers} onToast={showToast} />}
          />
          <ChatPanel brief={brief} />
        </>
      )}

      {showEmail && (
        <Dialog
          title="Reminder email preview"
          onClose={() => setShowEmail(false)}
          footer={
            <button type="button" className="btn" onClick={() => setShowEmail(false)}>
              Close preview
            </button>
          }
        >
          <p className="notice info small">Preview only. Nothing is sent and no email is scheduled in demo mode.</p>
          <div className="email-preview">
            <dl>
              <dt>To</dt>
              <dd>{email.to}</dd>
              <dt>Would send</dt>
              <dd>{email.scheduledFor}</dd>
              <dt>Subject</dt>
              <dd>{email.subject}</dd>
            </dl>
            <div style={{ whiteSpace: 'pre-line' }}>{email.body}</div>
          </div>
        </Dialog>
      )}
      {toast}
    </div>
  );
}

/** An event the user added by hand: its brief is generated by real AI through the local server. */
function UserEventView({ eventId }: { eventId: string }) {
  const { state, deleteUserEvent, aiPending, aiErrors, findUserEvent, classified, google } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const event = findUserEvent(eventId)!;
  const isManual = event.source === 'manual';
  const [downloading, setDownloading] = useState(false);
  const { requestGenerate, dialog: confirmDialog } = useGenerateBrief();
  const cls = isManual ? undefined : classified[eventId];
  const run = state.aiBriefs[eventId];
  const pending = !!aiPending[eventId];
  const error = aiErrors[eventId];
  const status = pending ? 'generating' : run ? 'ready' : 'scheduled';
  const week = mondayOf(nyDateKey(event.start));
  const fromCalendar = (location.state as { from?: string } | null)?.from === 'calendar';
  useEffect(() => track('event_opened', { event_id: eventId, source: isManual ? 'manual' : 'google' }), [eventId, isManual]);

  const back = () => {
    if (fromCalendar) navigate(-1);
    else navigate(week === '2026-11-09' ? '/calendar' : `/calendar?week=${week}`, { state: { restoreScroll: true } });
  };
  const remove = () => {
    if (!window.confirm('Delete this event and its AI brief from this browser?')) return;
    deleteUserEvent(eventId);
    navigate(week === '2026-11-09' ? '/calendar' : `/calendar?week=${week}`);
  };
  const who = [event.person, event.role, event.company].filter(Boolean).join(' · ');

  return (
    <div className="page">
      <button type="button" className="btn ghost small back-link" onClick={back}>
        <ArrowLeft size={16} aria-hidden /> Back to calendar
      </button>
      <header className="event-header">
        <div className="chip-row">
          <span className="chip">{cls ? TYPE_LABELS[cls.classification.type] : event.type}</span>
          <span className="chip outline">{isManual ? 'Added by you' : google.calendarConnected ? 'Google Calendar (read-only)' : 'Sample calendar'}</span>
          <BriefStatusPill status={status} />
        </div>
        <h1>{event.title}</h1>
        <div className="meta-grid">
          <span>
            <CalendarDays size={16} aria-hidden /> {formatLongDate(event.start)}
          </span>
          <span>
            <Clock size={16} aria-hidden /> {formatTimeRange(event.start, event.end)} {tzAbbrev(event.start)} (New York)
          </span>
          {event.location && (
            <span>
              <MapPin size={16} aria-hidden /> {event.location}
            </span>
          )}
        </div>
        {who && <p className="muted">{who}</p>}
        {event.notes && <p className="muted small">Your notes: {event.notes}</p>}
        <button type="button" className="btn ghost small no-print" onClick={() => requestGenerate(eventId, { edit: true })}>
          <PencilLine size={15} aria-hidden /> {state.eventDetails[eventId] ? 'Edit details' : 'Add details'}
        </button>
      </header>

      {error && (
        <p className="notice field-error" role="alert">
          {error}
        </p>
      )}

      {pending ? (
        <div className="card" style={{ textAlign: 'center', padding: 36 }} role="status">
          <Loader2 size={28} className="spin" aria-hidden style={{ color: 'var(--primary)' }} />
          <h2 style={{ marginTop: 8 }}>Writing your brief with AI…</h2>
          <p className="muted">This usually takes a few seconds.</p>
        </div>
      ) : run ? (
        <>
          <div className="download-bar no-print">
            <span className="muted small">Download this brief:</span>
            <button
              type="button"
              className="btn secondary small"
              onClick={() => {
                track('brief_downloaded', { event_id: eventId, format: 'pdf' });
                downloadBriefPdf(event);
              }}
            >
              <FileDown size={15} aria-hidden /> PDF
            </button>
            <button
              type="button"
              className="btn secondary small"
              disabled={downloading}
              onClick={async () => {
                setDownloading(true);
                try {
                  await downloadBriefDocx(run, event);
                  track('brief_downloaded', { event_id: eventId, format: 'docx' });
                } finally {
                  setDownloading(false);
                }
              }}
            >
              {downloading ? <Loader2 size={15} className="spin" aria-hidden /> : <FileText size={15} aria-hidden />} Word
            </button>
          </div>
          <AiBriefDocument run={run} event={event} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button
              type="button"
              className="btn secondary small no-print"
              onClick={() => {
                if (!(run.chat?.length || run.savedQuestions?.length || run.extraQuestions?.length) || window.confirm('Regenerate the brief? Your saved questions, extra questions and chat for this brief will be replaced.')) requestGenerate(eventId, { edit: true });
              }}
            >
              <RefreshCw size={15} aria-hidden /> Regenerate with AI
            </button>
            {isManual && (
              <button type="button" className="btn ghost small" onClick={remove}>
                <Trash2 size={15} aria-hidden /> Delete event
              </button>
            )}
          </div>
          <AiChatPanel run={run} eventId={eventId} />
        </>
      ) : (
        <div className="card" style={{ textAlign: 'center', padding: 36 }}>
          <h2>No brief yet</h2>
          <p className="muted" style={{ maxWidth: 520, margin: '8px auto 16px' }}>
            {isManual
              ? 'The AI uses only the details you added. It will not invent news, numbers or facts about people.'
              : 'The AI receives only this event’s title, time and location (no attendee emails or description). It will not invent news, numbers or facts about people.'}
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn" onClick={() => requestGenerate(eventId)}>
              <Sparkles size={16} aria-hidden /> {error ? 'Try again' : 'Generate brief with AI'}
            </button>
            {isManual && (
              <button type="button" className="btn ghost" onClick={remove}>
                <Trash2 size={16} aria-hidden /> Delete event
              </button>
            )}
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
