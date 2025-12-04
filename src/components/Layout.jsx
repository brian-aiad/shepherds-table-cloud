// src/components/Layout.jsx
import { Outlet, NavLink } from "react-router-dom";
import Navbar from "./Navbar.jsx";
import { useAuth } from "../auth/useAuth";

export default function Layout() {
  const year = new Date().getFullYear();
  const { isMaster, email } = useAuth();

  // Only show for master (and your email as a fallback)
  const showMasterConsole = isMaster || email === "csbrianaiad@gmail.com";

  return (
    <div
      className="min-h-dvh flex flex-col text-gray-900 selection:bg-brand-200/60 selection:text-gray-900"
      style={{
        background:
          "linear-gradient(180deg, var(--brand-650, var(--brand-700)) 0px, var(--brand-600) 104px, var(--brand-600) 200px, #f6f7f8 360px, #fafafa 100%)",
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

      {/* MAIN */}
      <main
        id="main-content"
        role="main"
        tabIndex={-1}
        aria-label="Main content"
        className="flex-1 outline-none overscroll-contain"
        style={{
          // extra padding so content doesn’t fight the mobile quick-access bar
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 120px)",
        }}
      >
        <div
          className="
            mx-auto w-full
            max-w-7xl xl:max-w-[90rem]
            px-2 sm:px-4 md:px-8
            pt-3 md:pt-6
          "
        >
          {/* CONTENT CARD – looser on mobile so inner sections can breathe */}
          <section
            aria-label="Content"
            className="
              rounded-2xl sm:rounded-3xl bg-white
              p-2 sm:p-4 md:p-7
              shadow-sm ring-1 ring-brand-100/70
            "
          >
            <Outlet />
          </section>

          <div className="h-8 md:h-6" />
        </div>
      </main>

      {/* FLOATING MASTER BUTTON (MOBILE ONLY, ABOVE QUICK BAR) */}
      {showMasterConsole && (
        <NavLink
          to="/app/admin/master-console"
          className="
            fixed md:hidden
            right-3
            bottom-[calc(env(safe-area-inset-bottom,0px)+96px)]
            z-30
            inline-flex items-center gap-1.5
            rounded-full
            bg-brand-50/95
            px-3.5 py-1.5
            text-[11px] font-semibold
            text-brand-800
            shadow-lg shadow-black/25
            border border-white/80
            backdrop-blur-sm
          "
        >
          <span
            className="h-1.5 w-1.5 rounded-full bg-emerald-400"
            aria-hidden
          />
          <span>Master console</span>
        </NavLink>
      )}

      {/* FOOTER */}
      <footer
        role="contentinfo"
        className="
          w-full
          border-t border-[color:var(--brand-800)]
          bg-gradient-to-r from-[color:var(--brand-700)] to-[color:var(--brand-600)]
          text-white/90
          shadow-[0_-1px_0_rgba(255,255,255,0.06)_inset]
        "
        style={{
          // a bit of extra height so it peeks nicely above the mobile bar
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 18px)",
        }}
      >
        <div
          className="
            mx-auto w-full max-w-7xl xl:max-w-[90rem]
            px-3 sm:px-4 md:px-8
            pt-4 pb-6 md:py-6
            text-[12px] sm:text-xs
          "
        >
          {/* Top row: branding + master console (desktop) */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex flex-col items-center md:items-start gap-1">
              <div className="flex flex-row items-center gap-1 sm:gap-2">
                <span>© {year} Shepherd’s Table Cloud</span>
                <span className="hidden sm:inline text-white/60" aria-hidden>
                  •
                </span>
                <span className="text-white/90">by Brian Aiad</span>
              </div>
              <p className="mt-0.5 text-[10px] text-white/75 max-w-xl text-center md:text-left">
                We collect basic personal information solely for program
                eligibility, reporting, and service delivery.
              </p>
            </div>

            {showMasterConsole && (
              <NavLink
                to="/app/admin/master-console"
                className="
                  hidden md:inline-flex
                  items-center gap-1.5
                  rounded-full border border-white/40
                  bg-white/10 px-4 py-1.5
                  text-[11px] font-semibold text-white
                  hover:bg-white/20 hover:border-white
                  transition-colors
                "
              >
                <span
                  className="h-1.5 w-1.5 rounded-full bg-emerald-300"
                  aria-hidden
                />
                <span>Master console</span>
              </NavLink>
            )}
          </div>

          {/* Legal links */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
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

          {/* Disclaimer line */}
          <p className="mt-2 text-[10px] text-white/70 max-w-3xl mx-auto text-center">
            See our{" "}
            <NavLink to="/privacy" className="underline">
              Privacy Policy
            </NavLink>{" "}
            for details and requests.
          </p>
        </div>
      </footer>

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