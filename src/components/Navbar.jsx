// src/components/Navbar.jsx
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { NavLink, useNavigate, useLocation as useRouteLoc } from "react-router-dom";
import { useAuth } from "../auth/useAuth";

/**
 * Shepherds Table Cloud — Navbar (Oct 2025)
 * Fixes:
 *  - On org change, auto-select first location (in-memory) instead of persisting null.
 *  - Do NOT persist scope automatically; add explicit “Make default on this device”.
 *  - Safer popovers, a11y, and brand styles.
 */

export default function Navbar() {
  const nav = useNavigate();
  const route = useRouteLoc();

  const {
    email,
    role,
    org,
    orgs = [],
    location,
    locations = [],
    isAdmin,
    loading,
    setActiveOrg,
    setActiveLocation,
    signOutNow,
    // New optional API on the hook; if absent we no-op in handlers.
    saveDeviceDefaultScope,
  } = useAuth() || {};

  // ── UI state ───────────────────────────────────────────────────────────
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => setMobileOpen(false), [route.pathname]);

  const [contextOpen, setContextOpen] = useState(false);
  useEffect(() => setContextOpen(false), [route.pathname]);

  const [orgOpen, setOrgOpen] = useState(false);
  const [locOpen, setLocOpen] = useState(false);

  const orgBtnRef = useRef(null);
  const orgMenuRef = useRef(null);
  const locBtnRef = useRef(null);
  const locMenuRef = useRef(null);

  const orgId = org?.id || "";
  const locId = location?.id || "";

  // ── Identity chips ─────────────────────────────────────────────────────
  const initials = useMemo(() => {
    if (!email) return "ST";
    const left = email.split("@")[0];
    return left
      .split(/[._\-]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() || "")
      .join("")
      .padEnd(2, " ")
      .slice(0, 2);
  }, [email]);

  const roleBadge = useMemo(() => {
    if (!role) return null;
    const label = role === "admin" ? "Admin" : "Volunteer";
    return (
      <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-white/20 ring-1 ring-white/30 text-white select-none">
        {label}
      </span>
    );
  }, [role]);

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleOrgChange = useCallback(
    async (nextOrgId) => {
      // Change org (local context only)
      await setActiveOrg(nextOrgId || null);
      // Close menus
      setOrgOpen(false);
      setLocOpen(false);
      // We auto-pick a location in an effect once locations hydrate for the new org.
    },
    [setActiveOrg]
  );

  const handleLocChange = useCallback(
    async (nextLocId) => {
      // Update local context only; do not persist to Firestore
      if (!nextLocId && !isAdmin) {
        // Never allow null for volunteers; silently ignore.
        return;
      }
      await setActiveLocation(nextLocId || null);
      setLocOpen(false);
    },
    [setActiveLocation, isAdmin]
  );

  const handleSaveDefault = useCallback(async () => {
    try {
      if (typeof saveDeviceDefaultScope === "function") {
        await saveDeviceDefaultScope();
        showToast("Default saved for this device.");
      } else {
        // Fallback no-op with user feedback
        showToast("Defaults not available yet in this build.");
      }
    } catch {
      showToast("Couldn’t save default. Try again.");
    }
  }, [saveDeviceDefaultScope]);

  const onSignOut = async () => {
    await signOutNow();
    nav("/login", { replace: true });
  };

  // ── Click outside + ESC for popovers ───────────────────────────────────
  useEffect(() => {
    const onDocClick = (e) => {
      if (orgOpen) {
        if (!orgBtnRef.current?.contains(e.target) && !orgMenuRef.current?.contains(e.target)) setOrgOpen(false);
      }
      if (locOpen) {
        if (!locBtnRef.current?.contains(e.target) && !locMenuRef.current?.contains(e.target)) setLocOpen(false);
      }
    };
    const onEsc = (e) => {
      if (e.key === "Escape") {
        setOrgOpen(false);
        setLocOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [orgOpen, locOpen]);

  // ── Auto-select first location after org changes (no persistence) ──────
  useEffect(() => {
    // If we have an org selected, and there are locations, and no location is currently set,
    // auto-select the first location. This runs AFTER the locations array hydrates for the new org.
    if (!loading && orgId && locations.length > 0 && !locId) {
      // Choose the first active location (array already filtered by org in your auth context).
      const first = locations[0];
      if (first?.id) {
        setActiveLocation(first.id); // local-only update; no Firestore writes here
      }
    }
  }, [loading, orgId, locId, locations, setActiveLocation]);

  // ── Desktop list (admins can choose “All locations”; volunteers can’t) ──
  const desktopLocations = useMemo(() => {
    if (!orgId) return [];
    const base = locations;
    return isAdmin ? [{ id: "", name: "All locations" }, ...base] : base;
  }, [locations, orgId, isAdmin]);

  // ── Tiny toast for “saved default” message ─────────────────────────────
  const [toast, setToast] = useState(null);
  function showToast(msg, ms = 1800) {
    setToast(msg);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(null), ms);
  }

  return (
    <header className="sticky top-0 z-40 shadow-md">
      {/* Toast */}
      {toast && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[9999]">
          <div className="rounded-lg bg-gray-900 text-white text-sm px-3 py-1.5 shadow-lg border border-brand-300">
            {toast}
          </div>
        </div>
      )}


     {/* ===== Top brand bar ===== */}
      <div
        className="relative w-full shadow-insetTop border-b border-black/10"
        style={{
          background:
            "linear-gradient(160deg, var(--brand-700) 0%, var(--brand-600) 55%, var(--brand-500) 100%)",
        }}
      >
        {/* soft highlight accents (match Login) */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{
            background:
              "radial-gradient(600px 260px at -8% -10%, rgba(255,255,255,.45), transparent 60%), radial-gradient(520px 240px at 108% 120%, rgba(255,255,255,.35), transparent 60%)",
          }}
        />

        {/* Top bar content */}
        <div className="mx-auto w-full max-w-7xl xl:max-w-[90rem] h-16 px-4 md:px-8 flex items-center gap-4">
          {/* Mobile hamburger */}
          <button
            type="button"
            className="sm:hidden inline-flex h-10 w-10 items-center justify-center rounded-lg ring-1 ring-white/25 hover:bg-white/10 active:bg-white/15 text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            aria-controls="nav-panel"
            onClick={() => setMobileOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              {mobileOpen ? <path d="M6 6l12 12M6 18L18 6" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>

          {/* Brand (slightly lowered text) */}
          <NavLink
            to="/"
            className="inline-flex items-center gap-3 rounded-lg px-2 py-1 -ml-1 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            aria-label="Go to Dashboard"
          >
            <img
              src={`${import.meta.env.BASE_URL}logo.png`}
              alt="Shepherd’s Table Cloud logo"
              className="h-10 w-10 rounded-md bg-white p-1.5 ring-1 ring-black/10 object-contain"
            />
            <span className="relative top-[2px] text-[17px] sm:text-[19px] md:text-[21px] lg:text-[22px] font-semibold tracking-tight leading-[1.1] text-white drop-shadow-[0_1px_0_rgba(0,0,0,.15)]">
              Shepherd’s Table
            </span>
          </NavLink>

          {/* Spacer pushes everything else to the right */}
          <div className="flex-1" />

          {/* Mobile-only Sign out (right side) */}
          <button
            onClick={onSignOut}
            className="sm:hidden h-9 px-3 rounded-full border border-white/30 bg-white/10 text-white text-sm hover:bg-white/20 active:bg-white/25 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            Sign out
          </button>

          {/* Primary links (desktop) */}
          <nav aria-label="Primary" className="hidden md:flex items-center gap-2 md:gap-3 ml-2">
            <TopLink to="/" end>Dashboard</TopLink>
            {isAdmin && (
              <>
                <TopLink to="/reports">Reports</TopLink>
                <TopLink to="/usda-monthly">USDA</TopLink>
              </>
            )}
          </nav>

          {/* Right group (desktop) */}
          <div className="hidden sm:flex items-center gap-2 md:gap-2.5">
            <button
              type="button"
              onClick={() => setContextOpen((v) => !v)}
              aria-expanded={contextOpen}
              aria-controls="context-panel"
              className={[
                "inline-flex items-center gap-2 h-11 px-4 rounded-full",
                "bg-white/15 text-white ring-1 ring-white/30",
                "hover:bg-white/20 active:bg-white/25 transition",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
              ].join(" ")}
              title="Organization & Location"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M4 7h16M6 12h12M8 17h8" />
              </svg>
              <span className="text-sm font-medium">Context</span>
              <svg className={`h-4 w-4 transition-transform ${contextOpen ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M5.75 7.75L10 12l4.25-4.25" />
              </svg>
            </button>

            <div className="hidden lg:flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-white/15 ring-1 ring-white/25 select-none">
              <span className="h-7 w-7 rounded-full bg-white/20 ring-1 ring-white/30 grid place-items-center text-[11px] font-semibold">
                {initials}
              </span>
              <span className="max-w-[240px] truncate text-xs text-white/95">{email || "—"}</span>
              {roleBadge}
            </div>

            <button
              onClick={onSignOut}
              className="h-10 px-4 rounded-full border border-white/30 bg-white/10 text-white text-sm hover:bg-white/20 active:bg-white/25 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* ===== Desktop context strip ===== */}
        <DesktopContextStrip
          open={contextOpen}
          orgId={orgId}
          orgs={orgs}
          locations={desktopLocations}
          locId={locId}
          loading={loading}
          onOrgChange={handleOrgChange}
          onLocChange={handleLocChange}
          onSaveDefault={handleSaveDefault}
          orgOpen={orgOpen}
          setOrgOpen={setOrgOpen}
          locOpen={locOpen}
          setLocOpen={setLocOpen}
          orgBtnRef={orgBtnRef}
          orgMenuRef={orgMenuRef}
          locBtnRef={locBtnRef}
          locMenuRef={locMenuRef}
          isAdmin={isAdmin}
        />
      </div>


      {/* ===== Mobile panel ===== */}
      <div
        id="nav-panel"
        className={[
          "sm:hidden transition-[max-height,opacity] duration-300 overflow-hidden",
          mobileOpen ? "max-h-[560px] opacity-100" : "max-h-0 opacity-0",
        ].join(" ")}
      >
<div
  className="px-4 pb-4 relative"
  style={{
    background:
      "linear-gradient(160deg, var(--brand-700) 0%, var(--brand-600) 55%, var(--brand-500) 100%)",
  }}
>
  <span
    aria-hidden
    className="pointer-events-none absolute inset-0 opacity-20"
    style={{
      background:
        "radial-gradient(600px 260px at -8% -10%, rgba(255,255,255,.45), transparent 60%), radial-gradient(520px 240px at 108% 120%, rgba(255,255,255,.35), transparent 60%)",
    }}
  />
          <div className="flex gap-2 pt-3">
            <QuickLink to="/" end>Dashboard</QuickLink>
            {isAdmin && (
              <>
                <QuickLink to="/reports">Reports</QuickLink>
                <QuickLink to="/usda-monthly">USDA</QuickLink>
              </>
            )}
          </div>

          {/* Mobile selectors */}
          <div className="mt-3 rounded-2xl bg-white text-gray-900 p-3 ring-1 ring-brand-200 shadow-sm">
            <SelectorRow
              id="org"
              label="Organization"
              value={orgId}
              options={orgs}
              optionLabel="name"
              onChange={handleOrgChange}
              disabled={loading || orgs.length === 0}
            />
            <div className="h-2" />
            <SelectorRow
              id="location"
              label="Location"
              value={locId}
              options={[...(orgId && isAdmin ? [{ id: "", name: "All locations" }] : []), ...locations]}
              optionLabel="name"
              onChange={handleLocChange}
              disabled={loading || (!orgId && locations.length === 0)}
            />

            <p className="mt-3 text-[11px] text-gray-500">
              Changes are local (per device).
            </p>
          </div>

          {/* User summary (right-aligned; no sign out here on mobile now) */}
          <div className="mt-3 flex items-center justify-end text-white">
            <div className="inline-flex items-center gap-2 text-[12px]">
              <span className="truncate max-w-[220px]">{email || "—"}</span>
              {roleBadge}
            </div>
          </div>

        </div>
      </div>
    </header>
  );
}

/* ========= Desktop Context Strip ========= */

function DesktopContextStrip({
  open,
  orgId,
  orgs,
  locations,
  locId,
  loading,
  onOrgChange,
  onLocChange,
  onSaveDefault,
  orgOpen,
  setOrgOpen,
  locOpen,
  setLocOpen,
  orgBtnRef,
  orgMenuRef,
  locBtnRef,
  locMenuRef,
  isAdmin,
}) {
  const activeOrgName = orgs.find((o) => o.id === orgId)?.name || "Select an org";
  const activeLocName =
    orgId ? (locations.find((l) => l.id === locId)?.name || (isAdmin ? "All locations" : "Select a location")) : "—";

  return (
    <div
      id="context-panel"
      className={[
        "hidden sm:block transition-[max-height,opacity] duration-300",

        open ? "max-h-[80vh] opacity-100 overflow-visible" : "max-h-0 opacity-0 overflow-hidden",
      ].join(" ")}
      aria-hidden={!open}
    >
<div
  className="mx-auto w-full max-w-7xl xl:max-w-[90rem] px-4 md:px-8 py-4 relative"
  style={{
    background:
      "linear-gradient(160deg, var(--brand-700) 0%, var(--brand-600) 55%, var(--brand-500) 100%)",
  }}
>
  <span
    aria-hidden
    className="pointer-events-none absolute inset-0 opacity-20"
    style={{
      background:
        "radial-gradient(600px 260px at -8% -10%, rgba(255,255,255,.45), transparent 60%), radial-gradient(520px 240px at 108% 120%, rgba(255,255,255,.35), transparent 60%)",
    }}
  />
        <div className="relative rounded-2xl bg-white/10 ring-1 ring-white/20 backdrop-blur-[2px] p-4 md:p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            {/* Org popover */}
            <SelectorCard
              id="org-d"
              label="Organization"
              valueLabel={activeOrgName}
              disabled={loading || orgs.length === 0}
              open={orgOpen}
              setOpen={setOrgOpen}
              buttonRef={orgBtnRef}
              menuRef={orgMenuRef}
              items={orgs}
              activeId={orgId}
              onSelect={(o) => onOrgChange(o.id)}
              getKey={(o) => o.id}
              getLabel={(o) => o.name}
            />
            {/* Location popover */}
            <SelectorCard
              id="loc-d"
              label="Location"
              valueLabel={activeLocName}
              disabled={loading || !orgId || locations.length === 0}
              open={locOpen}
              setOpen={setLocOpen}
              buttonRef={locBtnRef}
              menuRef={locMenuRef}
              items={orgId ? locations : []}
              activeId={locId}
              onSelect={(l) => onLocChange(l.id)}
              getKey={(l) => l.id}
              getLabel={(l) => l.name || (l.id === "" ? "All locations" : l.id)}
            />
          </div>

          <div className="mt-3">
            <p className="text-[11px] text-white/85">
              Changes are local (per device). Use “All locations” for org-wide admin data.
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}

/* ========= Small UI primitives ========= */

function TopLink({ to, end, className = "", children }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [
          "relative h-9 px-3 rounded-full text-[14px] tracking-tight font-medium inline-flex items-center justify-center transition",
          isActive ? "bg-white/15 text-white shadow-inner" : "text-white/95 hover:bg-white/10 active:bg-white/15",
          className,
        ].join(" ")
      }
    >
      {({ isActive }) => (
        <>
          <span className="leading-none">{children}</span>
          <span
            aria-hidden
            className={[
              "pointer-events-none absolute -bottom-1.5 left-3 right-3 h-[2px] rounded-full bg-white/90 origin-center",
              "transition-transform duration-300 ease-out",
              isActive ? "scale-x-100" : "scale-x-0",
            ].join(" ")}
          />
        </>
      )}
    </NavLink>
  );
}



function QuickLink({ to, end, children }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [
          "relative flex-1 h-11 rounded-full text-[15px] font-medium inline-flex items-center justify-center transition",
          isActive ? "bg-white/15 text-white shadow-inner" : "text-white/95 hover:bg-white/10 active:bg-white/15",
        ].join(" ")
      }
    >
      {({ isActive }) => (
        <>
          <span>{children}</span>
          <span
            aria-hidden
            className={[
              "pointer-events-none absolute -bottom-2 left-4 right-4 h-[3px] rounded-full bg-white/90 origin-center",
              "transition-transform duration-300 ease-out",
              isActive ? "scale-x-100" : "scale-x-0",
            ].join(" ")}
          />
        </>
      )}
    </NavLink>
  );
}

function SelectorRow({ id, label, value, options, optionLabel, onChange, disabled }) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="w-28 text-xs text-gray-700">
        {label}
      </label>
      <select
        id={id}
        className="h-12 flex-1 rounded-full border border-brand-200 px-4 text-sm bg-white focus:outline-none focus:ring-4 focus:ring-brand-200/70 focus:border-brand-400"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {(!options || options.length === 0) && <option value="">No options</option>}
        {options?.map((o) => (
          <option key={o.id} value={o.id}>
            {o[optionLabel] ?? o.name ?? String(o.id)}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ======= Desktop SelectorCard (popover) ======= */

function SelectorCard({
  id,
  label,
  valueLabel,
  disabled,
  open,
  setOpen,
  buttonRef,
  menuRef,
  items,
  activeId,
  onSelect,
  getKey,
  getLabel,
}) {
  return (
    <div className="relative">
      <div className="flex items-center gap-3">
        <label htmlFor={id} className="w-28 text-xs text-white/90">
          {label}
        </label>

        <button
          id={id}
          ref={buttonRef}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen(true);
              setTimeout(() => {
                const first = menuRef.current?.querySelector('[role="option"]');
                first?.focus();
              }, 0);
            }
          }}
          className={[
            "group h-11 w-full rounded-full bg-white text-gray-900",
            "px-4 text-sm shadow-sm ring-1 ring-brand-200",
            "hover:ring-brand-300 active:ring-brand-400",
            "focus:outline-none focus:ring-2 focus:ring-brand-400",
            "text-left flex items-center justify-between",
          ].join(" ")}
        >
          <span className="truncate">{valueLabel}</span>
          <svg className={`h-4 w-4 ml-2 flex-none transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M5.75 7.75L10 12l4.25-4.25" />
          </svg>
        </button>
      </div>

      {open && (
        <div
          ref={menuRef}
          role="listbox"
          tabIndex={-1}
          className="absolute left-[7rem] top-full z-[60] mt-1 min-w-[calc(100%-7rem)] max-w-[420px] rounded-2xl bg-white text-gray-900 shadow-xl ring-1 ring-black/10 overflow-hidden"
        >
          <div className="px-3 py-2 text-[11px] font-medium text-gray-500 border-b">{label}</div>
          <ul className="max-h-[320px] overflow-auto py-1">
            {items.length === 0 && <li className="px-3 py-2 text-sm text-gray-500 select-none">No options</li>}
            {items.map((it) => {
              const k = getKey(it);
              const isActive = String(activeId) === String(k);
              return (
                <li key={k}>
                  <button
                    role="option"
                    aria-selected={isActive}
                    tabIndex={0}
                    onClick={() => onSelect(it)}
                    onKeyDown={(e) => e.key === "Enter" && onSelect(it)}
                    className={[
                      "w-full text-left px-3 py-2 text-sm flex items-center gap-3 transition-colors",
                      isActive ? "bg-brand-50 text-brand-900" : "hover:bg-gray-50 active:bg-gray-100",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "h-2.5 w-2.5 rounded-full ring-1",
                        isActive ? "bg-brand-500 ring-brand-400" : "bg-gray-200 ring-gray-300",
                      ].join(" ")}
                    />
                    <span className={isActive ? "font-medium truncate" : "truncate"}>{getLabel(it)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
