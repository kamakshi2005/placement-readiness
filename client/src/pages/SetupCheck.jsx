import { useEffect, useState } from 'react';

// Development page at /setup: checks that client, server and database are all up
export default function SetupCheck() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then(setHealth)
      .catch(() => setError('Cannot reach the server. Is it running on port 5000?'));
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Placement Readiness Platform</h1>
        <p className="mt-1 text-sm text-slate-500">Setup check</p>

        <ul className="mt-6 space-y-3 text-sm">
          <li className="flex justify-between">
            <span>Client (React + Tailwind)</span>
            <span className="font-medium text-green-600">running</span>
          </li>
          <li className="flex justify-between">
            <span>Server (Express)</span>
            <span className={health ? 'font-medium text-green-600' : 'font-medium text-red-600'}>
              {health ? 'running' : error ? 'not reachable' : 'checking…'}
            </span>
          </li>
          <li className="flex justify-between">
            <span>Database (MongoDB)</span>
            <span className={health?.database === 'connected' ? 'font-medium text-green-600' : 'font-medium text-amber-600'}>
              {health ? health.database : '—'}
            </span>
          </li>
        </ul>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
    </main>
  );
}
