import { ArrowLeft, CalendarDays, Clock, Loader2, Mail, MapPin, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { BriefStatusPill } from '../components/BriefStatusPill';
import { Dialog } from '../components/Dialog';
import { BriefDocument, IllustrativeTag } from '../components/brief/BriefDocument';
import { ChatPanel } from '../components/brief/ChatPanel';
import { QuestionsSection } from '../components/brief/QuestionsSection';
import { useToast } from '../components/Toast';
import { getBrief } from '../data/briefs';
import { SEED_EVENTS } from '../data/seed';
import { formatDateTime, formatLongDate, formatTimeRange, mondayOf, nyDateKey, tzAbbrev } from '../lib/time';
import { emailPreview, productionSchedule } from '../services/mockServices';
import { useStore } from '../state/store';
import { NotFoundPage } from './NotFoundPage';

export function EventPage() {
  const { eventId = '' } = useParams();
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
