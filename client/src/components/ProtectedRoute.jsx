import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// Wrap a page: <ProtectedRoute roles={['admin']}><AdminPage /></ProtectedRoute>
// Note: this only hides pages in the UI. The real protection is on the server
// (protect / requireRole middleware), because client code can be bypassed.
export default function ProtectedRoute({ roles, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <p className="p-6 text-sm text-slate-500">Loading…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}
