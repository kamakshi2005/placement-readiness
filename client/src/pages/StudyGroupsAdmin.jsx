// LEGACY (dropped classmate study) — kept but NOT routed or linked anywhere. Don't build on it.
// Admin: assign students to study groups A/B and see their progress.
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function StudyGroupsAdmin() {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    api('/admin/users')
      .then((d) => setUsers(d.users))
      .catch((e) => setError(e.message));
  }, []);

  async function setGroup(u, value) {
    const studyGroup = value === '' ? null : value;
    if (u.completed.baseline > 0 && !window.confirm(`${u.name} has already done a baseline. Change their group anyway?`)) return;
    setSaving(u._id);
    setError('');
    try {
      await api(`/admin/users/${u._id}/study-group`, { method: 'PATCH', body: { studyGroup } });
      setUsers((list) => list.map((x) => (x._id === u._id ? { ...x, studyGroup } : x)));
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(null);
    }
  }

  const n = (g) => users?.filter((u) => u.studyGroup === g).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Study groups</h1>
        <p className="mt-1 text-sm text-slate-500">
          Group A practises with general interviews, Group B with targeted practice. Both take the same baseline and
          post-test. Students in a group always get the short study preset (4 technical, 1 project, 1 HR).
        </p>
        {users && (
          <p className="mt-2 text-sm text-slate-700">
            Group A: <b>{n('A')}</b> · Group B: <b>{n('B')}</b> · Not in study: <b>{n(null)}</b>
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!users && !error && <p className="text-sm text-slate-500">Loading…</p>}

      {users?.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2 font-medium">Student</th>
                  <th className="px-4 py-2 font-medium">Group</th>
                  <th className="px-4 py-2 font-medium">Completed: baseline / practice / post-test</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u._id}>
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-900">{u.name}</div>
                      <div className="text-xs text-slate-500">{u.email}</div>
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={u.studyGroup ?? ''}
                        disabled={saving === u._id}
                        onChange={(e) => setGroup(u, e.target.value)}
                        className="rounded-md border border-slate-300 px-2 py-1"
                        aria-label={`Study group for ${u.name}`}
                      >
                        <option value="">Not in study</option>
                        <option value="A">A — general practice</option>
                        <option value="B">B — targeted practice</option>
                      </select>
                    </td>
                    <td className="px-4 py-2 tabular-nums text-slate-700">
                      {u.completed.baseline} / {u.completed.practice} / {u.completed.posttest}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {users?.length === 0 && <p className="text-sm text-slate-500">No students have signed up yet.</p>}
    </div>
  );
}
