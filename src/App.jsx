// src/App.jsx
// Notes:
// - Uses ProtectedRoute for all authed pages.
// - AdminRoute wraps /reports and /usda-monthly to require isAdmin.
// - Layout provides the navbar/shell for authed pages.
// - Includes a safe fallback for lazy content and a catch-all redirect.

import { Routes, Route, Navigate } from "react-router-dom";
import ProtectedRoute from "./auth/ProtectedRoute";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Reports from "./pages/Reports";
import Layout from "./components/Layout";
import UsdaMonthly from "./pages/UsdaMonthly";
import useAuth from "./auth/useAuth";

function AdminRoute({ children }) {
  const { loading, isAdmin } = useAuth();
  if (loading) return <div className="p-6 text-sm text-gray-600">Loading…</div>;
  if (!isAdmin) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<Login />} />

      {/* Authed shell */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        {/* Default dashboard */}
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

        {/* In-shell catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>

      {/* Outside-shell catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
