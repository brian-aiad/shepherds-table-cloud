// src/pages/Login.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from "firebase/auth";
import { auth } from "../../lib/firebase";

export default function Login() {
  const nav = useNavigate();

  // form state
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [capsLock, setCapsLock] = useState(false);

  // refs
  const emailRef = useRef(null);
  const pwRef = useRef(null);

  // normalize email
  const emailClean = useMemo(() => email.trim().toLowerCase(), [email]);

  // already signed in? go home
  useEffect(() => {
    const off = onAuthStateChanged(auth, (u) => {
      if (u) nav("/", { replace: true });
    });
    return () => off();
  }, [nav]);

  // autofocus first empty field
  useEffect(() => {
    const el = emailClean ? pwRef.current : emailRef.current;
    el?.focus();
  }, []); // on mount

  function mapAuthError(e) {
    const code = e?.code || "";
    if (code.includes("invalid-credential") || code.includes("wrong-password")) {
      return "That email or password didn’t work. Please try again.";
    }
    if (code.includes("user-not-found")) return "No account found for that email.";
    if (code.includes("too-many-requests"))
      return "Too many attempts. Please wait a moment and try again.";
    if (code.includes("network-request-failed"))
      return "Network error. Check your connection and try again.";
    return "Couldn’t sign you in. Please try again.";
  }

  async function submit(e) {
    e?.preventDefault?.();
    if (busy) return;
    setErr("");
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, emailClean, pw);
      nav("/", { replace: true });
    } catch (e) {
      setErr(mapAuthError(e));
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    if (!emailClean) {
      setErr('Enter your email above, then tap “Forgot password?”.');
      return;
    }
    if (busy) return;
    setErr("");
    try {
      await sendPasswordResetEmail(auth, emailClean);
      setErr("Password reset email sent. Check your inbox.");
    } catch {
      setErr("Couldn’t send reset email. Double-check the address.");
    }
  }

  // Caps Lock hint
  function onPwKeyEvent(e) {
    if (typeof e.getModifierState === "function") {
      setCapsLock(!!e.getModifierState("CapsLock"));
    }
  }

  const logoSrc = `${import.meta.env.BASE_URL}logo.png`;

  return (
    <div className="min-h-screen bg-[#FFE6EB] text-gray-900">
      <div className="grid min-h-screen lg:grid-cols-2">
        {/* Left brand panel — matches app brand / Navbar vibe (desktop only) */}
        <aside className="relative hidden overflow-hidden text-white lg:flex">
          {/* Base gradient */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(160deg, var(--brand-700) 0%, var(--brand-650, var(--brand-600)) 55%, var(--brand-500) 100%)",
            }}
            aria-hidden
          />
          {/* Sheen lights */}
          <div
            className="absolute inset-0 opacity-30"
            style={{
              background:
                "radial-gradient(900px 420px at -10% 0%, rgba(255,255,255,.55), transparent 65%), radial-gradient(780px 380px at 115% 105%, rgba(255,255,255,.38), transparent 65%)",
            }}
            aria-hidden
          />

          <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-col justify-center gap-7 px-10 xl:px-14 2xl:px-20">
            {/* Brand lockup with zoomed-in logo */}
            <div className="inline-flex items-center gap-4">
              <div className="relative shrink-0">
                <img
                  src={logoSrc}
                  alt="Shepherds Table Cloud"
                  className="h-16 w-16 rounded-[1.6rem] bg-white p-[2px] object-contain shadow-[0_10px_30px_rgba(0,0,0,.35)] ring-1 ring-white/40"
                  loading="eager"
                />
              </div>
              <div className="flex flex-col">
                <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
                  Shepherds Table Cloud
                </h1>
                <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.22em] text-white/80">
                  Mobile tools for food banks
                </p>
              </div>
            </div>

            <p className="max-w-xl text-sm leading-relaxed text-white/95 md:text-base">
              Mobile-first tools for multi-organization food banks. Sign in to
              serve, track visits, and keep today running smoothly.
            </p>

            <ul className="mt-1.5 space-y-2 text-sm text-white/95">
              <li className="flex items-center gap-2">
                <CheckIcon />
                Multi-tenant org &amp; location scoping
              </li>
              <li className="flex items-center gap-2">
                <CheckIcon />
                Fast intake, deduped clients, visit logs
              </li>
              <li className="flex items-center gap-2">
                <CheckIcon />
                USDA / EFAP monthly reporting
              </li>
            </ul>
          </div>
        </aside>

        {/* Right form column */}
        <main className="flex justify-center items-start lg:items-center px-4 pt-10 pb-12 sm:pt-16 sm:pb-10 lg:px-8 lg:py-0">
          <div className="w-full max-w-[480px]">
            {/* Mobile brand header (since left panel is hidden) */}
            <div className="mb-5 flex items-center justify-center gap-3 sm:mb-7 lg:hidden">
              <div className="relative shrink-0">
                <img
                  src={logoSrc}
                  alt="Shepherds Table Cloud"
                  className="h-11 w-11 rounded-2xl bg-white p-[1px] object-contain shadow-md ring-1 ring-black/10"
                  loading="eager"
                />
              </div>
              <div className="leading-tight text-center">
                <div className="text-[17px] font-semibold text-[color:var(--brand-700)]">
                  Shepherds Table Cloud
                </div>
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--brand-600)]">
                  Staff sign in
                </div>
              </div>
            </div>

            {/* Sign-in card */}
            <section className="overflow-hidden rounded-[1.75rem] bg-white ring-1 ring-black/10 shadow-[0_18px_60px_-22px_rgba(0,0,0,.40)]">
              {/* Top accent strip */}
              <div
                className="h-1.5 w-full"
                style={{
                  background:
                    "linear-gradient(90deg, var(--brand-700) 0%, var(--brand-600) 50%, var(--brand-500) 100%)",
                }}
              />

              {/* Card header */}
              <header className="border-b border-gray-100 px-7 pb-4 pt-6 sm:px-9 sm:pt-7">
                <div className="flex items-center gap-3">
                  <div className="relative shrink-0">
                    <img
                      src={logoSrc}
                      alt="Shepherds Table Cloud"
                      className="h-11 w-11 rounded-2xl bg-[color:var(--brand-50)] p-[2px] object-contain ring-1 ring-[color:var(--brand-200)]"
                      loading="lazy"
                    />
                  </div>
                  <div className="leading-tight">
                    <div className="text-[18px] font-semibold text-[color:var(--brand-700)]">
                      Shepherds Table Cloud
                    </div>
                    <div className="text-xs text-gray-500">Staff sign in</div>
                  </div>
                </div>
              </header>

              {/* Alerts */}
              {err && (
                <div
                  role="alert"
                  className="mx-7 mt-4 rounded-lg bg-[color:var(--brand-50)] px-3 py-2 text-sm text-[color:var(--brand-900)] ring-1 ring-[color:var(--brand-200)] sm:mx-9"
                >
                  {err}
                </div>
              )}

              {/* Form */}
              <form
                onSubmit={submit}
                className="space-y-5 px-7 py-7 sm:px-9"
                noValidate
              >
                {/* Email */}
                <div>
                  <label
                    htmlFor="email"
                    className="block text-sm font-medium text-gray-800"
                  >
                    Email
                  </label>
                  <input
                    id="email"
                    ref={emailRef}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={busy}
                    className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3.5 py-3 text-[15px] shadow-sm placeholder:text-gray-400 focus:outline-none focus:border-[color:var(--brand-500)] focus:ring-4 focus:ring-[color:var(--brand-200)] disabled:opacity-60"
                    placeholder="you@example.org"
                    aria-invalid={!!err && !emailClean ? "true" : "false"}
                  />
                </div>

                {/* Password */}
                <div>
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="password"
                      className="block text-sm font-medium text-gray-800"
                    >
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={forgot}
                      disabled={busy}
                      className="text-sm font-medium text-[color:var(--brand-700)] hover:text-[color:var(--brand-800)] disabled:opacity-60"
                    >
                      Forgot password?
                    </button>
                  </div>

                  <div className="relative mt-1">
                    <input
                      id="password"
                      ref={pwRef}
                      type={showPw ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      value={pw}
                      onChange={(e) => setPw(e.target.value)}
                      onKeyUp={onPwKeyEvent}
                      onKeyDown={onPwKeyEvent}
                      onKeyPress={onPwKeyEvent}
                      disabled={busy}
                      className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-3 pr-12 text-[15px] shadow-sm placeholder:text-gray-400 focus:outline-none focus:border-[color:var(--brand-500)] focus:ring-4 focus:ring-[color:var(--brand-200)] disabled:opacity-60"
                      placeholder="••••••••"
                      aria-describedby={capsLock ? "caps-hint" : undefined}
                    />

                    {/* Toggle visibility */}
                    <button
                      type="button"
                      aria-label={showPw ? "Hide password" : "Show password"}
                      title={showPw ? "Hide password" : "Show password"}
                      onClick={() => setShowPw((v) => !v)}
                      disabled={busy}
                      className="absolute inset-y-0 right-0 my-1.5 mr-1.5 grid place-items-center rounded-md px-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-60"
                    >
                      <EyeIcon open={showPw} />
                    </button>
                  </div>

                  {capsLock && (
                    <div id="caps-hint" className="mt-1 text-xs text-amber-700">
                      Caps Lock is on.
                    </div>
                  )}
                </div>

                {/* Submit — same brand gradient as Navbar */}
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3.5 text-base font-semibold text-white shadow-sm transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--brand-200)] disabled:opacity-60"
                  style={{
                    background:
                      "linear-gradient(160deg, var(--brand-700) 0%, var(--brand-650, var(--brand-600)) 55%, var(--brand-500) 100%)",
                  }}
                >
                  {busy ? (
                    <>
                      <Spinner />
                      Signing in…
                    </>
                  ) : (
                    "Sign in"
                  )}
                </button>
              </form>

              {/* Card footer */}
              <footer className="px-7 pb-7 text-xs text-gray-500 sm:px-9">
                <p>
                  By signing in you agree to Shepherds Table Cloud’s{" "}
                  <Link
                    to="/usage"
                    className="text-[color:var(--brand-700)] hover:text-[color:var(--brand-800)]"
                  >
                    usage policy
                  </Link>
                  .
                </p>
              </footer>
            </section>

            {/* Site footer */}
            <div className="mt-5 text-center text-[11px] text-gray-500 sm:mt-6">
              © {new Date().getFullYear()} Shepherds Table Cloud
              <div className="mt-1">By Brian Aiad</div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

/* =========================
   Tiny inline icons / UI
========================= */

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        fill="none"
        opacity=".25"
      />
      <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" />
    </svg>
  );
}

function EyeIcon({ open }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-5 w-5"
      aria-hidden="true"
    >
      {open ? (
        <>
          <path d="M3 3l18 18" />
          <path d="M10.6 10.6a2 2 0 002.8 2.8" />
          <path d="M9.88 4.24A10.94 10.94 0 0121 12c-.66 1.14-1.51 2.16-2.5 3.02M6.5 6.5C4.98 7.8 3.74 9.31 3 12c.66 1.14 1.51 2.16 2.5 3.02A10.94 10.94 0 0012 21c1.63 0 3.17-.33 4.57-.94" />
        </>
      ) : (
        <>
          <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4 flex-none"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8.5 13.3l-3-3a1 1 0 011.4-1.4l1.9 1.9 4.3-4.3a1 1 0 111.4 1.4l-5 5a1 1 0 01-1.4 0z" />
    </svg>
  );
}
