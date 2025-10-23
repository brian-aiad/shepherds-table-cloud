// src/auth/ProtectedRoute.tsx
import type { ReactElement } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./useAuth";

/**
 * ProtectedRoute — route guard for Shepherds Table Cloud
 *
 * Usage:
 *   <ProtectedRoute><Dashboard /></ProtectedRoute>
 *   <ProtectedRoute role="volunteer"><SomeVolunteerPage /></ProtectedRoute>
 *   <ProtectedRoute role="admin"><Reports /></ProtectedRoute>
 *
 * Rules implemented:
 * - Auth required for all protected routes (redirects to /login if not signed in).
 * - Role gating:
 *     • role="admin"  → requires isAdmin === true
 *     • role="volunteer" → allows volunteers AND admins (admin is a superset)
 * - Loading state renders a simple, accessible placeholder.
 */
export default function ProtectedRoute({
  children,
  role,
}: {
  children: ReactElement;
  role?: "admin" | "volunteer";
}) {
  const { loading, email, role: userRole, isAdmin } = useAuth();

  if (loading) {
    return (
      <div
        className="min-h-screen grid place-items-center p-6 text-sm text-gray-600"
        aria-busy="true"
        aria-live="polite"
      >
        Loading…
      </div>
    );
  }

  // Not authenticated → login
  if (!email) return <Navigate to="/login" replace />;

  // Role checks (admin is a superset of volunteer)
  if (role === "admin" && !isAdmin) return <Navigate to="/" replace />;

  if (role === "volunteer") {
    const allowed = isAdmin || userRole === "volunteer";
    if (!allowed) return <Navigate to="/" replace />;
  }

  return children;
}
