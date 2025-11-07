// src/components/AddVisitButton.jsx
// Shepherds Table Cloud — Add Visit (Oct 2025 UI parity, scale-proof roles)
// - Capability guard: requires hasCapability('logVisits') or admin
// - Bottom sheet on mobile / centered card on desktop
// - Sticky gradient header + sticky controls strip + pretty-scroll results
// - HH steppers and USDA toggle styled like NewClientForm/LogVisitForm
// - Single transaction per add: visit + client counters (+ optional USDA monthly marker)
// - Deterministic USDA marker id: `${org.id}_${client.id}_${monthKey}`
// - Guards: cross-org, blocks inactive clients, preserves client scope (no reassignment)

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  collection,
  doc,
  getDocs,
  limit as qLimit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  increment,
} from "firebase/firestore";
import { db, auth } from "../lib/firebase";
import { Users, Soup, Search, Plus, Check, X } from "lucide-react";
import { useAuth } from "../auth/useAuth";

/* =========================
   Helpers
========================= */
function isoWeekKey(d = new Date()) {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
const monthKeyFor = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const cx = (...xs) => xs.filter(Boolean).join(" ");

const MIN_HH = 1;
const MAX_HH = 20;

const ICONS = {
  hh: <Users size={16} className="text-brand-600 inline mr-1" />,
  usda: <Soup size={16} className="text-brand-600 inline mr-1" />,
};

export default function AddVisitButton({
  org,
  location,
  selectedDate, // "YYYY-MM-DD"
  onAdded,
  disabled = false,
  className = "",
}) {
  const authCtx = useAuth() || {};
  const {
    hasCapability,
    isAdminForActiveOrg,
    canLogVisits, // convenience boolean from AuthProvider (if present)
  } = authCtx;

  // Capability: allow if admin or has 'logVisits'
  const allowLogVisits =
    isAdminForActiveOrg === true ||
    (typeof hasCapability === "function" && hasCapability("logVisits")) ||
    canLogVisits === true;

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // search + candidates
  const [search, setSearch] = useState("");
  const [cands, setCands] = useState([]);

  // visit controls
  const [hh, setHH] = useState(1);
  const [usda, setUSDA] = useState(true);

  // refs
  const inputRef = useRef(null);
  const dialogRef = useRef(null);

  const monthKey = useMemo(
    () => (selectedDate ? selectedDate.slice(0, 7) : ""),
    [selectedDate]
  );

  const loadCandidates = useCallback(async () => {
    if (!org?.id) return setCands([]);
    setBusy(true);
    try {
      const filters = [where("orgId", "==", org.id)];
      if (location?.id) filters.push(where("locationId", "==", location.id));
      const snap = await getDocs(
        query(
          collection(db, "clients"),
          ...filters,
          orderBy("firstName"),
          qLimit(200)
        )
      );
      setCands(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error("AddVisitButton: loadCandidates error", e);
      alert("Couldn’t load clients to add.");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }, [org?.id, location?.id]);

  const openSheet = useCallback(() => {
    if (!selectedDate) return;
    if (!allowLogVisits) {
      alert("You don’t have permission to log visits.");
      return;
    }
    setOpen(true);
    setHH(1);
    setUSDA(true);
    setSearch("");
  }, [selectedDate, allowLogVisits]);

  useEffect(() => {
    if (!open) return;
    loadCandidates();
  }, [open, loadCandidates]);

  // autofocus + ESC close
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 80);
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(id);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = (search || "").trim().toLowerCase();
    if (!q) return cands;
    return cands.filter((c) => {
      const name = `${c.firstName || ""} ${c.lastName || ""}`.toLowerCase();
      const addr = (c.address || "").toLowerCase();
      const zip = (c.zip || "").toLowerCase();
      return name.includes(q) || addr.includes(q) || zip.includes(q);
    });
  }, [search, cands]);

  const addVisit = useCallback(
    async (client) => {
      if (!allowLogVisits) {
        alert("You don’t have permission to log visits.");
        return;
      }
      if (!client || !org?.id || !selectedDate) return;
      // Hard guard: block inactive clients
      if (client.inactive === true) {
        alert("This client is deactivated. Reactivate before logging a visit.");
        return;
      }
      setBusy(true);
      try {
        // Compose concrete timestamp on the chosen day, at current time-of-day
        const now = new Date();
        const when = new Date(
          Number(selectedDate.slice(0, 4)),
          Number(selectedDate.slice(5, 7)) - 1,
          Number(selectedDate.slice(8, 10)),
          now.getHours(),
          now.getMinutes(),
          now.getSeconds(),
          now.getMilliseconds()
        );

        const mk = monthKey; // e.g. "2025-10"
        const dKey = selectedDate; // "YYYY-MM-DD"
        const wKey = isoWeekKey(when);
        const weekday = when.getDay(); // 0..6

        const latestHH = Math.max(MIN_HH, Math.min(MAX_HH, Number(hh || MIN_HH)));
        const isFirst = !!usda;
        const currentUser = auth.currentUser?.uid || null;
        const locId = location?.id || null;
        // Snapshot client contact info onto the visit (historical)
        let snapAddress = "";
        let snapZip = "";
        let snapCounty = "";

        await runTransaction(db, async (tx) => {
          // 1) Read client to ensure it exists and guard cross-org
          const clientRef = doc(db, "clients", client.id);
          const clientSnap = await tx.get(clientRef);
          if (!clientSnap.exists()) throw new Error("Client document not found.");
          const cur = clientSnap.data() || {};
          if (cur.orgId && cur.orgId !== org.id) {
            throw new Error("Client belongs to a different organization.");
          }
          if (cur.inactive === true) {
            throw new Error("This client is deactivated. Reactivate before logging a visit.");
          }

          snapAddress = cur.address || client.address || "";
          snapZip = cur.zip || client.zip || "";
          snapCounty = cur.county || client.county || "";

          // 2) USDA first marker (create-once)
          if (isFirst && mk) {
            const markerId = `${org.id}_${client.id}_${mk}`;
            const markerRef = doc(db, "usda_first", markerId);
            const markerSnap = await tx.get(markerRef);
            if (!markerSnap.exists()) {
              tx.set(markerRef, {
                orgId: org.id,
                clientId: client.id,
                locationId: locId || null,
                monthKey: mk,
                createdAt: serverTimestamp(),
                createdByUserId: currentUser || null,
              });
            }
          }

          // 3) Visit document
          const visitRef = doc(collection(db, "visits"));
          tx.set(visitRef, {
            orgId: org.id,
            locationId: locId,
            clientId: client.id,
            clientFirstName: client.firstName || cur.firstName || "",
            clientLastName: client.lastName || cur.lastName || "",

            // ⬇️ historical snapshots used by Reports & PDFs
            clientAddress: snapAddress,
            clientZip: snapZip,
            clientCounty: snapCounty,

            visitAt: when, // intentional (historical add)
            createdAt: serverTimestamp(),
            monthKey: mk,
            dateKey: dKey,
            weekKey: wKey,
            weekday,
            householdSize: Number(latestHH),
            usdaFirstTimeThisMonth: isFirst,
            createdByUserId: currentUser || null,
            editedAt: null,
            editedByUserId: null,
            addedByReports: true,
          });

          // 4) Client counters / last-visit (no silent reassignment)
          tx.update(clientRef, {
            lastVisitAt: serverTimestamp(),
            lastVisitMonthKey: mk,
            updatedAt: serverTimestamp(),
            updatedByUserId: currentUser || null,
            visitCountLifetime: increment(1),
            [`visitCountByMonth.${mk}`]: increment(1),
            householdSize: Number(latestHH),
          });
        });

        onAdded?.({
          id: crypto.randomUUID(),
          clientId: client.id,
          clientFirstName: client.firstName || "",
          clientLastName: client.lastName || "",
          orgId: org.id,
          locationId: location?.id || null,

          // ⬇️ mirror the snapshots for immediate UI
          clientAddress: snapAddress,
          clientZip: snapZip,
          clientCounty: snapCounty,

          visitAt: when,
          dateKey: dKey,
          monthKey: mk,
          weekKey: wKey,
          weekday,
          householdSize: Number(latestHH),
          usdaFirstTimeThisMonth: isFirst,
          addedByReports: true,
          createdAt: new Date(),
        });

        setOpen(false);
      } catch (e) {
        console.error("AddVisitButton: addVisit error", e);
        alert(e?.message || "Failed to add visit. Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [allowLogVisits, org?.id, location?.id, selectedDate, monthKey, hh, usda, onAdded]
  );

  return (
    <>
      {/* Entry button */}
      <button
        disabled={disabled || !selectedDate || !allowLogVisits}
        onClick={openSheet}
        title={allowLogVisits ? "Add a visit to this day" : "You don’t have permission to log visits"}
        aria-label="Add visit"
        className={cx(
          "inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white shadow-sm",
          "focus:outline-none focus-visible:ring-4",
          "active:scale-[.98] transition",
          disabled || !selectedDate || !allowLogVisits ? "opacity-60 pointer-events-none" : "",
          className
        )}
        style={{
          background:
            "linear-gradient(160deg, var(--brand-700) 0%, var(--brand-600) 55%, var(--brand-500) 100%)",
        }}
      >
        <Plus className="h-4 w-4 shrink-0" />
        Add Visit
      </button>

      {/* Sheet */}
      {open && (
        <div className="fixed inset-0 z-[1000]">
          {/* Backdrop */}
          <button
            className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
            onClick={() => setOpen(false)}
            aria-label="Close add modal"
          />

          {/* Panel */}
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-visit-title"
            className="
              absolute left-1/2 -translate-x-1/2 w-full sm:w-[min(760px,94vw)]
              bottom-0 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2
              bg-white shadow-2xl ring-1 ring-brand-200/70 overflow-hidden
              rounded-t-3xl sm:rounded-3xl
              flex flex-col
            "
            style={{ maxHeight: "calc(100vh - 28px)", marginTop: "env(safe-area-inset-top, 8px)" }}
          >
            {/* Header — brand gradient bar (sticky) */}
            <div className="sticky top-0 z-10">
              <div className="bg-gradient-to-r from-[color:var(--brand-700)] to-[color:var(--brand-600)] text-white border-b shadow-sm">
                <div className="px-4 sm:px-6 py-3 sm:py-4">
                  <div className="flex items-start sm:items-center justify-between gap-3 sm:gap-6">
                    {/* Title */}
                    <div className="min-w-0 flex-1">
                      <h2
                        id="add-visit-title"
                        className="text-base sm:text-xl font-semibold truncate"
                      >
                        Add Visit
                      </h2>
                      <p className="text-[11px] sm:text-xs opacity-90 truncate">
                        {selectedDate ? `to ${selectedDate}` : "Choose a date"}
                      </p>
                    </div>

                    {/* Context (desktop) */}
                    <div className="hidden sm:flex flex-col text-[12px] leading-4 text-white/90">
                      <span>
                        Org: <b>{org?.name ?? org?.id ?? "—"}</b>
                      </span>
                      <span>
                        Loc: <b>{location?.name ?? location?.id ?? "—"}</b>
                      </span>
                    </div>

                    {/* Close */}
                    <button
                      onClick={() => setOpen(false)}
                      className="rounded-xl px-3 h-9 sm:h-10 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 shrink-0"
                      aria-label="Close"
                      title="Close"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  {/* Context (mobile) */}
                  <div className="mt-2 sm:hidden text-[11px] text-white/90 flex flex-wrap gap-x-4 gap-y-1">
                    <span>
                      Org: <b>{org?.name ?? org?.id ?? "—"}</b>
                    </span>
                    <span>
                      Loc: <b>{location?.name ?? location?.id ?? "—"}</b>
                    </span>
                  </div>
                </div>
              </div>

              {/* Controls strip — sticky under header */}
              <div className="sticky top-[--header-bottom] px-4 sm:px-6 py-3 bg-white/95 backdrop-blur border-b z-10">
                <div className="grid gap-3 lg:grid-cols-[1fr,auto] items-center">
                  {/* Search */}
                  <div className="relative">
                    <input
                      ref={inputRef}
                      className="w-full rounded-2xl border border-brand-200 px-4 pl-11 py-3 h-12 text-[15px] shadow-sm bg-white placeholder:text-gray-400 focus:outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-200"
                      placeholder="Search name, address or ZIP…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      aria-label="Find client"
                    />
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                  </div>

                  {/* Quick controls — HH + USDA */}
                  <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
                    {/* HH label (icon) */}
                    <span className="hidden md:inline text-xs font-medium text-gray-700">
                      {ICONS.hh}Household size
                    </span>

                    {/* HH stepper */}
                    <div className="inline-flex items-center rounded-full border border-brand-300 bg-white overflow-hidden shadow-sm">
                      <button
                        type="button"
                        className="h-10 w-10 text-lg font-semibold hover:bg-brand-50 active:scale-[.98]"
                        onClick={() => setHH((n) => Math.max(MIN_HH, Number(n || MIN_HH) - 1))}
                        aria-label="Decrease household size"
                      >
                        −
                      </button>
                      <div className="px-3 text-sm font-semibold tabular-nums min-w-[2ch] text-center select-none">
                        {hh}
                      </div>
                      <button
                        type="button"
                        className="h-10 w-10 text-lg font-semibold hover:bg-brand-50 active:scale-[.98]"
                        onClick={() => setHH((n) => Math.min(MAX_HH, Number(n || MIN_HH) + 1))}
                        aria-label="Increase household size"
                      >
                        +
                      </button>
                    </div>

                    {/* USDA toggle (styled like other forms) */}
                    <div className="inline-flex rounded-2xl overflow-hidden border border-brand-300">
                      <button
                        type="button"
                        className={cx(
                          "px-3 h-9 text-sm font-semibold transition-colors",
                          usda
                            ? "bg-gradient-to-b from-[color:var(--brand-600)] to-[color:var(--brand-700)] text-white border-[color:var(--brand-700)]"
                            : "bg-white text-brand-900 hover:bg-brand-50"
                        )}
                        onClick={() => setUSDA(true)}
                        aria-pressed={usda}
                        title="USDA first visit this month"
                      >
                        {ICONS.usda}Yes
                      </button>
                      <button
                        type="button"
                        className={cx(
                          "px-3 h-9 text-sm font-semibold border-l transition-colors",
                          !usda
                            ? "bg-gradient-to-b from-[color:var(--brand-600)] to-[color:var(--brand-700)] text-white border-[color:var(--brand-700)]"
                            : "bg-white text-brand-900 hover:bg-brand-50"
                        )}
                        onClick={() => setUSDA(false)}
                        aria-pressed={!usda}
                        title="Not USDA"
                      >
                        No
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Results — roomy list with brand accents */}
            <div
              className="flex-1 overflow-auto pretty-scroll"
              style={{ WebkitOverflowScrolling: "touch" }}
              aria-label="Client search results"
            >
              {busy ? (
                <div className="p-6 space-y-2">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="h-14 rounded-xl bg-gray-100 animate-pulse" />
                  ))}
                </div>
              ) : (
                <ul className="divide-y">
                  {filtered.slice(0, 200).map((c) => {
                    const initials =
                      `${(c.firstName || "").slice(0, 1)}${(c.lastName || "").slice(0, 1)}`
                        .toUpperCase() || "👤";
                    const fullName =
                      `${c.firstName || ""} ${c.lastName || ""}`.trim() || c.id;
                    const line2 = [c.address || "", c.zip || ""]
                      .filter(Boolean)
                      .join(" • ");

                    return (
                      <li key={c.id} className={cx("p-3 sm:p-4", c.inactive ? "opacity-60" : "hover:bg-brand-50/70")}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-10 w-10 rounded-2xl bg-[color:var(--brand-50)] text-[color:var(--brand-900)] ring-1 ring-[color:var(--brand-200)] grid place-items-center text-sm font-semibold shrink-0">
                              {initials}
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium truncate text-[15px] text-gray-900">
                                {fullName}
                                {c.inactive && (
                                  <span className="ml-2 align-middle text-[11px] px-1.5 py-0.5 rounded-md bg-gray-200 text-gray-700">
                                    Inactive
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-gray-600 truncate">{line2}</div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-xs text-gray-500 hidden sm:inline">
                              HH {hh} • {usda ? "USDA" : "Non-USDA"}
                            </span>
                            <button
                              className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold text-white shadow-sm focus:outline-none focus-visible:ring-4 active:scale-[.98] transition disabled:opacity-50"
                              style={{
                                background:
                                  "linear-gradient(160deg, var(--brand-700) 0%, var(--brand-600) 55%, var(--brand-500) 100%)",
                              }}
                              onClick={() => addVisit(c)}
                              disabled={busy || c.inactive === true || !allowLogVisits}
                              title={
                                c.inactive
                                  ? "Client is inactive"
                                  : allowLogVisits
                                  ? "Add this client"
                                  : "You don’t have permission to log visits"
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.currentTarget.click();
                              }}
                            >
                              <Check className="h-4 w-4" />
                              Add
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}

                  {!busy && filtered.length === 0 && (
                    <li className="p-10 text-sm text-center text-gray-600">
                      No clients found. Try a different search.
                    </li>
                  )}
                </ul>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 sm:px-6 py-3 border-t bg-white">
              <div className="flex items-center justify-end gap-2">
                <button
                  className="h-11 px-5 rounded-2xl border border-brand-300 text-brand-800 bg-white hover:bg-brand-50 hover:border-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
                  onClick={() => setOpen(false)}
                >
                  Done
                </button>
              </div>
            </div>

            {/* Component-scoped styles */}
            <style>{`
              .pretty-scroll {
                scrollbar-color: rgba(0,0,0,.35) transparent;
                scrollbar-width: thin;
              }
              .pretty-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
              .pretty-scroll::-webkit-scrollbar-track {
                background: #fff;
                border-left: 6px solid transparent;
                background-clip: padding-box;
              }
              .pretty-scroll::-webkit-scrollbar-thumb {
                background: linear-gradient(180deg, rgba(0,0,0,.25), rgba(0,0,0,.35));
                border-radius: 999px;
                border-left: 6px solid transparent;
                background-clip: padding-box;
              }
            `}</style>
          </div>
        </div>
      )}
    </>
  );
}
