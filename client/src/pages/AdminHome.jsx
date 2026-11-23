// Admin home. The study-group page from the dropped classmate study (StudyGroupsAdmin.jsx)
// is intentionally not linked anymore — its code and API are kept but not built on.
export default function AdminHome() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">Admin</h1>
      <p className="mt-1 text-sm text-slate-500">Only admins can see this page. Admin tools will be added in later phases.</p>
    </div>
  );
}
