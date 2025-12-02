// src/main.jsx
// Shepherds Table Cloud — Root bootstrap (Dec 2025)
// - Adds .app-ready class to hide static HTML fallback
// - Wraps React app with BrowserRouter and AuthProvider
// - Includes hydration-safe guards and future SRR compatibility

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import AuthProvider from "./auth/AuthProvider";
import "./index.css";

// Hide static "Loading Shepherds Table Cloud..." message (hydration-safe)
if (typeof document !== "undefined" && document.body) {
  document.body.classList.add("app-ready");
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error('Missing <div id="root"></div> in index.html');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    {/* 
      NOTE:
      If you ever deploy to a subpath instead of root (example: /stc/),
      enable: <BrowserRouter basename="/stc">
    */}
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
