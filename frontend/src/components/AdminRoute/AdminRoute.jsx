import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import ProtectedRoute from '../ProtectedRoute/ProtectedRoute.jsx';

/**
 * Wraps admin pages. Requires an authenticated session (via ProtectedRoute)
 * AND the `admin` or `owner` role. Non-admins land back on the dashboard.
 */
export default function AdminRoute({ children }) {
  const { user } = useAuth();

  if (user?.role !== 'admin' && user?.role !== 'owner') {
    return <Navigate to='/dashboard' replace />;
  }

  return <ProtectedRoute>{children}</ProtectedRoute>;
}