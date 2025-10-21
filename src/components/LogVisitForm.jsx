// src/components/LogVisitForm.jsx
// Assumptions / notes:
// - Multi-tenant: visit writes include orgId + locationId from useAuth(); blocks save if missing.
// - USDA first-this-month remains automatic via a monthly marker (no manual toggle).
// - Heavily tuned for mobile: big tap targets, sticky footer, safe-area padding, strong focus rings.
// - A11y: roles/labels, aria-live for errors, keyboard shortcuts (Esc closes, Enter submits).

import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { db, auth } from "../lib/firebase";
import useAuth from "../auth/useAuth";

/* ---------- small helpers ---------- */
const monthKeyFor = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const dateKeyFor = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

const MIN_HH = 1;
const MAX_HH = 20;

export default function LogVisitForm({
  open,
  client,
  onClose,
  onSaved,
  defaultOrgId,
  defaultLocationId,
}) {
  const [hh, setHH] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef(null);

  // Auth context (defensive in case still loading)
  const authCtx = useAuth() || {};
  const orgId =
    defaultOrgId ??
    authCtx.org?.id ??
    authCtx.org ??
    authCtx.activeOrg?.id ??
    authCtx.activeOrg ??
    null;

  const locationId =
    defaultLocationId ??
    authCtx.location?.id ??
    authCtx.location ??
    authCtx.activeLocation?.id ??
    authCtx.activeLocation ??
    null;

  // Derive initials for a simple avatar
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

  // When sheet opens, reset & focus
  useEffect(() => {
    if (!open || !client?.id) return;
    const base = Number(client?.householdSize || 1) || 1;
    setHH(Math.max(MIN_HH, Math.min(MAX_HH, base)));
    setErr("");
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [open, client?.id]);

  if (!open || !client) return null;

  function coerceHH(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return MIN_HH;
    return Math.max(MIN_HH, Math.min(MAX_HH, Math.floor(n)));
  }

  async function submit() {
    if (busy) return;

    if (!orgId || !locationId) {
      setErr("Select an Organization and Location before logging a visit.");
      return;
    }

    const safeHH = coerceHH(hh);

    // Soft confirm if user typed above MAX
    if (Number(hh) !== safeHH && safeHH === MAX_HH) {
      const ok = confirm(`Household size will be capped at ${MAX_HH}. Continue?`);
      if (!ok) return;
    }

    setBusy(true);
    setErr("");
    try {
      const now = new Date();
      const monthKey = monthKeyFor(now);
      const dateKey = dateKeyFor(now);
      const currentUser = auth.currentUser?.uid || null;

      // Atomic: first-visit detection per (org + client + month)
      await runTransaction(db, async (tx) => {
        const markerRef = doc(db, "usda_first", `${orgId}_${client.id}_${monthKey}`);
        const markerSnap = await tx.get(markerRef);
        const isFirst = !markerSnap.exists();

        if (isFirst) {
          tx.set(markerRef, {
            orgId,
            clientId: client.id,
            monthKey,
            createdAt: serverTimestamp(),
          });
        }

        // Visit record
        const visitRef = doc(collection(db, "visits"));
        tx.set(visitRef, {
          orgId,
          locationId,
          clientId: client.id,
          clientFirstName: client.firstName || "",
          clientLastName: client.lastName || "",
          createdBy: currentUser,

          visitAt: serverTimestamp(),
          monthKey,
          dateKey,

          householdSize: safeHH,
          usdaFirstTimeThisMonth: isFirst,

          addedAt: serverTimestamp(),
        });

        // Light update to client
        const clientRef = doc(db, "clients", client.id);
        tx.set(
          clientRef,
          {
            orgId,
            householdSize: safeHH,
            lastVisitAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
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

  const quickSizes = [1, 2, 3, 4, 5, 6, 7, 8];

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
            <p className="text-xs text-gray-600 truncate">{name || "Client"}</p>
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

        {/* Inline warning if context missing */}
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
          {/* USDA note */}
          <div className="rounded-2xl border bg-surface-100/60 px-3 py-2.5">
            <p className="text-[13px] leading-snug text-gray-700">
              <span className="font-semibold">USDA eligibility</span> is auto-detected on save
              (first USDA visit this month per <span className="font-mono">org+client+month</span>).
              No manual toggle needed.
            </p>
          </div>

          {/* Household size stepper */}
          <div className="rounded-2xl border p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <label htmlFor="hh-input" className="text-sm font-medium text-gray-800">
                Household size
              </label>
              <div className="inline-flex items-center rounded-full border overflow-hidden">
                <button
                  type="button"
                  className="h-11 w-11 text-lg font-semibold hover:bg-gray-100 active:scale-[.98] disabled:opacity-40"
                  onClick={() => setHH((n) => Math.max(MIN_HH, Number(n) - 1))}
                  aria-label="Decrease household size"
                  disabled={busy || hh <= MIN_HH}
                >
                  –
                </button>
                <input
                  ref={inputRef}
                  id="hh-input"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  type="number"
                  min={MIN_HH}
                  max={MAX_HH}
                  value={hh}
                  onChange={(e) => setHH(coerceHH(e.target.value))}
                  className="w-16 text-center text-base font-semibold outline-none focus:ring-2 focus:ring-brand-200"
                  disabled={busy}
                  aria-describedby="hh-help"
                />
                <button
                  type="button"
                  className="h-11 w-11 text-lg font-semibold hover:bg-gray-100 active:scale-[.98] disabled:opacity-40"
                  onClick={() => setHH((n) => Math.min(MAX_HH, Number(n) + 1))}
                  aria-label="Increase household size"
                  disabled={busy || hh >= MAX_HH}
                >
                  +
                </button>
              </div>
            </div>

            <p id="hh-help" className="mt-1 text-xs text-gray-500">
              Allowed range: {MIN_HH}–{MAX_HH}. Larger families are capped at {MAX_HH}.
            </p>

            {/* Quick picks */}
            <div className="mt-3 flex flex-wrap gap-2">
              {quickSizes.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setHH(n)}
                  className={`h-9 px-3 rounded-full text-sm font-medium border transition
                    ${
                      hh === n
                        ? "bg-brand-600 text-white border-brand-600"
                        : "bg-white text-gray-800 border-gray-300 hover:bg-gray-50"
                    }`}
                  aria-pressed={hh === n}
                >
                  {n}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setHH(MAX_HH)}
                className={`h-9 px-3 rounded-full text-sm font-medium border transition
                  ${
                    hh === MAX_HH
                      ? "bg-brand-600 text-white border-brand-600"
                      : "bg-white text-gray-800 border-gray-300 hover:bg-gray-50"
                  }`}
                aria-pressed={hh === MAX_HH}
                title={`Set to ${MAX_HH}`}
              >
                {MAX_HH}+
              </button>
            </div>
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

/* ---------- tiny presentational helpers (no external deps) ---------- */

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
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      role="img"
      aria-label="Loading"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.25" />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        fill="none"
      />
    </svg>
  );
}
