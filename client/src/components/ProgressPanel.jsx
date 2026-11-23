import { useEffect, useRef, useState } from 'react';

/** Counts seconds while `active` is true, and warns before closing the tab meanwhile. */
export function useBusyTimer(active) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      clearInterval(t);
      window.removeEventListener('beforeunload', warn);
    };
  }, [active]);
  return seconds;
}

/**
 * Honest progress for slow AI calls: the server does not report its progress, so we show the
 * steps it goes through, an animated (indeterminate) bar and the elapsed time — no fake %.
 */
export default function ProgressPanel({ title, steps, seconds, firstHint }) {
  const ref = useRef(null);
  // bring the panel into view when it appears.
  // Braces matter: an effect may only return a cleanup function, and newer browsers
  // return a Promise from smooth scrollIntoView — returning it would crash React.
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  return (
    <div ref={ref} className="rounded-lg border border-slate-200 bg-slate-50 p-4" role="status" aria-live="polite">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-slate-800">{title}</span>
        <span className="tabular-nums text-slate-500">{seconds}s</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded bg-slate-200">
        <div className="h-full w-1/3 animate-[slide_1.2s_ease-in-out_infinite] rounded bg-slate-700" />
      </div>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-600">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-slate-500">
        {seconds < 60
          ? firstHint
          : seconds < 120
            ? 'Still working — the free AI service is slow right now. Please keep this tab open.'
            : 'Taking longer than usual (the AI service may be busy). We will keep waiting up to 3 minutes.'}
      </p>
    </div>
  );
}

/** Rejects after `seconds`, for use with Promise.race around slow requests. */
export function timeoutAfter(seconds, message) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), seconds * 1000));
}
