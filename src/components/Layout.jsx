// src/components/Layout.jsx
import { Outlet, NavLink } from "react-router-dom";
import Navbar from "./Navbar.jsx";

export default function Layout() {
  const year = new Date().getFullYear();

  return (
    <div
      className="min-h-screen flex flex-col text-gray-900 selection:bg-brand-200/60 selection:text-gray-900"
      // Page background: align with the solid navbar color so there’s no seam
      style={{
        background:
          "linear-gradient(180deg, var(--brand-650, var(--brand-700)) 0px, var(--brand-600) 96px, var(--brand-600) 176px, #f7f7f7 360px, #fafafa 100%)",
      }}
    >
      {/* a11y: skip link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[10000] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow focus:outline-none focus:ring-2 focus:ring-brand-200"
      >
        Skip to main content
      </a>

      <Navbar />

      <main
        id="main-content"
        role="main"
        className="flex-1 outline-none"
        tabIndex={-1}
        aria-label="Main content"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto w-full max-w-7xl xl:max-w-[90rem] px-4 md:px-8 pt-4 md:pt-8 pb-24 md:pb-14">
          <section
            aria-label="Content"
            className="rounded-3xl bg-white p-4 sm:p-6 md:p-8 shadow-sm ring-1 ring-brand-100/70"
          >
            <Outlet />
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer
        role="contentinfo"
        className="
          w-full
          border-t border-[color:var(--brand-800)]
          bg-gradient-to-r from-[color:var(--brand-700)] to-[color:var(--brand-600)]
          text-white/90
        "
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto w-full max-w-7xl xl:max-w-[90rem] px-4 md:px-8 py-6 text-center text-[11px] sm:text-xs">
          {/* primary row */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2">
            <span>© {year} Shepherd’s Table Cloud</span>
            <span className="hidden sm:inline text-white/60" aria-hidden>
              •
            </span>
            <span className="text-white/90">by Brian Aiad</span>
          </div>

          {/* legal links row */}
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <NavLink
              to="/privacy"
              className="underline underline-offset-2 decoration-white/40 hover:decoration-white"
            >
              Privacy Policy
            </NavLink>
            <span className="text-white/50" aria-hidden>
              ·
            </span>
            <NavLink
              to="/terms"
              className="underline underline-offset-2 decoration-white/40 hover:decoration-white"
            >
              Terms of Service
            </NavLink>
          </div>

          {/* tiny compliance blurb (optional, CA-friendly “notice at collection” pointer) */}
          <p className="mt-2 text-[10px] text-white/70">
            We collect basic personal information solely for program eligibility, reporting, and
            service delivery. See our <NavLink to="/privacy" className="underline">Privacy Policy</NavLink> for details
            and requests.
          </p>
        </div>
      </footer>

      {/* smooth focus shadow on content card */}
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          main[role='main'] > div > section {
            transition: box-shadow 200ms;
          }
          main[role='main'] > div > section:focus-within {
            box-shadow: 0 6px 24px rgba(0,0,0,0.06);
          }
        }
      `}</style>
    </div>
  );
}
