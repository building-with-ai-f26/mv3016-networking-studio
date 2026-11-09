import { CalendarClock, CheckCircle2, Loader2 } from 'lucide-react';
import type { BriefStatus } from '../types';

const LABEL: Record<BriefStatus, string> = {
  ready: 'Brief ready',
  scheduled: 'Brief scheduled',
  generating: 'Generating brief…',
};

/** Status uses icon + text, not color alone. */
export function BriefStatusPill({ status }: { status: BriefStatus }) {
  const Icon = status === 'ready' ? CheckCircle2 : status === 'generating' ? Loader2 : CalendarClock;
  return (
    <span className={`status ${status}`}>
      <Icon size={14} aria-hidden className={status === 'generating' ? 'spin' : undefined} />
      {LABEL[status]}
    </span>
  );
}
