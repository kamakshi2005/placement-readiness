import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import ProgressPanel, { useBusyTimer, timeoutAfter } from './ProgressPanel.jsx';

const STEPS = [
  'Choosing skills: gaps from this analysis first, then skills your resume claims',
  'Writing the questions for your skills and projects (AI)',
  'Preparing the interview',
];

// "Start mock interview" box on the analysis result page
export default function StartInterview({ analysisId }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const inStudy = !!user.studyGroup;
  const [mode, setMode] = useState('gap');
  const [preset, setPreset] = useState('standard');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null); // interview already in progress
  const seconds = useBusyTimer(busy);

  async function start() {
    setError('');
    setOpenId(null);
    setBusy(true);
    try {
      const { session } = await Promise.race([
        api('/interviews', { method: 'POST', body: { analysisId, mode, preset } }),
        timeoutAfter(180, 'Preparing the interview took longer than 3 minutes. Check "Your interviews" on the dashboard before trying again.'),
      ]);
      navigate(`/interview/${session._id}`);
    } catch (err) {
      setError(err.message);
      if (err.data?.sessionId) setOpenId(err.data.sessionId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold text-slate-900">Mock interview for this job</h2>
      <p className="mt-1 text-sm text-slate-500">
        Your first interview here focuses on the skill gaps above; after that you can choose the focus. One question
        at a time, with a timer; you can't go back.
      </p>

      {!inStudy && !busy && (
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-slate-600">Focus (after baseline)</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1">
              <option value="gap">My skill gaps</option>
              <option value="general">General (all JD skills)</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-slate-600">Length</span>
            <select value={preset} onChange={(e) => setPreset(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1">
              <option value="standard">Standard — 8 questions (up to 23 min)</option>
              <option value="study">Short — 6 questions (up to 17 min)</option>
            </select>
          </label>
        </div>
      )}

      {error && (
        <p className="mt-3 text-sm text-red-600">
          {error}{' '}
          {openId && (
            <Link to={`/interview/${openId}`} className="font-medium underline">
              Go to it
            </Link>
          )}
        </p>
      )}

      <div className="mt-4">
        {busy ? (
          <ProgressPanel
            title="Preparing your interview…"
            steps={STEPS}
            seconds={seconds}
            firstHint="Writing the questions usually takes 30–90 seconds on the free AI tier. The timer only starts when you see the first question."
          />
        ) : (
          <button onClick={start} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
            Start mock interview
          </button>
        )}
      </div>
    </div>
  );
}
