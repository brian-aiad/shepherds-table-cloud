// src/App.jsx
// Shepherds Table Cloud — App Router (Nov 2025)
// - React Router v6 with Suspense + lazy routes
// - Protected shell for all authenticated pages
// - Capability-based guards per route
// - Auth-aware NotFound
// - Updated paths for new folder structure

import { Routes, Route, Navigate } from "react-router-dom";
import { Suspense, lazy } from "react";

import ProtectedRoute from "./auth/ProtectedRoute";
import Layout from "./components/Layout";

// Static import (legal page required at build-time)
import UsagePolicy from "./pages/legal/UsagePolicy.jsx";

// ─────────────────────────────────────────────────────────────
// Lazy-loaded pages with UPDATED PATHS
// ─────────────────────────────────────────────────────────────

// Auth
const Login = lazy(() => import("./pages/auth/Login.jsx"));

// App (protected)
const Dashboard = lazy(() => import("./pages/app/Dashboard.jsx"));
const Inventory = lazy(() => import("./pages/app/Inventory.jsx"));
const Donations = lazy(() => import("./pages/app/Donations.jsx"));
const Reports = lazy(() => import("./pages/app/Reports.jsx"));
const UsdaMonthly = lazy(() => import("./pages/app/UsdaMonthly.jsx"));

// Master-only admin console
const MasterConsole = lazy(
  () => import("./pages/app/Admin/MasterConsole.jsx")
);

// Public marketing
const About = lazy(() => import("./pages/public/About.jsx"));
const Pricing = lazy(() => import("./pages/public/Pricing.jsx"));

// Legal
const PrivacyPolicy = lazy(() => import("./pages/legal/PrivacyPolicy.jsx"));
const TermsOfService = lazy(() => import("./pages/legal/TermsOfService.jsx"));

// ─────────────────────────────────────────────────────────────
// AuthAwareNotFound
// ─────────────────────────────────────────────────────────────
function AuthAwareNotFound() {
  return <Navigate to="/login" replace />;
}

// Shared Suspense fallback
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
        {/* ───── Public Marketing ───── */}
        <Route path="/about" element={<About />} />
        <Route path="/pricing" element={<Pricing />} />

        {/* ───── Auth & Legal ───── */}
        <Route path="/login" element={<Login />} />
        <Route path="/usage" element={<UsagePolicy />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<TermsOfService />} />

        {/* ───── Protected App Shell ───── */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          {/* Dashboard (default) */}
          <Route
            index
            element={
              <ProtectedRoute capability="dashboard">
                <Dashboard />
              </ProtectedRoute>
            }
          />

          {/* Inventory */}
          <Route
            path="inventory"
            element={
              <ProtectedRoute capability="inventory">
                <Inventory />
              </ProtectedRoute>
            }
          />

          {/* Donations */}
          <Route
            path="donations"
            element={
              <ProtectedRoute capability="donations">
                <Donations />
              </ProtectedRoute>
            }
          />

          {/* Reports */}
          <Route
            path="reports"
            element={
              <ProtectedRoute capability="viewReports">
                <Reports />
              </ProtectedRoute>
            }
          />

          {/* USDA Monthly */}
          <Route
            path="usda-monthly"
            element={
              <ProtectedRoute capability="viewReports">
                <UsdaMonthly />
              </ProtectedRoute>
            }
          />

          {/* Master Console (global super admin) */}
          <Route
            path="app/admin/master-console"
            element={
              <ProtectedRoute requireMaster>
                <MasterConsole />
              </ProtectedRoute>
            }
          />

          {/* In-shell catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>

        {/* ───── Outer catch-all ───── */}
        <Route path="*" element={<AuthAwareNotFound />} />
      </Routes>
    </Suspense>
  );
}
