// src/components/Layout.jsx
import { Outlet } from "react-router-dom";
import Navbar from "./Navbar.jsx";

export default function Layout() {
  const year = new Date().getFullYear();
  return (
    <div className="min-h-screen flex flex-col bg-neutral-50 text-gray-900">
      <Navbar />
      <main id="main-content" role="main" className="flex-1">
        {/* widen content container + more padding for air */}
        <div className="mx-auto w-full max-w-7xl xl:max-w-[90rem] px-4 md:px-8 pt-4 md:pt-8 pb-24 md:pb-14">
          <section
            aria-label="Content"
            className="rounded-3xl bg-white p-4 sm:p-6 md:p-8 shadow-sm ring-1 ring-brand-200"
          >
            <Outlet />
          </section>
        </div>
      </main>
      <footer
        role="contentinfo"
        className="w-full border-t border-brand-100 bg-white/95 backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto w-full max-w-7xl xl:max-w-[90rem] px-4 md:px-8 py-6 text-center text-[11px] sm:text-xs text-gray-500">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2">
            <span>© {year} Shepherd’s Table Cloud</span>
            <span className="hidden sm:inline">•</span>
            <span>by Brian Aiad</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
