// src/App.jsx
// Shepherds Table Cloud — App Router (Nov 2025)
// - React Router v6 with Suspense + lazy routes
// - Protected shell for all authenticated pages
// - AdminRoute guards admin-only pages via useAuth().isAdmin
// - Auth-aware NotFound: unauth → /login, authed → /
// - Public legal pages included (privacy/terms/usage)

import { Routes, Route, Navigate } from "react-router-dom";
import { Suspense, lazy } from "react";

import ProtectedRoute from "./auth/ProtectedRoute";
import { useAuth } from "./auth/useAuth";
import Layout from "./components/Layout";
import UsagePolicy from "./pages/UsagePolicy.jsx";

// Lazy pages (Vite-friendly dynamic imports)
const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Reports = lazy(() => import("./pages/Reports"));
const UsdaMonthly = lazy(() => import("./pages/UsdaMonthly"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const TermsOfService = lazy(() => import("./pages/TermsOfService"));

// ─────────────────────────────────────────────────────────────
// AdminRoute — simple wrapper to guard admin-only routes
// ─────────────────────────────────────────────────────────────
function AdminRoute({ children }) {
  const { loading, isAdmin } = useAuth();
  if (loading) {
    return (
      <div className="p-6 text-sm text-gray-600" aria-busy="true">
        Loading…
      </div>
    );
  }
  if (!isAdmin) return <Navigate to="/" replace />;
  return children;
}

// ─────────────────────────────────────────────────────────────
// AuthAwareNotFound — redirect based on auth state
//  • unauthenticated → /login
//  • authenticated   → /
// ─────────────────────────────────────────────────────────────
function AuthAwareNotFound() {
  const { loading, uid } = useAuth() || {};
  if (loading) {
    return (
      <div className="min-h-[40vh] grid place-items-center p-6 text-sm text-gray-600" aria-busy="true">
        Loading…
      </div>
    );
  }
  return <Navigate to={uid ? "/" : "/login"} replace />;
}

// Shared Suspense fallback (accessible)
const Fallback = (
  <div
    className="min-h-[40vh] grid place-items-center p-6 text-sm text-gray-600"
    aria-busy="true"
    aria-live="polite"
  >
    Loading…
  </div>
);

// ─────────────────────────────────────────────────────────────
// Main App Component
// ─────────────────────────────────────────────────────────────
export default function App() {
  return (
    <Suspense fallback={Fallback}>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/usage" element={<UsagePolicy />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<TermsOfService />} />

        {/* Authenticated Shell */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          {/* Default Dashboard */}
          <Route index element={<Dashboard />} />

          {/* Admin-only routes */}
          <Route
            path="reports"
            element={
              <AdminRoute>
                <Reports />
              </AdminRoute>
            }
          />
          <Route
            path="usda-monthly"
            element={
              <AdminRoute>
                <UsdaMonthly />
              </AdminRoute>
            }
          />

          {/* In-shell catch-all → home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>

        {/* Outside-shell catch-all → auth-aware redirect */}
        <Route path="*" element={<AuthAwareNotFound />} />
      </Routes>
    </Suspense>
  );
}
