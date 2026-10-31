import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';

// Placeholder home — the real progress dashboard is Module 7
export default function Dashboard() {
  const { user } = useAuth();
  const [analyses, setAnalyses] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/analysis')
      .then((d) => setAnalyses(d.analyses))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Welcome, {user.name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Logged in as <span className="font-medium">{user.email}</span> · role:{' '}
          <span className="font-medium">{user.role}</span>
        </p>
        <Link
          to="/analyze"
          className="mt-4 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          New resume–JD analysis
        </Link>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="font-semibold text-slate-900">Your analyses</h2>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {!analyses && !error && <p className="mt-3 text-sm text-slate-500">Loading…</p>}
        {analyses?.length === 0 && (
          <p className="mt-3 text-sm text-slate-500">No analyses yet. Start one to see your skill gaps.</p>
        )}
        {analyses?.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100">
            {analyses.map((a) => (
              <li key={a._id}>
                <Link to={`/analysis/${a._id}`} className="flex items-center justify-between gap-4 py-3 hover:bg-slate-50">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{a.jdTitle || 'Untitled job'}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(a.createdAt).toLocaleDateString()} · {a.counts.matched} matched · {a.counts.partial} partial ·{' '}
                      {a.counts.missing} missing
                    </p>
                  </div>
                  <span className="shrink-0 text-lg font-semibold text-slate-900">{a.matchScore}%</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
