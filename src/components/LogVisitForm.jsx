// src/components/LogVisitForm.jsx
// Ship-safe LogVisitForm (Oct 2025 hardening + polished header/body/footer)
// - Single Firestore transaction for: visit + client counters (+ optional USDA marker)
// - Create-once usda_first marker (only if not exists) using deterministic id: `${orgId}_${clientId}_${monthKey}`
// - Adds weekKey (YYYY-Www) and weekday (0–6) to visits
// - Visits store clientFirstName/clientLastName for resilient reporting
// - Preserves client's original orgId/locationId (no silent reassignment)
// - Blocks logging if client is inactive
// - Uses serverTimestamp() everywhere; atomic increment(1)
// - No writes of user context (avoids shared-login scope flips)
// - Household size control: steppers + numeric input with clamping

import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  increment,
} from "firebase/firestore";
import { db, auth } from "../lib/firebase";
import { useAuth } from "../auth/useAuth";

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

export default function LogVisitForm({
  open,
  client,          // { id, firstName, lastName, householdSize, ... }
  onClose,
  onSaved,
  // optional fixed scope overrides (usually leave undefined to use current auth scope)
  defaultOrgId,
  defaultLocationId,
}) {
  const [hh, setHH] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Manual USDA toggle — default No; setting Yes will *upsert* a monthly marker (never deletes).
  const [usdaFirstThisMonth, setUsdaFirstThisMonth] = useState(false);

  const inputRef = useRef(null);

  // Auth scope (read-only here)
  const authCtx = useAuth() || {};
  const orgId   = defaultOrgId ?? authCtx.org?.id ?? authCtx.activeOrg?.id ?? null;
  const locationId =
    defaultLocationId ?? authCtx.location?.id ?? authCtx.activeLocation?.id ?? null;
  const currentUserId = authCtx?.uid || auth.currentUser?.uid || null;

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
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [open, client?.id]);

  if (!open || !client) return null;

  async function submit() {
    if (busy) return;

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
        // Note: clients may be “assigned” to a location; we *do not* mutate their locationId here.
        // Visits track the actual location used (locationId below).

        // 2) If toggled Yes, create-once USDA marker (only if it does not exist)
        if (usdaFirstThisMonth) {
          const markerId = `${orgId}_${client.id}_${mKey}`;
          const markerRef = doc(db, "usda_first", markerId);
          const markerSnap = await tx.get(markerRef);
          if (!markerSnap.exists()) {
            tx.set(markerRef, {
              orgId,
              clientId: client.id,
              locationId,
              monthKey: mKey,
              createdAt: serverTimestamp(),
              createdByUserId: currentUserId,
            });
          }
        }

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

          // keys & timestamps
          visitAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          monthKey: mKey,
          dateKey: dKey,
          weekKey: wKey,
          weekday,

          // inputs & flags
          householdSize: Number(hhValue),
          usdaFirstTimeThisMonth: !!usdaFirstThisMonth,

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
    if (e.key === "Enter") submit();
  }

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <button
        aria-label="Close"
        className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Modal shell (centered on desktop, bottom sheet on mobile) */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="log-visit-title"
        className="
          absolute left-1/2 -translate-x-1/2 w-full sm:w-[min(620px,94vw)]
          bottom-0 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2
          bg-white sm:rounded-3xl rounded-t-3xl shadow-2xl ring-1 ring-brand-200/70
          overflow-hidden flex flex-col
        "
        onKeyDown={onKey}
      >
        {/* Header — matches NewClientForm style */}
        <div className="sticky top-0 z-10">
          <div className="bg-gradient-to-r from-[color:var(--brand-700)] to-[color:var(--brand-600)] text-white border-b shadow-sm">
            <div className="px-4 sm:px-6 py-3 sm:py-4">
              <div className="flex items-start sm:items-center justify-between gap-3 sm:gap-6">
                {/* Title + avatar */}
                <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
                  <div className="shrink-0 h-10 w-10 rounded-2xl bg-white/15 text-white grid place-items-center font-semibold ring-1 ring-white/20">
                    {initials}
                  </div>
                  <div className="min-w-0">
                    <h2 id="log-visit-title" className="text-base sm:text-xl font-semibold truncate">
                      Log Visit
                    </h2>
                    <p className="text-[11px] sm:text-xs opacity-90 truncate">
                      {name || "Client"}
                    </p>
                  </div>
                </div>

                {/* Org / Loc (desktop) */}
                <div className="hidden sm:flex flex-col text-[12px] leading-4 text-white/90">
                  <span>Org: <b>{orgId ?? "—"}</b></span>
                  <span>Loc: <b>{locationId ?? "—"}</b></span>
                </div>

                {/* Close */}
                <button
                  onClick={onClose}
                  className="rounded-xl px-3 h-10 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 shrink-0"
                  aria-label="Close"
                  title="Close"
                >
                  ✕
                </button>
              </div>

              {/* Org / Loc (mobile) */}
              <div className="mt-2 sm:hidden text-[11px] text-white/90 flex flex-wrap gap-x-4 gap-y-1">
                <span>Org: <b>{orgId ?? "—"}</b></span>
                <span>Loc: <b>{locationId ?? "—"}</b></span>
              </div>
            </div>
          </div>
        </div>

        {/* Context warning */}
        {!orgId || !locationId ? (
          <div
            role="alert"
            className="mx-4 sm:mx-6 mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800"
          >
            Select an Organization and Location from the navbar before logging a visit.
          </div>
        ) : null}

        {/* Body */}
        <div className="p-4 sm:p-6 grid gap-4 pretty-scroll">
          {/* USDA toggle — matches NewClientForm active gradient */}
          <div className="rounded-2xl border border-brand-200 p-3 sm:p-4">
            <div className="text-sm font-medium text-gray-800 mb-2">
              USDA first time this month?
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setUsdaFirstThisMonth(true)}
                className={[
                  "h-11 rounded-2xl border text-sm font-semibold transition-colors",
                  usdaFirstThisMonth
                    ? "bg-gradient-to-b from-[color:var(--brand-600)] to-[color:var(--brand-700)] text-white border-[color:var(--brand-700)] ring-1 ring-brand-700/40 shadow-[0_6px_14px_-6px_rgba(199,58,49,0.35)]"
                    : "bg-white text-brand-900 border-brand-300 hover:bg-brand-50 hover:border-brand-400",
                ].join(" ")}
                aria-pressed={usdaFirstThisMonth}
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setUsdaFirstThisMonth(false)}
                className={[
                  "h-11 rounded-2xl border text-sm font-semibold transition-colors",
                  !usdaFirstThisMonth
                    ? "bg-gradient-to-b from-[color:var(--brand-600)] to-[color:var(--brand-700)] text-white border-[color:var(--brand-700)] ring-1 ring-brand-700/40 shadow-[0_6px_14px_-6px_rgba(199,58,49,0.35)]"
                    : "bg-white text-brand-900 border-brand-300 hover:bg-brand-50 hover:border-brand-400",
                ].join(" ")}
                aria-pressed={!usdaFirstThisMonth}
              >
                No
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-600">
              If “Yes”, we’ll record this as the first USDA visit for {monthKeyFor()} and create a monthly marker.
            </p>
          </div>

          {/* Household size — steppers + numeric input */}
          <div className="rounded-2xl border border-brand-200 p-3 sm:p-4">
            <label htmlFor="hh-input" className="text-sm font-medium text-gray-800">
              Household size
            </label>

            <div className="mt-2 flex items-stretch gap-2">
              {/* Decrease */}
              <button
                type="button"
                aria-label="Decrease household size"
                onClick={() =>
                  setHH((n) => Math.max(MIN_HH, (Number(n) || MIN_HH) - 1))
                }
                className="h-12 w-12 rounded-2xl border border-brand-300 bg-white text-xl leading-none font-semibold hover:bg-brand-50 hover:border-brand-400 active:scale-95"
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
                className="flex-1 h-12 rounded-2xl border border-brand-300 bg-white px-3 text-lg font-semibold focus:outline-none focus:ring-4 focus:ring-brand-200 text-center tabular-nums"
                aria-describedby="hh-help"
              />

              {/* Increase */}
              <button
                type="button"
                aria-label="Increase household size"
                onClick={() =>
                  setHH((n) =>
                    Math.max(MIN_HH, Math.min(MAX_HH, (Number(n) || MIN_HH) + 1))
                  )
                }
                className="h-12 w-12 rounded-2xl border border-brand-300 bg-white text-xl leading-none font-semibold hover:bg-brand-50 hover:border-brand-400 active:scale-95"
              >
                +
              </button>
            </div>

            <p id="hh-help" className="mt-1 text-xs text-gray-500">
              Pick a number from {MIN_HH} to {MAX_HH}.
            </p>
          </div>

          {/* Error (live region) */}
          <div aria-live="polite" className="min-h-[1rem]">
            {err ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
                {err}
              </div>
            ) : null}
          </div>
        </div>

        {/* Footer — brand buttons to match the app */}
        <div
          className="sticky bottom-0 z-10 border-t bg-white/95 backdrop-blur px-4 sm:px-6 py-3 sm:py-4"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 6px)" }}
        >
          <div className="flex items-center justify-end gap-2">
            <button
              className="h-11 px-5 rounded-2xl border border-brand-300 text-brand-800 bg-white hover:bg-brand-50 hover:border-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
              onClick={onClose}
              type="button"
              disabled={busy}
            >
              Cancel
            </button>
            <button
              className="h-11 px-6 rounded-2xl bg-[color:var(--brand-700)] text-white font-semibold shadow-sm hover:bg-[color:var(--brand-600)] active:bg-[color:var(--brand-800)] transition disabled:opacity-50 inline-flex items-center gap-2"
              onClick={submit}
              type="button"
              disabled={busy}
            >
              {busy ? (
                <>
                  <Spinner />
                  Saving…
                </>
              ) : (
                "Log visit"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- tiny presentational helpers ---------- */
function Badge({ label, subtle = false }) {
  return (
    <span
      className={
        subtle
          ? "inline-flex items-center rounded-full border border-gray-300 px-2.5 py-1 text-[11px] text-gray-700"
          : "inline-flex items-center rounded-full bg-white text-gray-900 border border-brand-200 px-2.5 py-1 text-[11px]"
      }
      title={label}
    >
      {label}
    </span>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" role="img" aria-label="Loading">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" fill="none" />
    </svg>
  );
}
