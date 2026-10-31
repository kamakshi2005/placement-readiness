// Shared card layout + input for the login and signup pages
export function AuthCard({ title, subtitle, children }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

export function Field({ label, ...props }) {
  return (
    <label className="block text-sm">
      <span className="text-slate-700">{label}</span>
      <input
        {...props}
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
      />
    </label>
  );
}
