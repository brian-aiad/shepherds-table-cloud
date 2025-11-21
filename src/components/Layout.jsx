import { Outlet, NavLink } from "react-router-dom";
import Navbar from "./Navbar.jsx";

export default function Layout() {
  const year = new Date().getFullYear();

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
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 88px)",
        }}
      >
        <div
          className="
            mx-auto w-full
            max-w-7xl xl:max-w-[90rem]
            px-3 sm:px-4 md:px-8
            pt-3 md:pt-6
          "
        >
          {/* CONTENT CARD – looser on mobile so inner sections can breathe */}
          <section
            aria-label="Content"
            className="
              rounded-3xl bg-white
              p-2.5 sm:p-4 md:p-7
              shadow-sm ring-1 ring-brand-100/70
            "
          >
            <Outlet />
          </section>

          <div className="h-8 md:h-6" />
        </div>
      </main>

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
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 10px)",
        }}
      >
        <div
          className="
            mx-auto w-full max-w-7xl xl:max-w-[90rem]
            px-3 sm:px-4 md:px-8
            py-4 md:py-6
            text-center text-[12px] sm:text-xs
          "
        >
          <div className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2">
            <span>© {year} Shepherd’s Table Cloud</span>
            <span className="hidden sm:inline text-white/60" aria-hidden>
              •
            </span>
            <span className="text-white/90">by Brian Aiad</span>
          </div>

          <div className="mt-1.5 sm:mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
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

          <p className="mt-2 text-[10px] text-white/70 max-w-3xl mx-auto">
            We collect basic personal information solely for program eligibility, reporting, and
            service delivery. See our{" "}
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
