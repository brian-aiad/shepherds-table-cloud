// src/App.jsx
// Shepherds Table Cloud — App Router (Nov 2025)
// - React Router v6 with Suspense + lazy routes
// - Protected shell for all authenticated pages
// - Capability-based guards per route (dashboard, reports, etc.)
// - Auth-aware NotFound: unauth → /login, authed → /
// - Public marketing + legal pages included (about/pricing/privacy/terms/usage)

import { Routes, Route, Navigate } from "react-router-dom";
import { Suspense, lazy } from "react";

import ProtectedRoute from "./auth/ProtectedRoute";
import Layout from "./components/Layout";
import UsagePolicy from "./pages/UsagePolicy.jsx";

// Lazy-loaded pages (Vite-friendly)
const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Reports = lazy(() => import("./pages/Reports"));
const UsdaMonthly = lazy(() => import("./pages/UsdaMonthly"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const TermsOfService = lazy(() => import("./pages/TermsOfService"));
const About = lazy(() => import("./pages/About"));
const Pricing = lazy(() => import("./pages/Pricing"));

// ─────────────────────────────────────────────────────────────
// AuthAwareNotFound — redirect based on auth state
//  • unauthenticated → /login
//  • authenticated   → /
// ─────────────────────────────────────────────────────────────
function AuthAwareNotFound() {
  // useAuth is read inside ProtectedRoute, so here we do a simple auth-aware redirect:
  // If ProtectedRoute isn't mounted, fall back to sending the user to /login.
  // This keeps the catch-all simple and avoids importing auth state here.
  return <Navigate to="/login" replace />;
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
        {/* ───── Public marketing routes ───── */}
        <Route path="/about" element={<About />} />
        <Route path="/pricing" element={<Pricing />} />

        {/* ───── Public legal & auth routes ───── */}
        <Route path="/login" element={<Login />} />
        <Route path="/usage" element={<UsagePolicy />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<TermsOfService />} />

        {/* ───── Protected application shell ───── */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          {/* Default Dashboard (capability-based) */}
          <Route
            index
            element={
              <ProtectedRoute capability="dashboard">
                <Dashboard />
              </ProtectedRoute>
            }
          />

          {/* Reports (capability-based) */}
          <Route
            path="reports"
            element={
              <ProtectedRoute capability="viewReports">
                <Reports />
              </ProtectedRoute>
            }
          />

          {/* USDA Monthly (capability-based; grouped with reports) */}
          <Route
            path="usda-monthly"
            element={
              <ProtectedRoute capability="viewReports">
                <UsdaMonthly />
              </ProtectedRoute>
            }
          />

          {/* In-shell catch-all → home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>

        {/* ───── Outside-shell catch-all → auth-aware redirect ───── */}
        <Route path="*" element={<AuthAwareNotFound />} />
      </Routes>
    </Suspense>
  );
}
