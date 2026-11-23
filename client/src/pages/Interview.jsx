import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import InterviewResults from '../components/InterviewResults.jsx';

const CATEGORY_LABEL = { technical: 'Technical', project: 'Project', hr: 'HR' };

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// ---------------- live interview: one question at a time ----------------
function LiveQuestion({ id, payload, onUpdate }) {
  const { question, total } = payload;
  const [text, setText] = useState('');
  const [left, setLeft] = useState(payload.remainingSec);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const deadline = useRef(Date.now() + payload.remainingSec * 1000);
  const sentRef = useRef(false);

  const send = useCallback(
    async (action) => {
      if (sentRef.current) return; // never send twice (button + timer)
      sentRef.current = true;
      setSending(true);
      setError('');
      try {
        onUpdate(await api(`/interviews/${id}/answer`, { method: 'POST', body: { index: question.index, text, action } }));
      } catch (err) {
        if (err.status === 409 && err.data?.current) return onUpdate(err.data.current); // stale tab
        sentRef.current = false;
        setSending(false);
        setError(err.message);
      }
    },
    [id, question.index, text, onUpdate]
  );

  // Countdown from the SERVER's remaining time; auto-submit what is typed when it hits 0
  useEffect(() => {
    const t = setInterval(() => {
      const s = Math.max(0, Math.round((deadline.current - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) send('timeout');
    }, 250);
    return () => clearInterval(t);
  }, [send]);

  // Warn before closing/reloading — the timer keeps running on the server
  useEffect(() => {
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const low = left <= 30;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-500">
          Question {question.index + 1} of {total} ·{' '}
          <span className="font-medium text-slate-700">{CATEGORY_LABEL[question.category]}</span>
        </span>
        <span
          className={`tabular-nums rounded px-2 py-0.5 font-medium ${low ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}`}
          aria-live={low ? 'polite' : 'off'}
        >
          {mmss(left)}
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded bg-slate-100">
        <div className="h-full rounded bg-slate-700" style={{ width: `${((question.index) / total) * 100}%` }} />
      </div>

      <p className="mt-5 whitespace-pre-line text-lg text-slate-900">{question.text}</p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={sending}
        rows={8}
        maxLength={5000}
        autoFocus
        placeholder="Type your answer here…"
        className="mt-4 w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
      />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={() => send('submit')}
          disabled={sending || !text.trim()}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {sending ? 'Saving…' : question.index + 1 === total ? 'Submit and finish' : 'Submit answer'}
        </button>
        <button
          onClick={() => window.confirm('Skip this question? It will be scored as 0 and you cannot come back to it.') && send('skip')}
          disabled={sending}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Skip
        </button>
        <span className="text-xs text-slate-500">When the timer ends, what you have typed is submitted automatically.</span>
      </div>
    </div>
  );
}

export default function Interview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [live, setLive] = useState(null); // payload from /current while in progress
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');

  const handleUpdate = useCallback(
    async (payload) => {
      if (payload.status === 'in_progress') return setLive(payload);
      setLive(null);
      const { interview } = await api(`/interviews/${id}`);
      setSummary(interview);
      window.scrollTo(0, 0);
    },
    [id]
  );

  useEffect(() => {
    api(`/interviews/${id}/current`).then(handleUpdate).catch((e) => setError(e.message));
  }, [id, handleUpdate]);

  async function abandon() {
    if (!window.confirm('Abandon this interview? Unanswered questions will be scored as 0. This cannot be undone.')) return;
    try {
      await api(`/interviews/${id}/abandon`, { method: 'POST' });
      handleUpdate({ status: 'abandoned' });
    } catch (e) {
      setError(e.message);
    }
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (summary) {
    return (
      <div className="space-y-4">
        <button onClick={() => navigate('/')} className="text-sm text-slate-500 hover:text-slate-900">← Dashboard</button>
        <InterviewResults interview={summary} />
      </div>
    );
  }
  if (!live) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="space-y-3">
      {/* key = question index: a fresh component (empty answer box, new timer) per question */}
      <LiveQuestion key={live.question.index} id={id} payload={live} onUpdate={handleUpdate} />
      <div className="flex justify-between text-xs text-slate-500">
        <Link to="/" className="hover:text-slate-900">Leave for now (the timer keeps running)</Link>
        <button onClick={abandon} className="hover:text-red-700">Abandon interview</button>
      </div>
    </div>
  );
}
