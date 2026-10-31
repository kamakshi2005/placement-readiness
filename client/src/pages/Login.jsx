import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { AuthCard, Field } from '../components/AuthForm.jsx';

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(form.email, form.password);
      // go back to the page the user originally wanted, if any
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const update = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  return (
    <AuthCard title="Log in" subtitle="Placement Readiness Platform">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Email" name="email" type="email" autoComplete="email" required value={form.email} onChange={update} />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required value={form.password} onChange={update} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-slate-900 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">
        New here?{' '}
        <Link to="/signup" className="font-medium text-slate-900 underline">
          Create an account
        </Link>
      </p>
    </AuthCard>
  );
}
