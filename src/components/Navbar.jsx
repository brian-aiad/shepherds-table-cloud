// src/components/Navbar.jsx
// Shepherd’s Table Cloud — Navbar (responsive, capability-aware, Nov 2025)

import {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import {
  NavLink,
  useNavigate,
  useLocation as useRouteLoc,
} from "react-router-dom";
import { useAuth } from "../auth/useAuth";

export default function Navbar() {
  const nav = useNavigate();
  const route = useRouteLoc();

  const {
    email,
    role, // 'admin' | 'volunteer' | 'manager' | 'viewer'
    org,
    orgs = [],
    location,
    locations = [],
    isAdmin,
    canPickAllLocations = false,
    loading,
    setActiveOrg,
    setActiveLocation,
    signOutNow,
    saveDeviceDefaultScope,
    hasCapability,
    canViewReports, // optional convenience flag from AuthProvider
  } = useAuth() || {};

  /* ─────────────────────────────────────────────────────────────
   * Capability resolution with safe fallbacks
   * ──────────────────────────────────────────────────────────── */

  const canViewReportsResolved =
    typeof canViewReports === "boolean"
      ? canViewReports
      : typeof hasCapability === "function"
      ? !!hasCapability("viewReports")
      : !!isAdmin;

  const canAccessInventory =
    typeof hasCapability === "function"
      ? !!hasCapability("inventory")
      : !!isAdmin;

  const canAccessDonations =
    typeof hasCapability === "function"
      ? !!hasCapability("donations")
      : !!isAdmin;

  const canAccessVolunteers =
    typeof hasCapability === "function"
      ? !!hasCapability("volunteers")
      : !!isAdmin;

  /* ─────────────────────────────────────────────────────────────
   * UI state
   * ──────────────────────────────────────────────────────────── */

  const [mobileOpen, setMobileOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
    setContextOpen(false);
  }, [route.pathname]);

  const [orgOpen, setOrgOpen] = useState(false);
  const [locOpen, setLocOpen] = useState(false);

  const orgBtnRef = useRef(null);
  const orgMenuRef = useRef(null);
  const locBtnRef = useRef(null);
  const locMenuRef = useRef(null);

  const orgId = org?.id || "";
  const locId = location?.id ?? null;

  /* ─────────────────────────────────────────────────────────────
   * Identity / badges
   * ──────────────────────────────────────────────────────────── */

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
    const labels = {
      admin: "Admin",
      volunteer: "Volunteer",
      manager: "Manager",
      viewer: "Viewer",
    };
    const label =
      labels[role] ||
      String(role).charAt(0).toUpperCase() + String(role).slice(1);
    return (
      <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-white/15 text-white select-none whitespace-nowrap">
        {label}
      </span>
    );
  }, [role]);

  /* ─────────────────────────────────────────────────────────────
   * Handlers
   * ──────────────────────────────────────────────────────────── */

  const handleOrgChange = useCallback(
    async (nextOrgId) => {
      await setActiveOrg(nextOrgId || null);
      setOrgOpen(false);
      setLocOpen(false);
      setMobileOpen(false);
      nav(route.pathname + route.search, {
        replace: true,
        state: { scopeChangedAt: Date.now() },
      });
    },
    [setActiveOrg, nav, route.pathname, route.search]
  );

  const handleLocChange = useCallback(
    async (nextLocId) => {
      // Admins may send "" ONLY if they actually have org-wide access.
      if (nextLocId === "" && !(isAdmin && canPickAllLocations)) return;
      // Non-admins cannot clear or pick ""
      if ((nextLocId == null || nextLocId === "") && !isAdmin) return;

      await setActiveLocation(nextLocId); // allow "" for "All locations"
      setLocOpen(false);
      setMobileOpen(false);
      nav(route.pathname + route.search, {
        replace: true,
        state: { scopeChangedAt: Date.now() },
      });
    },
    [setActiveLocation, isAdmin, canPickAllLocations, nav, route.pathname, route.search]
  );

  const handleSaveDefault = useCallback(async () => {
    try {
      if (typeof saveDeviceDefaultScope === "function") {
        await saveDeviceDefaultScope();
        showToast("Default saved for this device.");
      } else {
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


  /* ─────────────────────────────────────────────────────────────
   * Dismiss popovers on click/esc
   * ──────────────────────────────────────────────────────────── */

  useEffect(() => {
    const onDocClick = (e) => {
      if (orgOpen) {
        if (
          !orgBtnRef.current?.contains(e.target) &&
          !orgMenuRef.current?.contains(e.target)
        ) {
          setOrgOpen(false);
        }
      }
      if (locOpen) {
        if (
          !locBtnRef.current?.contains(e.target) &&
          !locMenuRef.current?.contains(e.target)
        ) {
          setLocOpen(false);
        }
      }
    };
    const onEsc = (e) => {
      if (e.key === "Escape") {
        setOrgOpen(false);
        setLocOpen(false);
        setContextOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [orgOpen, locOpen]);

  // Auto-pick first location after org change
  useEffect(() => {
    if (!loading && orgId && locations.length > 0 && location == null) {
      const first = locations[0];
      if (first?.id !== undefined) setActiveLocation(first.id);
    }
  }, [loading, orgId, location, locations, setActiveLocation]);

  /* ─────────────────────────────────────────────────────────────
   * Option sets & labels
   * ──────────────────────────────────────────────────────────── */

  const desktopLocations = useMemo(() => {
    if (!orgId) return [];
    const scoped = (locations || []).filter((l) => l.orgId === orgId);
    return isAdmin && canPickAllLocations
      ? [{ id: "", orgId, name: "All locations" }, ...scoped]
      : scoped;
  }, [locations, orgId, isAdmin, canPickAllLocations]);

  const mobileScopedLocations = useMemo(() => {
    if (!orgId) return [];
    const scoped = (locations || []).filter((l) => l.orgId === orgId);
    return isAdmin && canPickAllLocations
      ? [{ id: "", orgId, name: "All locations" }, ...scoped]
      : scoped;
  }, [locations, orgId, isAdmin, canPickAllLocations]);

  const activeOrgName =
    orgs.find((o) => o.id === orgId)?.name || org?.name || "Select an org";
  const activeLocName = !orgId
    ? "—"
    : isAdmin && canPickAllLocations && locId === ""
    ? "All locations"
    : mobileScopedLocations.find((l) => l.id === locId)?.name ||
      (isAdmin && canPickAllLocations ? "All locations" : "Select a location");

  // Tenant logo (prefer org.logoUrl, fallback to app logo)
  const appLogo = `${import.meta.env.BASE_URL}logo.png`;
  const brandLogoSrc = org?.logoUrl || appLogo;
  const brandAlt = org?.name
    ? `${org.name} logo`
    : "Shepherd’s Table Cloud logo";

  /* ─────────────────────────────────────────────────────────────
   * Tiny toast
   * ──────────────────────────────────────────────────────────── */

  const [toast, setToast] = useState(null);
  function showToast(msg, ms = 1800) {
    setToast(msg);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(null), ms);
  }

  /* ─────────────────────────────────────────────────────────────
   * Render
   * ──────────────────────────────────────────────────────────── */

  return (
    <header className="sticky top-0 z-50 relative isolate">
      {/* Seam killer for iOS top safe area */}
      <div
        aria-hidden
        className="fixed top-0 left-0 right-0 h-[max(1px,env(safe-area-inset-top))] z-[9998] pointer-events-none"
        style={{ background: "var(--brand-650, var(--brand-600))" }}
      />

      {toast && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[9999]">
          <div className="rounded-lg bg-gray-900 text-white text-sm px-3 py-1.5 shadow-lg border border-white/10">
            {toast}
          </div>
        </div>
      )}

      {/* ===== Top bar ===== */}
      <div
        className="relative w-full shadow-sm"
        style={{
          background:
            "linear-gradient(180deg, var(--brand-650, var(--brand-700)) 0%, var(--brand-600) 100%)",
        }}
      >
        <div className="relative z-10 mx-auto w-full max-w-[112rem] h-16 px-3 sm:px-4 md:px-6 lg:px-8 flex items-center gap-3 sm:gap-4">
          {/* Hamburger (phones + tablets + small/medium desktop) */}
          <button
            type="button"
            className="xl:hidden inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white/0 text-white ring-1 ring-white/20 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            aria-controls="nav-panel"
            onClick={() => setMobileOpen((v) => !v)}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              {mobileOpen ? (
                <path d="M6 6l12 12M6 18L18 6" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" />
              )}
            </svg>
          </button>

          {/* Brand */}
          <NavLink
            to="/"
            className="inline-flex items-center gap-3 rounded-xl px-2 sm:px-2.5 py-1.5 -ml-1 xl:-ml-0 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 transition-all"
            aria-label="Go to Dashboard"
          >
            <div className="relative shrink-0">
            <img
            src={brandLogoSrc}
            alt={brandAlt}
            className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl bg-white p-[1px] object-contain shadow-md ring-1 ring-black/10"
            referrerPolicy="no-referrer"
            loading="eager"
          />


            </div>

            <div className="flex flex-col leading-tight">
              <span className="font-semibold text-white text-[16px] sm:text-[18px] md:text-[20px] tracking-tight whitespace-nowrap">
                Shepherd’s Table
              </span>

              {org?.name && (
                <span className="text-[11px] sm:text-xs font-medium text-white/90 bg-white/15 px-2 py-[2px] rounded-md mt-0.5 truncate max-w-[220px] md:max-w-[260px]">
                  {org.name}
                </span>
              )}
            </div>
          </NavLink>


          {/* Compact Sign out when nav is collapsed (< xl) */}
          <button
            onClick={onSignOut}
            className="xl:hidden ml-auto shrink-0 h-9 px-3 rounded-full bg-white/20 text-white text-xs font-medium ring-1 ring-white/25 backdrop-blur-sm hover:bg-white/25 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/30 whitespace-nowrap"
          >
            Sign out
          </button>

          {/* Primary links (desktop / xl+ only) */}
          <nav
            aria-label="Primary"
            className="hidden xl:flex items-center flex-1 justify-center gap-4 2xl:gap-5 px-2"
          >
            <TopLink
              to="/"
              end
              className="text-[15px] 2xl:text-[17px] font-semibold"
            >
              Dashboard
            </TopLink>

            {canAccessInventory && (
              <TopLink
                to="/inventory"
                className="text-[15px] 2xl:text-[17px] font-semibold"
              >
                Inventory
              </TopLink>
            )}

            {canAccessDonations && (
              <TopLink
                to="/donations"
                className="text-[15px] 2xl:text-[17px] font-semibold"
              >
                Donations
              </TopLink>
            )}

            {canViewReportsResolved && (
              <>
                <TopLink
                  to="/reports"
                  className="text-[15px] 2xl:text-[17px] font-semibold"
                >
                  Reports
                </TopLink>
                <TopLink
                  to="/usda-monthly"
                  className="text-[15px] 2xl:text-[17px] font-semibold"
                >
                  USDA
                </TopLink>
              </>
            )}
          </nav>

          {/* Right group (desktop xl+) */}
          <div className="hidden xl:flex items-center gap-2.5 2xl:gap-3 ml-3">
            
            <button
              type="button"
              onClick={() => setContextOpen((v) => !v)}
              aria-expanded={contextOpen}
              aria-controls="context-panel"
              className="inline-flex items-center gap-1.5 h-8 2xl:h-9 px-2.5 2xl:px-3 rounded-full bg-white/20 text-white text-[12px] ring-1 ring-white/25 backdrop-blur-sm hover:bg-white/25 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/30 whitespace-nowrap"
              title="Organization & Location"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M4 7h16M6 12h12M8 17h8" />
              </svg>
              <span className="font-medium">Context</span>
              <svg
                className={`h-4 w-4 transition-transform ${
                  contextOpen ? "rotate-180" : ""
                }`}
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M5.75 7.75L10 12l4.25-4.25" />
              </svg>
            </button>

            {/* User chip */}
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-[#ffffff1a] ring-1 ring-white/20 select-none">
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 ring-1 ring-white/15">
                <span className="h-7 w-7 rounded-full bg-brand-600 grid place-items-center text-[12px] font-bold text-white shadow-sm">
                  {initials}
                </span>
                <span className="max-w-[220px] 2xl:max-w-[260px] truncate text-[11px] text-white/95 font-medium">
                  {email || "—"}
                </span>
                {roleBadge && <span className="ml-1">{roleBadge}</span>}
              </div>
            </div>

            <button
              onClick={onSignOut}
              className="inline-flex items-center justify-center h-8 2xl:h-9 px-2.5 rounded-full bg-white/20 text-white text-[12px] 2xl:text-[13px] ring-1 ring-white/25 hover:bg-white/25 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/30 whitespace-nowrap"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Desktop context strip (xl+ only) */}
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
          canPickAllLocations={canPickAllLocations}
        />
      </div>

      {/* ===== Mobile / tablet / small-desktop panel (Navigation / Scope / Account) ===== */}
      <div
        id="nav-panel"
        className={[
          "xl:hidden transition-[max-height,opacity] duration-300",
          mobileOpen
            ? "max-h-[90vh] opacity-100 overflow-visible pointer-events-auto"
            : "max-h-0 opacity-0 overflow-hidden pointer-events-none",
        ].join(" ")}
      >
        <div
          className="px-3 pb-4 pt-2"
          style={{
            background:
              "linear-gradient(180deg, var(--brand-650, var(--brand-700)) 0%, var(--brand-600) 100%)",
          }}
        >
          <div className="rounded-3xl bg-black/5 backdrop-blur-sm border border-white/12 p-3 space-y-4 max-h-[calc(100vh-5rem)] overflow-auto">
            {/* Navigation section */}
            <section>
              <p className="text-[11px] uppercase tracking-[0.14em] text-white/60 mb-1.5">
                Navigation
              </p>
              <div className="flex flex-col gap-1.5">
                <MobileNavLink to="/" end>
                  Dashboard
                </MobileNavLink>

                {canAccessInventory && (
                  <MobileNavLink to="/inventory">Inventory</MobileNavLink>
                )}

                {canAccessDonations && (
                  <MobileNavLink to="/donations">Donations</MobileNavLink>
                )}

                {canViewReportsResolved && (
                  <>
                    <MobileNavLink to="/reports">Reports</MobileNavLink>
                    <MobileNavLink to="/usda-monthly">USDA</MobileNavLink>
                  </>
                )}

                {canAccessVolunteers && (
                  <MobileNavLink to="/volunteer">Volunteers</MobileNavLink>
                )}
              </div>
            </section>

            {/* Scope section */}
            <section className="rounded-2xl bg-white text-gray-900 p-3 shadow-sm">
              <p className="text-[11px] font-medium text-gray-500 mb-2">
                Scope (local to this device)
              </p>

              <div className="space-y-2">
                <MobileSelectPopover
                  id="m-org"
                  label="Organization"
                  valueLabel={activeOrgName}
                  disabled={loading || orgs.length === 0}
                  open={orgOpen}
                  setOpen={setOrgOpen}
                  items={orgs}
                  activeId={orgId}
                  onSelect={(o) => handleOrgChange(o.id)}
                  getKey={(o) => o.id}
                  getLabel={(o) => o.name}
                />

                <MobileSelectPopover
                  id="m-loc"
                  label="Location"
                  valueLabel={activeLocName}
                  disabled={
                    loading || !orgId || mobileScopedLocations.length === 0
                  }
                  open={locOpen}
                  setOpen={setLocOpen}
                  items={orgId ? mobileScopedLocations : []}
                  activeId={locId}
                  onSelect={(l) => handleLocChange(l.id)}
                  getKey={(l) => l.id}
                  getLabel={(l) =>
                    l.name || (l.id === "" ? "All locations" : l.id)
                  }
                />
              </div>

              <p className="mt-2 text-[11px] text-gray-500">
                Admins may choose{" "}
                <span className="font-semibold">All locations</span> when
                available.
              </p>
            </section>

            {/* Account section */}
            <section className="flex items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-2 text-[12px] text-white">
                <span className="h-7 w-7 rounded-full bg-white/20 grid place-items-center text-[12px] font-semibold">
                  {initials}
                </span>
                <div className="flex flex-col leading-tight">
                  <span className="max-w-[190px] truncate font-medium">
                    {email || "—"}
                  </span>
                  {roleBadge && (
                    <span className="mt-0.5 inline-flex">{roleBadge}</span>
                  )}
                </div>
              </div>

              <button
                onClick={onSignOut}
                className="h-9 px-3 rounded-full bg-white/15 text-white text-xs font-medium ring-1 ring-white/25 hover:bg-white/25 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/30 whitespace-nowrap"
              >
                Sign out
              </button>
              
            </section>
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
  canPickAllLocations = false,
}) {
  const activeOrgName =
    orgs.find((o) => o.id === orgId)?.name || "Select an org";
  const activeLocName = orgId
    ? locations.find((l) => l.id === locId)?.name ||
      (isAdmin && canPickAllLocations ? "All locations" : "Select a location")
    : "—";

  return (
    <div
      id="context-panel"
      className={[
        "hidden xl:block relative z-20 transition-[max-height,opacity] duration-300",
        open
          ? "max-h-[80vh] opacity-100 overflow-visible pointer-events-auto"
          : "max-h-0 opacity-0 overflow-hidden pointer-events-none",
      ].join(" ")}
      aria-hidden={!open}
    >
      <div
        className="mx-auto w-full max-w-[112rem] px-3 sm:px-4 md:px-6 lg:px-8 py-3 md:py-4"
        style={{
          background:
            "linear-gradient(180deg, var(--brand-650, var(--brand-700)) 0%, var(--brand-600) 100%)",
        }}
      >
        <div className="rounded-2xl bg-white/10 p-3 md:p-4 lg:p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
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
              getLabel={(l) =>
                l.name || (l.id === "" ? "All locations" : l.id)
              }
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] text-white/85">
              Changes are local (per device).
              {isAdmin && canPickAllLocations
                ? " Use “All locations” for org-wide admin data."
                : ""}
            </p>
            <button
              onClick={onSaveDefault}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/20 text-white text-[12px] font-medium ring-1 ring-white/25 px-2 py-1 hover:bg-white/25 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/30 whitespace-nowrap"
              title="Save this scope on this device"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M5 13l4 4L19 7" />
              </svg>
              Save as default
            </button>
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
          "relative h-8 2xl:h-9 px-3 rounded-full text-[13px] 2xl:text-[14px] tracking-tight font-semibold inline-flex items-center justify-center whitespace-nowrap transition",
          isActive
            ? "bg-white/20 text-white ring-1 ring-white/25 backdrop-blur-sm"
            : "text-white hover:bg-white/15",
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
              "pointer-events-none absolute -bottom-2 left-3 right-3 h-[3px] rounded-full bg-white/90 origin-center",
              "transition-transform duration-300 ease-out",
              isActive ? "scale-x-100" : "scale-x-0",
            ].join(" ")}
          />
        </>
      )}
    </NavLink>
  );
}

function MobileNavLink({ to, end, children }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [
          "w-full inline-flex items-center justify-between rounded-2xl px-3.5 py-2.5 text-[14px] font-medium transition",
          isActive
            ? "bg-white/20 text-white ring-1 ring-white/40"
            : "bg-white/10 text-white/95 hover:bg-white/15",
        ].join(" ")
      }
    >
      {({ isActive }) => (
        <>
          <span>{children}</span>
          <span
            aria-hidden
            className={[
              "h-1.5 w-1.5 rounded-full",
              isActive ? "bg-white" : "bg-white/40",
            ].join(" ")}
          />
        </>
      )}
    </NavLink>
  );
}

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
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen(true);
              setTimeout(() => {
                const first =
                  menuRef.current?.querySelector('[role="option"]');
                first?.focus();
              }, 0);
            }
          }}
          className={[
            "group h-11 w-full rounded-full bg-white text-gray-900 px-4 text-sm shadow-sm text-left flex items-center justify-between",
            "border border-brand-200 hover:border-brand-300",
            "focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200",
            open ? "ring-2 ring-brand-300 border-brand-300" : "",
          ].join(" ")}
        >
          <span className="truncate">{valueLabel}</span>
          <svg
            className={`h-4 w-4 ml-2 flex-none transition-transform ${
              open ? "rotate-180" : ""
            }`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
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
          <div className="px-3 py-2 text-[11px] font-medium text-gray-500 border-b">
            {label}
          </div>
          <ul className="max-h-[320px] overflow-auto py-1">
            {items.length === 0 && (
              <li className="px-3 py-2 text-sm text-gray-500 select-none">
                No options
              </li>
            )}
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
                      isActive
                        ? "bg-brand-50 text-brand-900"
                        : "hover:bg-gray-50",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "h-2.5 w-2.5 rounded-full",
                        isActive ? "bg-brand-500" : "bg-brand-200",
                      ].join(" ")}
                    />
                    <span
                      className={
                        isActive ? "font-medium truncate" : "truncate"
                      }
                    >
                      {getLabel(it)}
                    </span>
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

function MobileSelectPopover({
  id,
  label,
  valueLabel,
  disabled,
  open,
  setOpen,
  items,
  activeId,
  onSelect,
  getKey,
  getLabel,
  buttonRef,
  menuRef,
}) {
  return (
    <div className="relative">
      <div className="flex items-center gap-3">
        <label htmlFor={id} className="w-24 text-xs text-gray-700">
          {label}
        </label>

        <button
          id={id}
          ref={buttonRef}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className={[
            "h-11 w-full rounded-full bg-white text-gray-900 px-4 text-sm shadow-sm text-left flex items-center justify-between",
            "border border-brand-200 hover:border-brand-300",
            "focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200",
            open ? "ring-2 ring-brand-300 border-brand-300" : "",
          ].join(" ")}
        >
          <span className="truncate">{valueLabel}</span>
          <svg
            className={`h-4 w-4 ml-2 flex-none transition-transform ${
              open ? "rotate-180" : ""
            }`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M5.75 7.75L10 12l4.25-4.25" />
          </svg>
        </button>
      </div>

      {open && (
        <div
          ref={menuRef}
          role="listbox"
          tabIndex={-1}
          className="absolute left-24 right-0 top-full z-[70] mt-1 rounded-2xl bg-white text-gray-900 shadow-xl ring-1 ring-black/10 overflow-hidden max-h-[60vh]"
        >
          <div className="px-3 py-2 text-[11px] font-medium text-gray-500 border-b">
            {label}
          </div>
          <ul className="max-h-[60vh] overflow-auto py-1">
            {items.length === 0 && (
              <li className="px-3 py-2 text-sm text-gray-500 select-none">
                No options
              </li>
            )}
            {items.map((it) => {
              const k = String(getKey(it));
              const isActive = String(activeId) === k;
              return (
                <li key={k}>
                  <button
                    role="option"
                    aria-selected={isActive}
                    onClick={() => {
                      onSelect(it);
                      setOpen(false);
                    }}
                    className={[
                      "w-full text-left px-3 py-2 text-sm flex items-center gap-3 transition-colors",
                      isActive
                        ? "bg-brand-50 text-brand-900"
                        : "hover:bg-gray-50",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "h-2.5 w-2.5 rounded-full",
                        isActive ? "bg-brand-500" : "bg-brand-200",
                      ].join(" ")}
                    />
                    <span
                      className={
                        isActive ? "font-medium truncate" : "truncate"
                      }
                    >
                      {getLabel(it)}
                    </span>
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
