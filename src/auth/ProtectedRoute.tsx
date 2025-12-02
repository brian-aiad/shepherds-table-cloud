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
 *   // Master-only (global super admin)
 *   <ProtectedRoute requireMaster><MasterConsole /></ProtectedRoute>
 *
 *   // Capability-based guard (uses hasCapability from AuthProvider)
 *   <ProtectedRoute capability="viewReports"><Reports /></ProtectedRoute>
 *
 * Rules implemented:
 * - Auth required for all protected routes (redirects to /login if not signed in).
 * - Master override:
 *     • requireMaster === true → only master can access.
 *     • Master always satisfies admin/volunteer/capability checks.
 * - Role gating:
 *     • role="admin"      → requires isAdmin === true (or master).
 *     • role="volunteer"  → allows volunteers AND admins AND master.
 * - Capability gating:
 *     • capability="xyz"  → requires hasCapability("xyz") or master.
 * - Loading state renders a simple, accessible placeholder.
 */

type ProtectedRouteProps = {
  children: ReactElement;
  role?: "admin" | "volunteer";
  /** Only allow global master (God mode) */
  requireMaster?: boolean;
  /** Optional capability name for fine-grained gating */
  capability?: string;
};

export default function ProtectedRoute({
  children,
  role,
  requireMaster,
  capability,
}: ProtectedRouteProps) {
  const {
    loading,
    email,
    role: userRole,
    isAdmin,
    isMaster,
    hasCapability,
  } = useAuth();

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

  // Master-only routes
  if (requireMaster && !isMaster) {
    return <Navigate to="/" replace />;
  }

  // Role checks (admin is a superset of volunteer; master is superset of both)
  if (role === "admin" && !(isAdmin || isMaster)) {
    return <Navigate to="/" replace />;
  }

  if (role === "volunteer") {
    const allowed = isMaster || isAdmin || userRole === "volunteer";
    if (!allowed) return <Navigate to="/" replace />;
  }

  // Capability-based gating (master always allowed)
  if (capability && !isMaster && !hasCapability(capability)) {
    return <Navigate to="/" replace />;
  }

  return children;
}
