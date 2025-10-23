// src/components/LogVisitForm.jsx
// Ship-safe LogVisitForm
// - serverTimestamp() everywhere (no client clock)
// - Atomic counters with increment(1)
// - USDA monthly marker is idempotent per (orgId, clientId, monthKey)
// - Adds weekKey (YYYY-Www) and weekday (0–6) to visits
// - Keeps clientFirstName/clientLastName on visits for resiliency
// - No user-context writes (avoids shared-login scope flips)
// - Household size with steppers + direct typing

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

/* ---------- helpers ---------- */
const monthKeyFor = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const dateKeyFor = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

function isoWeekKey(d = new Date()) {
  // ISO week: Thursday-based calculation
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
  client,
  onClose,
  onSaved,
  // optional overrides if you ever want to log in a fixed scope
  defaultOrgId,
  defaultLocationId,
}) {
  const [hh, setHH] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Manual USDA toggle; default "No" so nothing is auto-marked
  const [usdaFirstThisMonth, setUsdaFirstThisMonth] = useState(false);

  const inputRef = useRef(null);

  // Auth context (defensive lookups; never written here)
  const authCtx = useAuth() || {};
  const orgId =
    defaultOrgId ?? authCtx.org?.id ?? authCtx.activeOrg?.id ?? null;
  const locationId =
    defaultLocationId ??
    authCtx.location?.id ??
    authCtx.activeLocation?.id ??
    null;
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

  // Reset each time the sheet opens or client changes
  useEffect(() => {
    if (!open || !client?.id) return;
    const base = Number(client?.householdSize || 1) || 1;
    setHH(Math.max(MIN_HH, Math.min(MAX_HH, base)));
    setUsdaFirstThisMonth(false); // default to No
    setErr("");
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [open, client?.id]);

  if (!open || !client) return null;

  async function submit() {
    if (busy) return;

    if (!orgId || !locationId) {
      setErr("Select an Organization and Location before logging a visit.");
      return;
    }
    if (!currentUserId) {
      setErr("You must be signed in to log a visit.");
      return;
    }

    setBusy(true);
    setErr("");
    try {
      const now = new Date();
      const mKey = monthKeyFor(now);
      const dKey = dateKeyFor(now);
      const wKey = isoWeekKey(now);
      const weekday = now.getDay(); // 0=Sun..6=Sat

      await runTransaction(db, async (tx) => {
        // If "Yes", upsert a deterministic USDA-first marker for this month.
        if (usdaFirstThisMonth) {
          const markerId = `${orgId}_${client.id}_${mKey}`;
          const markerRef = doc(db, "usda_first", markerId);
          tx.set(
            markerRef,
            {
              orgId,
              clientId: client.id,
              locationId,
              monthKey: mKey,
              createdAt: serverTimestamp(),
              createdByUserId: currentUserId,
            },
            { merge: true }
          );
        }

        // Create the visit
        const visitRef = doc(collection(db, "visits"));
        tx.set(visitRef, {
          orgId,
          locationId,
          clientId: client.id,
          clientFirstName: client.firstName || "",
          clientLastName: client.lastName || "",

          // keys & timestamps
          visitAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          monthKey: mKey,
          dateKey: dKey,
          weekKey: wKey,
          weekday,

          // inputs & flags
          householdSize: Number(hh),
          usdaFirstTimeThisMonth: !!usdaFirstThisMonth,

          // audit
          createdByUserId: currentUserId,
          editedAt: null,
          editedByUserId: null,

          // guard against programmatic inserts
          addedByReports: false,
        });

        // Atomic client updates
        const clientRef = doc(db, "clients", client.id);
        tx.set(
          clientRef,
          {
            // DO NOT change orgId/locationId here from elsewhere; we use active scope intentionally
            orgId,
            locationId,
            householdSize: Number(hh),

            lastVisitAt: serverTimestamp(),
            lastVisitMonthKey: mKey,

            updatedAt: serverTimestamp(),
            updatedByUserId: currentUserId,

            visitCountLifetime: increment(1),
            [`visitCountByMonth.${mKey}`]: increment(1),
          },
          { merge: true }
        );
      });

      onSaved?.();
      onClose?.();
    } catch (e) {
      console.error(e);
      setErr("Could not log the visit. Please try again.");
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
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="log-visit-title"
        className="absolute left-1/2 -translate-x-1/2 w-full sm:w-[min(560px,94vw)]
                   bottom-0 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2
                   bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl ring-1 ring-black/5
                   overflow-hidden flex flex-col"
        onKeyDown={onKey}
      >
        {/* Handle (mobile) */}
        <div className="sm:hidden flex justify-center pt-2">
          <div className="h-1.5 w-12 rounded-full bg-gray-300" />
        </div>

        {/* Header */}
        <div className="px-4 sm:px-5 py-3 border-b flex items-center gap-3">
          <div className="shrink-0 h-10 w-10 rounded-2xl bg-brand-600 text-white grid place-items-center font-semibold">
            {initials}
          </div>
          <div className="min-w-0">
            <h2 id="log-visit-title" className="text-base sm:text-lg font-semibold truncate">
              Log visit
            </h2>
            <p className="text-xs text-gray-600 truncate">
              {name || "Client"}
            </p>
          </div>
          <div className="ml-auto hidden sm:flex items-center gap-2">
            <Badge label={orgId || "Org —"} />
            <Badge label={locationId || "Location —"} />
          </div>
          <button
            className="ml-1 inline-flex h-10 w-10 items-center justify-center rounded-xl hover:bg-gray-100 active:scale-[.98] transition"
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Context warning */}
        {!orgId || !locationId ? (
          <div
            role="alert"
            className="mx-4 sm:mx-5 mt-3 mb-0 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800"
          >
            Select an Organization and Location from the navbar before logging a visit.
          </div>
        ) : null}

        {/* Body */}
        <div className="p-4 sm:p-5 grid gap-4">
          {/* USDA toggle */}
          <div className="rounded-2xl border p-3 sm:p-4">
            <div className="text-sm font-medium text-gray-800 mb-2">
              USDA first time this month?
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setUsdaFirstThisMonth(true)}
                className={`h-11 rounded-xl border text-sm font-semibold transition
                  ${
                    usdaFirstThisMonth
                      ? "bg-brand-700 text-white border-brand-700"
                      : "bg-white text-gray-800 border-gray-300 hover:bg-gray-50"
                  }`}
                aria-pressed={usdaFirstThisMonth}
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setUsdaFirstThisMonth(false)}
                className={`h-11 rounded-xl border text-sm font-semibold transition
                  ${
                    !usdaFirstThisMonth
                      ? "bg-brand-700 text-white border-brand-700"
                      : "bg-white text-gray-800 border-gray-300 hover:bg-gray-50"
                  }`}
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
          <div className="rounded-2xl border p-3 sm:p-4">
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
                className="h-12 w-12 rounded-xl border border-brand-200 bg-white text-2xl leading-none font-semibold hover:bg-gray-50 active:scale-[.98] select-none"
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
                className="flex-1 h-12 rounded-xl border border-brand-200 bg-white px-3 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-brand-200 text-center tabular-nums"
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
                className="h-12 w-12 rounded-xl border border-brand-200 bg-white text-2xl leading-none font-semibold hover:bg-gray-50 active:scale-[.98] select-none"
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

        {/* Footer */}
        <div
          className="px-4 sm:px-5 py-3 border-t bg-white flex items-center justify-between gap-3
                     [padding-bottom:calc(env(safe-area-inset-bottom)+0.5rem)]"
        >
          <div className="hidden sm:flex items-center gap-2 text-[11px] text-gray-600">
            <Badge subtle label={orgId || "Org —"} />
            <span>•</span>
            <Badge subtle label={locationId || "Location —"} />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              className="h-11 px-5 rounded-xl border hover:bg-gray-50 active:scale-[.98] transition"
              onClick={onClose}
              type="button"
              disabled={busy}
            >
              Cancel
            </button>
            <button
              className="h-11 px-5 rounded-xl bg-brand-700 text-white hover:bg-brand-800 active:scale-[.98] transition disabled:opacity-50 inline-flex items-center gap-2"
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
