import { CheckCircle2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Small accessible success toast. Returns the element to render and a show() function. */
export function useToast(): [JSX.Element, (msg: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2600);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const el = (
    <div role="status" aria-live="polite" className="sr-live-wrap">
      {msg && (
        <div className="toast">
          <CheckCircle2 size={18} aria-hidden /> {msg}
        </div>
      )}
    </div>
  );
  return [el, show];
}
