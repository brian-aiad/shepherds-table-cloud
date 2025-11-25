// src/pages/Pricing.jsx
import { useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import logo from "../../assets/logo.png";


/**
 * Shepherds Table Cloud — Pricing (Nov 2025)
 * - Brand-aware hero (var(--brand-700/600/500))
 * - Monthly / Yearly toggle (2 months free on yearly)
 * - Three plans tuned to food-bank orgs
 * - Feature comparison table + FAQs
 * - Accessible, keyboard friendly, mobile-first
 */

const LOGO_SRC = `${import.meta.env.BASE_URL}logo.png`;

const PLANS = [
  {
    id: "starter",
    name: "Starter",
    blurb: "Everything you need to get organized at one site.",
    monthly: 39,
    // Yearly: 2 months free
    yearly: 39 * 10,
    highlight: false,
    cta: { label: "Start free setup", to: "/login" },
    includes: [
      "1 location",
      "Unlimited clients & visits",
      "Quick intake + volunteer sign-ins",
      "EFAP daily sheet export (PDF)",
      "Basic analytics",
      "Email support",
    ],
    limits: {
      locations: "1",
      admins: "2",
      volunteers: "Unlimited",
      storage: "5 GB forms & docs",
    },
  },
  {
    id: "growth",
    name: "Growth",
    blurb: "Multi-site reporting and exports that save hours monthly.",
    monthly: 89,
    yearly: 89 * 10,
    highlight: true, // Most popular
    cta: { label: "Start free setup", to: "/login" },
    includes: [
      "Up to 5 locations",
      "USDA monthly + EFAP exports (CSV/PDF)",
      "Unduplicated households (auto)",
      "Admin dashboard & charts",
      "Role-based access (admin/volunteer)",
      "Priority email support",
    ],
    limits: {
      locations: "Up to 5",
      admins: "5",
      volunteers: "Unlimited",
      storage: "25 GB forms & docs",
    },
  },
  {
    id: "pro",
    name: "Pro",
    blurb: "Unlimited scale, advanced controls, and white-glove onboarding.",
    monthly: 149,
    yearly: 149 * 10,
    highlight: false,
    cta: { label: "Request a demo", href: "mailto:support@shepherdstablecloud.com?subject=Pro%20Demo%20Request" },
    includes: [
      "Unlimited locations",
      "Custom reports & data exports",
      "Advanced audit logs",
      "SLA + phone support",
      "Personalized onboarding",
      "Quarterly data review",
    ],
    limits: {
      locations: "Unlimited",
      admins: "Unlimited",
      volunteers: "Unlimited",
      storage: "100 GB+ forms & docs",
    },
  },
];

const FEATURE_MATRIX = [
  { key: "locs", label: "Locations", values: ["1", "Up to 5", "Unlimited"] },
  { key: "clients", label: "Clients & visits", values: ["Unlimited", "Unlimited", "Unlimited"] },
  { key: "exports", label: "USDA & EFAP exports", values: ["EFAP daily (PDF)", "USDA monthly + EFAP (CSV/PDF)", "Custom exports included"] },
  { key: "dash", label: "Admin dashboard & charts", values: ["Basic", "Full", "Full + custom"] },
  { key: "users", label: "Admins / Volunteers", values: ["2 / Unlimited", "5 / Unlimited", "Unlimited / Unlimited"] },
  { key: "audit", label: "Audit logs", values: ["Basic", "Standard", "Advanced"] },
  { key: "support", label: "Support", values: ["Email", "Priority email", "SLA + phone"] },
  { key: "onboard", label: "Onboarding", values: ["Self-guided", "Guided session", "White-glove"] },
];

const FAQS = [
  {
    q: "Is there a setup fee?",
    a: "No. Setup and training are included for all plans.",
  },
  {
    q: "Can volunteers be limited to a single location?",
    a: "Yes. Volunteers only see and log visits for the locations you assign.",
  },
  {
    q: "Do you offer discounts for nonprofits?",
    a: "All plans are priced specifically for nonprofits. If budget is tight, contact us and we’ll work with you.",
  },
  {
    q: "Can we export our data?",
    a: "Absolutely. CSV and PDF exports are included. Pro adds custom export formats if you need something special.",
  },
  {
    q: "What about data privacy?",
    a: "Tenant isolation is enforced by role verification. We use Firebase Auth, Firestore Rules v2, App Check, and strict PII hygiene.",
  },
];

function currency(n) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function Pricing() {
  const [yearly, setYearly] = useState(true);
  const priceNote = yearly ? "billed yearly (2 months free)" : "billed monthly";

  const computedPlans = useMemo(() => {
    return PLANS.map((p) => ({
      ...p,
      price: yearly ? p.yearly : p.monthly,
      unit: yearly ? "/year" : "/month",
      perMonth: yearly ? p.yearly / 12 : p.monthly,
    }));
  }, [yearly]);

  return (
    <div className="min-h-dvh flex flex-col bg-white text-gray-900">
      {/* ======= Header (public) ======= */}
      <header
        className="relative z-10"
        style={{
          background: "linear-gradient(180deg, var(--brand-650, var(--brand-700)) 0%, var(--brand-600) 100%)",
        }}
      >
        <div className="mx-auto w-full max-w-7xl xl:max-w-[90rem] h-16 px-4 md:px-8 flex items-center gap-4 text-white">
          <NavLink
            to="/"
            className="inline-flex items-center gap-3 rounded-lg px-2 py-1 -ml-1 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            aria-label="Go to Dashboard"
          >
            <img
              src={LOGO_SRC}
              alt="Shepherd’s Table Cloud"
              className="h-10 w-10 rounded-md bg-white p-1.5 ring-1 ring-black/10 object-contain"
              referrerPolicy="no-referrer"
            />
            <span className="text-[18px] md:text-[20px] lg:text-[22px] font-semibold tracking-tight leading-[1.1]">
              Shepherd’s Table Cloud
            </span>
          </NavLink>

          <nav className="ml-auto hidden md:flex items-center gap-6 text-sm font-medium">
            <NavLink to="/about" className="hover:underline">
              About
            </NavLink>
            <NavLink to="/login" className="hover:underline">
              Login
            </NavLink>
          </nav>
        </div>
      </header>

      {/* ======= Hero ======= */}
      <section className="relative isolate overflow-hidden">
        {/* soft shapes */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{
            background:
              "radial-gradient(600px 260px at -8% -10%, rgba(199,58,49,.35), transparent 60%), radial-gradient(520px 240px at 108% 120%, rgba(199,58,49,.25), transparent 60%)",
          }}
        />
        <div className="mx-auto w-full max-w-7xl xl:max-w-[90rem] px-4 md:px-8 pt-10 md:pt-14">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">
              Simple, transparent pricing for food-bank organizations
            </h1>
            <p className="mt-3 text-base md:text-lg text-gray-600">
              All plans include setup, training, and exports for the reports you already submit.
            </p>
          </div>

          {/* Toggle */}
          <div className="mt-6 flex items-center justify-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-gray-100 p-1 ring-1 ring-black/10">
              <button
                className={`px-4 py-2 rounded-full text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200 ${
                  !yearly ? "bg-white shadow ring-1 ring-black/10" : "text-gray-600 hover:text-gray-800"
                }`}
                onClick={() => setYearly(false)}
                aria-pressed={!yearly}
              >
                Monthly
              </button>
              <button
                className={`px-4 py-2 rounded-full text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200 relative ${
                  yearly ? "bg-white shadow ring-1 ring-black/10" : "text-gray-600 hover:text-gray-800"
                }`}
                onClick={() => setYearly(true)}
                aria-pressed={yearly}
              >
                Yearly
                <span className="ml-2 inline-flex items-center rounded-full bg-green-600/10 text-green-700 text-[11px] font-semibold px-2 py-0.5 ring-1 ring-green-600/20">
                  2 months free
                </span>
              </button>
            </div>
          </div>
          <p className="mt-2 text-center text-xs text-gray-500">{priceNote}</p>

          {/* Plan cards */}
          <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6">
            {computedPlans.map((p) => {
              const isHot = p.highlight;
              return (
                <article
                  key={p.id}
                  className={[
                    "rounded-3xl border bg-white p-6 md:p-7 flex flex-col shadow-sm",
                    isHot ? "border-[color:var(--brand-500)] ring-1 ring-[color:var(--brand-200)]" : "border-gray-200",
                  ].join(" ")}
                >
                  {/* badge */}
                  {isHot && (
                    <div className="mb-3">
                      <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--brand-700)]/10 text-[color:var(--brand-700)] ring-1 ring-[color:var(--brand-700)]/20 px-2 py-0.5 text-[11px] font-semibold">
                        Most popular
                      </span>
                    </div>
                  )}

                  <h3 className="text-xl font-semibold text-[color:var(--brand-700)]">{p.name}</h3>
                  <p className="mt-1 text-sm text-gray-600">{p.blurb}</p>

                  <div className="mt-4 flex items-end gap-2">
                    <div className="text-3xl font-bold">{currency(p.price)}</div>
                    <div className="text-gray-500 font-medium">{p.unit}</div>
                  </div>
                  {yearly && (
                    <div className="text-xs text-gray-500">
                      ≈ {currency(Math.round(p.perMonth))} per month
                    </div>
                  )}

                  <ul className="mt-5 space-y-2 text-sm text-gray-800 flex-grow">
                    {p.includes.map((li) => (
                      <li key={li} className="flex items-start gap-2">
                        <svg className="mt-1 h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <path d="M5 13l4 4L19 7" strokeWidth="2" />
                        </svg>
                        <span>{li}</span>
                      </li>
                    ))}
                  </ul>

                  {/* CTA */}
                  {p.cta?.to ? (
                    <NavLink
                      to={p.cta.to}
                      className={[
                        "mt-6 inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold focus:outline-none focus-visible:ring-4",
                        isHot
                          ? "text-white shadow-sm"
                          : "text-white shadow-sm",
                      ].join(" ")}
                      style={{
                        background:
                          "linear-gradient(160deg, var(--brand-700) 0%, var(--brand-600) 55%, var(--brand-500) 100%)",
                      }}
                    >
                      {p.cta.label}
                    </NavLink>
                  ) : (
                    <a
                      href={p.cta?.href}
                      className="mt-6 inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm focus:outline-none focus-visible:ring-4"
                      style={{
                        background:
                          "linear-gradient(160deg, var(--brand-700) 0%, var(--brand-600) 55%, var(--brand-500) 100%)",
                      }}
                    >
                      {p.cta?.label}
                    </a>
                  )}

                  {/* Limits chip row */}
                  <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] text-gray-600">
                    <LimitChip label="Locations" value={p.limits.locations} />
                    <LimitChip label="Admins" value={p.limits.admins} />
                    <LimitChip label="Volunteers" value={p.limits.volunteers} />
                    <LimitChip label="Storage" value={p.limits.storage} />
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* ======= Comparison table ======= */}
      <section className="mt-10 md:mt-14">
        <div className="mx-auto w-full max-w-7xl xl:max-w-[90rem] px-4 md:px-8">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl md:text-2xl font-bold tracking-tight">Compare plans</h2>
            <a
              href="mailto:support@shepherdstablecloud.com?subject=Which%20plan%20is%20right%20for%20us%3F"
              className="text-sm font-semibold underline decoration-[color:var(--brand-400,#fca5a5)] underline-offset-4 hover:opacity-90"
            >
              Not sure? Ask us →
            </a>
          </div>

          <div className="mt-4 overflow-x-auto rounded-2xl ring-1 ring-black/10">
            <table className="min-w-[720px] w-full border-collapse bg-white">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left text-sm font-semibold text-gray-700 p-3">Feature</th>
                  <th className="text-left text-sm font-semibold text-gray-700 p-3">Starter</th>
                  <th className="text-left text-sm font-semibold text-gray-700 p-3">Growth</th>
                  <th className="text-left text-sm font-semibold text-gray-700 p-3">Pro</th>
                </tr>
              </thead>
              <tbody>
                {FEATURE_MATRIX.map((row, i) => (
                  <tr key={row.key} className={i % 2 ? "bg-white" : "bg-gray-50/50"}>
                    <td className="p-3 text-sm text-gray-800">{row.label}</td>
                    {row.values.map((v, idx) => (
                      <td key={idx} className="p-3 text-sm text-gray-800">{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* security + compliance blurb */}
          <div className="mt-4 text-xs text-gray-600">
            Tenant isolation via role verification; admins only write; volunteers restricted to assigned locations;
            scoped reads by org/location; App Check and HSTS/CSP enabled; auditable Firestore Rules v2 with master claim.
          </div>
        </div>
      </section>

      {/* ======= FAQ ======= */}
      <section className="mt-10 md:mt-14 mb-14 md:mb-20">
        <div className="mx-auto w-full max-w-7xl xl:max-w-[90rem] px-4 md:px-8">
          <h2 className="text-xl md:text-2xl font-bold tracking-tight">Frequently asked questions</h2>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            {FAQS.map((f) => (
              <details
                key={f.q}
                className="group rounded-2xl border border-gray-200 bg-white p-4 open:shadow-sm open:ring-1 open:ring-brand-100/70"
              >
                <summary className="cursor-pointer list-none select-none">
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="text-sm md:text-base font-semibold">{f.q}</h3>
                    <svg
                      className="mt-1 h-5 w-5 shrink-0 transition-transform group-open:rotate-180"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                    >
                      <path d="M6 9l6 6 6-6" strokeWidth="2" />
                    </svg>
                  </div>
                </summary>
                <p className="mt-2 text-sm text-gray-700">{f.a}</p>
              </details>
            ))}
          </div>

          {/* big CTA */}
          <div className="mt-8 flex flex-col items-center justify-center text-center">
            <h3 className="text-lg md:text-xl font-semibold">Ready to save time on reporting?</h3>
            <p className="mt-1 text-sm text-gray-600">
              We’ll migrate your existing sheets and get your team trained this week.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              <NavLink
                to="/login"
                className="inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm focus:outline-none focus-visible:ring-4"
                style={{
                  background:
                    "linear-gradient(160deg, var(--brand-700) 0%, var(--brand-600) 55%, var(--brand-500) 100%)",
                }}
              >
                Start free setup
              </NavLink>
              <a
                href="mailto:support@shepherdstablecloud.com?subject=Request%20a%20Demo"
                className="inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold ring-1 ring-black/10 hover:bg-gray-50"
              >
                Request a demo
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ======= Footer (compact public) ======= */}
      <footer
        className="mt-auto border-t"
        style={{
          background:
            "linear-gradient(180deg, var(--brand-650, var(--brand-700)) 0%, var(--brand-600) 100%)",
        }}
      >
        <div className="mx-auto w-full max-w-7xl xl:max-w-[90rem] px-4 md:px-8 py-4 md:py-6 text-center text-white/90 text-[12px]">
          <div>© {new Date().getFullYear()} Shepherd’s Table Cloud — All rights reserved.</div>
          <div className="mt-1 flex items-center justify-center gap-3">
            <NavLink
              to="/privacy"
              className="underline underline-offset-2 decoration-white/40 hover:decoration-white"
            >
              Privacy
            </NavLink>
            <span aria-hidden className="opacity-60">·</span>
            <NavLink
              to="/terms"
              className="underline underline-offset-2 decoration-white/40 hover:decoration-white"
            >
              Terms
            </NavLink>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ---------- tiny UI helpers ---------- */
function LimitChip({ label, value }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1">
      <span className="text-[11px] font-semibold text-gray-700">{label}</span>
      <span className="text-[11px] text-gray-600">•</span>
      <span className="text-[11px] text-gray-600">{value}</span>
    </div>
  );
}
