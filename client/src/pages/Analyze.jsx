import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import ProgressPanel, { useBusyTimer, timeoutAfter } from '../components/ProgressPanel.jsx';

const MAX_MB = 2;
const TIMEOUT_S = 180; // give up waiting after 3 minutes (the server may still finish)

// What happens on the server, in order (shown as steps, not a fake percentage)
const STEPS = [
  'Reading your PDF and removing personal details',
  'Extracting skills from your resume and the job description (AI)',
  'Matching skills — exact names, then meaning similarity',
  'AI check for borderline skills, then calculating the score',
];

export default function Analyze() {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [jdTitle, setJdTitle] = useState('');
  const [jdText, setJdText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const seconds = useBusyTimer(busy);

  function pickFile(e) {
    const f = e.target.files[0];
    setError('');
    if (f && f.type !== 'application/pdf') {
      setError('Please choose a PDF file');
      return setFile(null);
    }
    if (f && f.size > MAX_MB * 1024 * 1024) {
      setError(`PDF is too large (max ${MAX_MB} MB)`);
      return setFile(null);
    }
    setFile(f || null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!file) return setError('Please upload your resume as a PDF');
    if (jdText.trim().length < 100) return setError('Paste the full job description (at least 100 characters)');

    const form = new FormData();
    form.append('resume', file);
    form.append('jdTitle', jdTitle);
    form.append('jdText', jdText);

    setBusy(true);
    const timeout = timeoutAfter(
      TIMEOUT_S,
      'This is taking longer than 3 minutes. The analysis may still finish in the background — check "Your analyses" on the dashboard in a minute before trying again.'
    );
    try {
      const { analysis } = await Promise.race([api('/analysis', { method: 'POST', body: form }), timeout]);
      navigate(`/analysis/${analysis._id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">New resume–JD analysis</h1>
      <p className="mt-1 text-sm text-slate-500">
        Upload your resume and paste a job description to see which required skills you have and which are missing.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        <label className="block text-sm">
          <span className="text-slate-700">Resume (PDF, max {MAX_MB} MB)</span>
          <input
            type="file"
            accept="application/pdf"
            onChange={pickFile}
            disabled={busy}
            className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-slate-700 hover:file:bg-slate-200"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Your phone number, email, links and name are removed before the text is sent to the AI. The PDF itself is not stored.
          </span>
        </label>

        <label className="block text-sm">
          <span className="text-slate-700">Job title (optional)</span>
          <input
            value={jdTitle}
            onChange={(e) => setJdTitle(e.target.value)}
            maxLength={150}
            disabled={busy}
            placeholder="e.g. Junior Backend Developer – Zoho"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
          />
        </label>

        <label className="block text-sm">
          <span className="text-slate-700">Job description</span>
          <textarea
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            rows={10}
            maxLength={20000}
            disabled={busy}
            placeholder="Paste the full job description here…"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
          />
          <span className="mt-1 block text-right text-xs text-slate-400">{jdText.length} / 20000</span>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {busy ? (
          <ProgressPanel
            title="Analysing your resume…"
            steps={STEPS}
            seconds={seconds}
            firstHint="A first analysis usually takes 30–100 seconds on the free AI tier. Re-running the same resume and JD is almost instant."
          />
        ) : (
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Analyse
          </button>
        )}
      </form>
    </div>
  );
}
