// src/auth/ProtectedRoute.tsx
import type { ReactElement } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './useAuth';

export default function ProtectedRoute({
  children,
  role,
}: {
  children: ReactElement;
  role?: 'admin' | 'volunteer';
}) {
  const { loading, email, role: userRole } = useAuth();
  if (loading) return <div className="p-6">Loading…</div>;
  if (!email) return <Navigate to="/login" replace />;
  if (role && userRole && role !== userRole) return <Navigate to="/" replace />;
  return children;
}
