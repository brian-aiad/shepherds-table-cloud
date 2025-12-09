// src/components/LogVisitForm.jsx
// Shepherds Table Cloud — Log Visit (Oct/Nov 2025 UI parity + capability guard)
// - Bottom sheet on mobile / centered card on desktop
// - Sticky gradient header/footer, initials avatar, icons on labels, pretty-scroll
// - Single Firestore transaction: visit + client counters (+ optional USDA marker)
// - Deterministic USDA monthly marker id: `${orgId}_${clientId}_${monthKey}`
// - weekKey (YYYY-Www) + weekday (0–6); resilient client name denorm
// - Hard guard: blocks if client is inactive; preserves client's original org/location
// - Household size: steppers + numeric input with clamping; Enter = next field
// - 🚦 Capability-aware: requires `logVisits`

import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc, // ⬅️ pre-check for monthly USDA marker
  runTransaction,
  serverTimestamp,
  increment,
} from "firebase/firestore";
import { db, auth } from "../lib/firebase";
import { useAuth } from "../auth/useAuth";
import { Users, Soup } from "lucide-react";

/* ---------- date helpers ---------- */
const monthKeyFor = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const dateKeyFor = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

function isoWeekKey(d = new Date()) {
  // ISO week (Mon-based; Thursday trick)
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

const MIN_HH = 1;
const MAX_HH = 20;

// Enter moves to next input (mirrors NewClientForm/EditForm)
function handleFormKeyDown(e) {
  if (e.key !== "Enter") return;
  const el = e.target;
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute("type") || "").toLowerCase();
  const safe =
    tag === "textarea" ||
    tag === "select" ||
    tag === "button" ||
    type === "submit" ||
    type === "button";
  if (safe) return;
  e.preventDefault();
  const form = e.currentTarget;
  const focusables = Array.from(
    form.querySelectorAll("input, select, textarea")
  ).filter((n) => !n.disabled && n.type !== "hidden" && n.tabIndex !== -1);
  const idx = focusables.indexOf(el);
  if (idx > -1 && idx < focusables.length - 1) focusables[idx + 1].focus();
  else el.blur();
}

const ICONS = {
  hh: <Users size={16} className="inline mr-1" />,
  usda: <Soup size={16} className="inline mr-1" />,
};

export default function LogVisitForm({
  open,
  client, // { id, firstName, lastName, householdSize, inactive, ... }
  onClose,
  onSaved,
  defaultOrgId,
  defaultLocationId,
}) {
  const [hh, setHH] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Manual USDA toggle
  const [usdaFirstThisMonth, setUsdaFirstThisMonth] = useState(false);

  // USDA monthly eligibility state
  const [usdaAllowed, setUsdaAllowed] = useState(true);
  const [usdaChecking, setUsdaChecking] = useState(false);

  const inputRef = useRef(null);

  // Auth scope (read-only here)
  const authCtx = useAuth() || {};
  const orgId =
    defaultOrgId ?? authCtx.org?.id ?? authCtx.activeOrg?.id ?? null;
  const locationId =
    defaultLocationId ??
    authCtx.location?.id ??
    authCtx.activeLocation?.id ??
    null;
  const currentUserId = authCtx?.uid || auth.currentUser?.uid || null;

  // 🔐 Capability check (prefers canLogVisits → hasCapability('logVisits') → isAdmin)
  const canLog =
    (typeof authCtx?.canLogVisits !== "undefined"
      ? !!authCtx.canLogVisits
      : typeof authCtx?.hasCapability === "function"
      ? !!authCtx.hasCapability("logVisits")
      : !!authCtx?.isAdmin) || false;

  const name = `${client?.firstName || ""} ${client?.lastName || ""}`.trim();
  const initials = useMemo(() => {
    if (!name) return "👤";
    return name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("");
  }, [name]);

  // Reset when opening or client changes
  useEffect(() => {
    if (!open || !client?.id) return;
    const base = Number(client?.householdSize || 1) || 1;
    setHH(Math.max(MIN_HH, Math.min(MAX_HH, base)));
    setUsdaFirstThisMonth(false);
    setErr("");
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, [open, client?.id]);

  // Ensure focused inputs are scrolled into view on mobile when the virtual keyboard opens.
  useEffect(() => {
    if (!open) return;
    const formEl = document.getElementById("log-visit-form");
    if (!formEl) return;
    function onFocusIn(e) {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (window.innerWidth > 768) return;
      setTimeout(() => {
        try {
          target.scrollIntoView({ block: "center", behavior: "smooth" });
        } catch (err) {}
      }, 320);
    }
    formEl.addEventListener("focusin", onFocusIn);
    return () => formEl.removeEventListener("focusin", onFocusIn);
  }, [open]);

  // Pre-check USDA marker existence for this month
  // If no marker exists => auto-select "Yes"
  // If marker exists => disable "Yes" and auto-select "No"
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!open || !client?.id) return;
      const mk = monthKeyFor(new Date());

      // If org isn't resolved yet, keep allowed and leave toggle off by default
      if (!orgId) {
        setUsdaAllowed(true);
        return;
      }

      try {
        setUsdaChecking(true);
        const markerId = `${orgId}_${client.id}_${mk}`;
        const snap = await getDoc(doc(db, "usda_first", markerId));
        if (cancelled) return;

        const exists = snap.exists();
        const allowed = !exists;
        setUsdaAllowed(allowed);

        if (exists) {
          // Already counted this month: force "No" and keep Yes disabled
          setUsdaFirstThisMonth(false);
        } else {
          // First USDA visit this month: default "Yes"
          setUsdaFirstThisMonth(true);
        }
      } finally {
        if (!cancelled) setUsdaChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, client?.id, orgId, locationId]);

  if (!open || !client) return null;

  async function submit() {
    if (busy) return;

    // 🚦 Capability guard
    if (!canLog) {
      setErr("You do not have permission to log visits.");
      return;
    }

    // Scope + auth guards
    if (!orgId || !locationId) {
      setErr("Select an Organization and Location before logging a visit.");
      return;
    }
    if (!currentUserId) {
      setErr("You must be signed in to log a visit.");
      return;
    }

    // Client state guard
    if (client.inactive === true) {
      setErr("This client is deactivated. Reactivate before logging a visit.");
      return;
    }

    // clamp HH
    const hhValue = Math.max(MIN_HH, Math.min(MAX_HH, Number(hh) || MIN_HH));

    setBusy(true);
    setErr("");
    try {
      const now = new Date();
      const mKey = monthKeyFor(now);
      const dKey = dateKeyFor(now);
      const wKey = isoWeekKey(now);
      const weekday = now.getDay(); // 0=Sun..6=Sat

      await runTransaction(db, async (tx) => {
        // 1) Read the client to preserve its original org/location and ensure it exists
        const clientRef = doc(db, "clients", client.id);
        const clientSnap = await tx.get(clientRef);
        if (!clientSnap.exists()) {
          throw new Error("Client document not found.");
        }
        const cur = clientSnap.data() || {};

        // Hard guard: don't allow logging across orgs
        if (cur.orgId && cur.orgId !== orgId) {
          throw new Error("Client belongs to a different organization.");
        }

        // 2) If toggled Yes *and allowed*, create USDA marker exactly once
        const wantsUsda = usdaFirstThisMonth && usdaAllowed;
        if (wantsUsda) {
          const markerId = `${orgId}_${client.id}_${mKey}`;
          const markerRef = doc(db, "usda_first", markerId);

          const markerSnap = await tx.get(markerRef);
          if (!markerSnap.exists()) {
            tx.set(markerRef, {
              orgId,
              clientId: client.id,
              clientFirstName: cur.firstName || client.firstName || "",
              clientLastName: cur.lastName || client.lastName || "",
              locationId,
              monthKey: mKey,
              createdAt: serverTimestamp(),
              createdByUserId: currentUserId,
            });
          }
        }

        // Snapshot address fields from the client for historical reporting
        const snapAddress = cur.address || client.address || "";
        const snapZip = cur.zip || client.zip || "";
        const snapCounty = cur.county || client.county || "";

        // 3) Create the visit
        const visitRef = doc(collection(db, "visits"));
        tx.set(visitRef, {
          // tenant + where the visit occurred
          orgId,
          locationId,

          // linkage + resilience
          clientId: client.id,
          clientFirstName: client.firstName || cur.firstName || "",
          clientLastName: client.lastName || cur.lastName || "",

          // ⬇️ Historical client snapshots
          clientAddress: snapAddress,
          clientZip: snapZip,
          clientCounty: snapCounty,

          // keys & timestamps
          visitAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          monthKey: mKey,
          dateKey: dKey,
          weekKey: wKey,
          weekday,

          // inputs & flags
          householdSize: Number(hhValue),
          usdaFirstTimeThisMonth: !!(usdaFirstThisMonth && usdaAllowed),

          // audit
          createdByUserId: currentUserId,
          editedAt: null,
          editedByUserId: null,

          // guard against programmatic inserts
          addedByReports: false,
        });

        // 4) Atomic client counters + last visit fields (NO org/location reassignment)
        tx.update(clientRef, {
          lastVisitAt: serverTimestamp(),
          lastVisitMonthKey: mKey,
          updatedAt: serverTimestamp(),
          updatedByUserId: currentUserId,
          visitCountLifetime: increment(1),
          [`visitCountByMonth.${mKey}`]: increment(1),
          householdSize: Number(hhValue),
        });
      });

      onSaved?.();
      onClose?.();
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Could not log the visit. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function onKey(e) {
    if (e.key === "Escape") onClose?.();
  }

  // If the user lacks permission, show a simple, branded notice in the same shell
  if (!canLog) {
    return (
      <div className="fixed inset-0 z-[1000]">
        {/* Backdrop */}
        <button
          aria-label="Close"
          className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
          onClick={onClose}
        />
        {/* Card */}
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="no-cap-title"
          className="
            absolute left-1/2 -translate-x-1/2 w-full sm:w-[min(560px,94vw)]
            bottom-0 sm:bottom-auto sm:top-[55%] sm:-translate-y-1/2
            bg-white sm:rounded-3xl rounded-t-3xl shadow-2xl ring-1 ring-brand-200/70
            overflow-hidden flex flex-col
            sm:max-h-[90vh]
          "
          style={{
            maxHeight: "calc(100vh - 120px)",
            marginTop: `calc(env(safe-area-inset-top, 44px) + 56px)`,
          }}
        >
          <div
            className="sticky top-0 z-10"
            style={{
              paddingTop: "env(safe-area-inset-top, 12px)",
              top: "env(safe-area-inset-top, 12px)",
            }}
          >
            <div className="bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 text-white border-b shadow-[inset_0_-1px_0_rgba(255,255,255,0.25)] rounded-t-3xl">
              <div className="px-3.5 sm:px-6 py-2.5 sm:py-4 flex items-center justify-between">
                <h2
                  id="no-cap-title"
                  className="text-base sm:text-xl font-semibold"
                >
                  Log Visit
                </h2>
                <button
                  onClick={onClose}
                  className="rounded-xl px-4 sm:px-5 h-11 sm:h-12 text-xl sm:text-2xl hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 shrink-0"
                  aria-label="Close"
                  title="Close"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>

          <div className="p-4 sm:p-6">
            <div
              role="alert"
              className="rounded-2xl border border-amber-200 bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-[13px] text-amber-900"
            >
              You don’t have permission to log visits. Ask an admin to update
              your role.
            </div>
          </div>

          <div
            className="sticky bottom-0 z-10 border-t bg-white/95 backdrop-blur px-4 sm:px-6 py-3 sm:py-4"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)" }}
          >
            <div className="flex items-center justify-end">
              <button
                className="h-11 px-6 rounded-2xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 text-white font-semibold shadow-sm hover:from-brand-800 hover:via-brand-700 hover:to-brand-600 active:from-brand-900 active:via-brand-800 active:to-brand-700"
                onClick={onClose}
                type="button"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[1000]">
      {/* Backdrop */}
      <button
        aria-label="Close"
        className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Modal shell — matches NewClientForm spacing/shape */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="log-visit-title"
        className="
          absolute left-1/2 -translate-x-1/2 w-full sm:w-[min(560px,94vw)]
          bottom-0 sm:bottom-auto sm:top-[55%] sm:-translate-y-1/2
          bg-white sm:rounded-3xl rounded-t-3xl shadow-2xl ring-1 ring-brand-200/70
          overflow-hidden flex flex-col
          sm:max-h-[90vh]
        "
        style={{
          maxHeight: "calc(100vh - 120px)",
          marginTop: `calc(env(safe-area-inset-top, 44px) + 56px)`,
        }}
        onKeyDown={onKey}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header — aligned with NewClientForm header */}
        <div
          className="sticky top-0 z-10"
          style={{
            paddingTop: "env(safe-area-inset-top, 12px)",
            top: "env(safe-area-inset-top, 12px)",
          }}
        >
          <div className="bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 text-white border-b shadow-[inset_0_-1px_0_rgba(255,255,255,0.25)] rounded-t-3xl">
            <div className="px-3.5 sm:px-6 py-2.5 sm:py-4">
              <div className="flex items-center justify-between gap-3 sm:gap-6">
                {/* Avatar + title + org/loc */}
                <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
                  <div className="shrink-0 h-10 w-10 rounded-2xl bg-white/15 text-white grid place-items-center font-semibold ring-1 ring-white/20">
                    {initials === "👤" ? (
                      <Users
                        className="h-5 w-5 text-white/95"
                        aria-hidden="true"
                      />
                    ) : (
                      <span className="text-sm font-semibold">{initials}</span>
                    )}
                  </div>

                  <div className="min-w-0">
                    <h2
                      id="log-visit-title"
                      className="text-base sm:text-xl font-semibold truncate"
                    >
                      {`Log Visit${name ? ` – ${name}` : ""}`}
                    </h2>

                    <div className="mt-0.5 text-[11px] sm:text-xs opacity-90 leading-tight">
                      <div className="truncate">
                        Org: <b className="font-medium">{orgId ?? "—"}</b>
                      </div>
                      <div className="truncate">
                        Loc:{" "}
                        <b className="font-medium">{locationId ?? "—"}</b>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Close */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={onClose}
                    className="rounded-xl px-4 sm:px-5 h-11 sm:h-12 text-xl sm:text-2xl hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 shrink-0"
                    aria-label="Close"
                    title="Close"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Context warning */}
        {!orgId || !locationId ? (
          <div
            role="alert"
            className="mx-4 sm:mx-6 mt-3 rounded-2xl border border-red-200 bg-red-50 ring-1 ring-red-200 px-3 py-2 text-[13px] text-red-800"
          >
            Select an Organization and Location from the navbar before logging a
            visit.
          </div>
        ) : null}

        {/* Body (pretty-scroll) */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          onKeyDown={handleFormKeyDown}
          id="log-visit-form"
          className="flex-1 overflow-y-auto overflow-x-hidden px-4 md:px-6 py-4 md:py-6 space-y-4 text-[17px] pretty-scroll"
          style={{
            maxHeight: "calc(100vh - 220px)",
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
          noValidate
        >
          {/* ==== Section: Household + USDA, matching New Intake layout ==== */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* USDA toggle — boxed card with full-width SectionHeader */}
            <div className="rounded-2xl border border-brand-200 bg-white shadow-sm p-3 sm:p-4 space-y-2">
              <SectionHeader
                icon={ICONS.usda}
                label="USDA first time this month?"
              />

              <div className="mt-3 grid grid-cols-2 gap-2">
                <label
                  className={[
                    "h-11 rounded-2xl border grid place-items-center text-sm font-semibold cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200",
                    usdaFirstThisMonth
                      ? "bg-gradient-to-b from-[color:var(--brand-600)] to-[color:var(--brand-700)] text-white border-[color:var(--brand-700)] ring-1 ring-brand-700/40 shadow-[0_6px_14px_-6px_rgba(199,58,49,0.35)]"
                      : "bg-white text-brand-900 border-brand-300 hover:bg-brand-50 hover:border-brand-400",
                    (usdaChecking || !usdaAllowed) &&
                      "!opacity-60 !cursor-not-allowed",
                  ].join(" ")}
                  aria-disabled={usdaChecking || !usdaAllowed}
                  title={
                    usdaChecking
                      ? "Checking eligibility…"
                      : !usdaAllowed
                      ? "Already counted this month"
                      : "Mark this as the first USDA visit for the month"
                  }
                >
                  <input
                    type="radio"
                    name="usda"
                    className="sr-only"
                    checked={usdaFirstThisMonth === true}
                    onChange={() => setUsdaFirstThisMonth(true)}
                    disabled={usdaChecking || !usdaAllowed}
                  />
                  Yes
                </label>

                <label
                  className={[
                    "h-11 rounded-2xl border grid place-items-center text-sm font-semibold cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200",
                    !usdaFirstThisMonth
                      ? "bg-gradient-to-b from-[color:var(--brand-600)] to-[color:var(--brand-700)] text-white border-[color:var(--brand-700)] ring-1 ring-brand-700/40 shadow-[0_6px_14px_-6px_rgba(199,58,49,0.35)]"
                      : "bg-white text-brand-900 border-brand-300 hover:bg-brand-50 hover:border-brand-400",
                  ].join(" ")}
                >
                  <input
                    type="radio"
                    name="usda"
                    className="sr-only"
                    checked={usdaFirstThisMonth === false}
                    onChange={() => setUsdaFirstThisMonth(false)}
                  />
                  No
                </label>
              </div>

              <p className="mt-1.5 text-[11px] text-gray-600">
                {usdaChecking
                  ? "Checking eligibility…"
                  : usdaAllowed
                  ? `If “Yes”, we’ll record this as the first USDA visit for ${monthKeyFor()} and create a monthly marker.`
                  : "Already counted this month — this option will re-enable next month."}
              </p>
            </div>

            {/* Household size — boxed card with full-width SectionHeader */}
            <div className="rounded-2xl border border-brand-200 bg-white shadow-sm p-3 sm:p-4 space-y-2">
              <SectionHeader icon={ICONS.hh} label="Household size" />

              <div className="mt-3 flex items-center gap-3 w-full">
                {/* Decrease */}
                <button
                  type="button"
                  aria-label="Decrease household size"
                  onClick={() =>
                    setHH((n) => Math.max(MIN_HH, (Number(n) || MIN_HH) - 1))
                  }
                  className="h-12 sm:h-11 w-28 sm:w-12 rounded-2xl border border-brand-300 bg-white text-xl leading-none font-semibold hover:bg-brand-50 hover:border-brand-400 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
                >
                  −
                </button>

                {/* Number input */}
                <input
                  id="hh-input"
                  ref={inputRef}
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min={MIN_HH}
                  max={MAX_HH}
                  step={1}
                  value={hh}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    if (e.target.value === "") return setHH("");
                    setHH(Number.isFinite(raw) ? raw : MIN_HH);
                  }}
                  onBlur={(e) => {
                    const raw = Number(e.target.value);
                    const clamped = Math.max(
                      MIN_HH,
                      Math.min(MAX_HH, Number.isFinite(raw) ? raw : MIN_HH)
                    );
                    setHH(clamped);
                  }}
                  className="flex-1 h-12 sm:h-11 px-2 rounded-2xl border border-brand-300 bg-white text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-200 text-center tabular-nums"
                  aria-describedby="hh-help"
                />

                {/* Increase */}
                <button
                  type="button"
                  aria-label="Increase household size"
                  onClick={() =>
                    setHH((n) =>
                      Math.max(
                        MIN_HH,
                        Math.min(MAX_HH, (Number(n) || MIN_HH) + 1)
                      )
                    )
                  }
                  className="h-12 sm:h-11 w-28 sm:w-12 rounded-2xl border border-brand-300 bg-white text-xl leading-none font-semibold hover:bg-brand-50 hover:border-brand-400 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
                >
                  +
                </button>
              </div>

              <p id="hh-help" className="mt-1 text-[11px] text-gray-500">
                Pick a number from {MIN_HH} to {MAX_HH}.
              </p>
            </div>
          </section>

          {/* Error (live region) */}
          <div aria-live="polite" className="min-h-[1rem]">
            {err ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 ring-1 ring-red-200 px-3 py-2 text-[13px] text-red-800">
                {err}
              </div>
            ) : null}
          </div>
        </form>

        {/* Consent note — mirrors NewClientForm placement */}
        <div className="mt-1 text-[9px] leading-snug text-gray-400 text-center px-2 max-w-md mx-auto">
          Visits are recorded for reporting and eligibility. Data stays within
          your organization unless required by law.
        </div>

        {/* Footer (sticky, matches NewClientForm proportions) */}
        <div
          className="sticky bottom-0 z-10 bg-white/95 backdrop-blur px-3 sm:px-6 pt-2 pb-4 flex flex-col items-center"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
        >
          <div className="w-full h-px bg-gray-200 mb-2" />
          <div className="flex items-center justify-between gap-2 w-full max-w-md mx-auto">
            <div />
            <div className="flex items-center gap-2">
              <button
                className="h-9 sm:h-10 px-4 sm:px-5 rounded-xl border border-brand-300 text-brand-800 bg-white hover:bg-brand-50 hover:border-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200 text-xs sm:text-sm font-semibold"
                onClick={onClose}
                type="button"
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className="h-12 sm:h-14 w-44 sm:w-56 px-6 sm:px-8 rounded-xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 text-white font-bold text-base sm:text-xl whitespace-nowrap shadow-md hover:from-brand-800 hover:via-brand-700 hover:to-brand-600 active:from-brand-900 active:via-brand-800 active:to-brand-700 disabled:opacity-50 transition-all duration-150"
                onClick={submit}
                type="button"
                disabled={busy}
              >
                {busy ? "Saving…" : "Log visit"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- tiny presentational helpers ---------- */
function SectionHeader({ icon, label }) {
  return (
    <div className="-mx-3 sm:-mx-4 -mt-3 sm:-mt-4 mb-3">
      <div className="flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-t-2xl bg-gradient-to-r from-brand-700 via-brand-600 to-brand-500 shadow-[0_4px_10px_rgba(148,27,21,0.3)]">
        {icon && <span className="flex items-center text-white">{icon}</span>}
        <div className="flex-1 text-xs sm:text-sm font-semibold leading-tight text-white [&_*]:text-white">
          {label}
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      role="img"
      aria-label="Loading"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        fill="none"
        opacity="0.25"
      />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        fill="none"
      />
    </svg>
  );
}
