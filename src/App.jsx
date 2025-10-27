// src/App.jsx
// Shepherds Table Cloud — App Router (Oct 2025)
// - Protected shell for all authenticated pages
// - AdminRoute guards admin-only pages (respects useAuth().isAdmin)
// - Lazy-loaded route components with a safe <Suspense> fallback
// - Catch-alls route back to "/login" for public area, "/" for authed shell

import { Routes, Route, Navigate } from "react-router-dom";
import { Suspense, lazy } from "react";

import ProtectedRoute from "./auth/ProtectedRoute";
import { useAuth } from "./auth/useAuth"; // ← named export (consistent with the rest of the app)
import Layout from "./components/Layout";
import UsagePolicy from "./pages/UsagePolicy.jsx";

// Lazy pages (Vite-friendly dynamic imports)
const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Reports = lazy(() => import("./pages/Reports"));
const UsdaMonthly = lazy(() => import("./pages/UsdaMonthly"));

// ─────────────────────────────────────────────────────────────
// AdminRoute — simple wrapper to guard admin-only routes
// ─────────────────────────────────────────────────────────────
function AdminRoute({ children }) {
  const { loading, isAdmin } = useAuth();
  if (loading) return <div className="p-6 text-sm text-gray-600">Loading…</div>;
  if (!isAdmin) return <Navigate to="/" replace />;
  return children;
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

        {/* Outside-shell catch-all → login */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
}
