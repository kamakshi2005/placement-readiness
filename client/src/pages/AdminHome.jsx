import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// Admin home: today's AI usage per model against the free-tier daily limits.
// (The study-group page from the dropped classmate study, StudyGroupsAdmin.jsx, is intentionally
// not linked anymore — its code and API are kept but not built on.)
export default function AdminHome() {
  const [usage, setUsage] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/admin/ai-usage')
      .then(setUsage)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Admin</h1>
        <p className="mt-1 text-sm text-slate-500">AI usage today against the free-tier daily limits.</p>
        {usage && (
          <p className="mt-2 text-xs text-slate-500">
            Quota day {usage.day} (Pacific time) · resets in {usage.resetsIn} · AI mode: <b>{usage.mode}</b>
          </p>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {usage && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2 font-medium">Model</th>
                  <th className="px-4 py-2 font-medium">Used today</th>
                  <th className="px-4 py-2 font-medium">Left</th>
                  <th className="px-4 py-2 font-medium">Per minute</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {usage.models.map((m) => {
                  const pct = m.used / m.limit;
                  return (
                    <tr key={m.model}>
                      <td className="px-4 py-2 font-mono text-xs text-slate-800">{m.model}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded bg-slate-100">
                            <div
                              className={`h-full ${m.exhausted || pct >= 0.9 ? 'bg-red-500' : pct >= 0.6 ? 'bg-amber-500' : 'bg-slate-600'}`}
                              style={{ width: `${Math.min(100, m.exhausted ? 100 : pct * 100)}%` }}
                            />
                          </div>
                          <span className="tabular-nums text-slate-700">
                            {m.used} / {m.limit}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2 tabular-nums text-slate-700">
                        {m.exhausted ? <span className="text-red-700">used up (Google)</span> : m.remaining}
                      </td>
                      <td className="px-4 py-2 tabular-nums text-slate-500">{m.rpm}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
