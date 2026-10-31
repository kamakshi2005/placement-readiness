import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { AuthCard, Field } from '../components/AuthForm.jsx';

export default function Signup() {
  const { user, signup } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (form.password.length < 8) return setError('Password must be at least 8 characters');
    setBusy(true);
    try {
      await signup(form.name, form.email, form.password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const update = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  return (
    <AuthCard title="Create account" subtitle="Students sign up here">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Full name" name="name" autoComplete="name" required value={form.name} onChange={update} />
        <Field label="Email" name="email" type="email" autoComplete="email" required value={form.email} onChange={update} />
        <Field label="Password (min 8 characters)" name="password" type="password" autoComplete="new-password" required value={form.password} onChange={update} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-slate-900 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {busy ? 'Creating account…' : 'Sign up'}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-slate-900 underline">
          Log in
        </Link>
      </p>
    </AuthCard>
  );
}
