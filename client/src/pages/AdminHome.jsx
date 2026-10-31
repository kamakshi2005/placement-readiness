// Placeholder admin page — only reachable by role "admin".
// The batch dashboard is a stretch feature; for now this just proves role-based access.
export default function AdminHome() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">Admin</h1>
      <p className="mt-1 text-sm text-slate-500">Only admins can see this page.</p>
    </div>
  );
}
