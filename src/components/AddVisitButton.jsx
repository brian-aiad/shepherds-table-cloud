// src/components/AddVisitButton.jsx
// Shepherds Table Cloud — Add Visit (collapsible row • pro UI, Nov 2025)
// - Row expands into a compact control bar: HH (− / number / +), USDA Yes/No, Add
// - Persisted “Auto-close after save” (localStorage) — closes modal on successful add
// - Sticky defaults: ZIP 90813 + County “Los Angeles County” used when missing (also persisted for intake to reuse)
// - Homeless-friendly search: typing “homeless” matches clients with blank/“homeless” addresses
// - Capability guard (admin or 'logVisits'), requires specific location, active clients only
// - Stable Firestore txn (visit + counters + USDA monthly marker). onAdded gets real id
// - USDA-first parity with LogVisitForm: monthly marker pre-check + in-tx recheck
// - Confirmation banner: “Added <Name> for <YYYY-MM-DD>”.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  getDoc, // ⬅️ monthly marker pre-check
  increment,
  limit as qLimit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db, auth } from "../lib/firebase";
import { useAuth } from "../auth/useAuth";
import {
  Plus,
  Minus,
  Search,
  Users,
  Soup,
  Check,
  CheckCircle2,
  X,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

/* =========================
   Helpers
========================= */
const cx = (...xs) => xs.filter(Boolean).join(" ");
const MIN_HH = 1;
const MAX_HH = 20;

// localStorage keys
const AUTO_CLOSE_KEY = "stc.add.autoClose";
const DEFAULT_ZIP_KEY = "stc.intake.defaultZip";
const DEFAULT_COUNTY_KEY = "stc.intake.defaultCounty";

// hard defaults (also written to LS on first use)
const FALLBACK_ZIP = "90813";
const FALLBACK_COUNTY = "Los Angeles County";

function getLS(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function setLS(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {}
}

function isoWeekKey(d = new Date()) {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
const monthKeyFor = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/* =========================
   Component
========================= */
export default function AddVisitButton({
  org,
  location,
  selectedDate, // "YYYY-MM-DD"
  onAdded,
  disabled = false,
  className = "",
}) {
  const authCtx = useAuth() || {};
  const { hasCapability, isAdminForActiveOrg, canLogVisits } = authCtx;

  const allowLogVisits =
    isAdminForActiveOrg === true ||
    (typeof hasCapability === "function" && hasCapability("logVisits")) ||
    canLogVisits === true;

  const isAll = !location?.id;

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // clients
  const [search, setSearch] = useState("");
  const [cands, setCands] = useState([]);

  // row scoped
  const [expandedId, setExpandedId] = useState(null);
  const [rowHH, setRowHH] = useState(1);
  const [rowUsdaYes, setRowUsdaYes] = useState(true);

  // USDA monthly eligibility per client for the selected month
  // Map<clientId, { allowed: boolean, checking: boolean }>
  const [usdaElig, setUsdaElig] = useState({});

  // add confirmation (legacy two-step removed; immediate add)
  const [confirmForId, setConfirmForId] = useState(null);
  const confirmTimerRef = useRef(null);

  // confirmation banner (top of modal)
  const [confirmMsg, setConfirmMsg] = useState("");

  // persisted UI prefs
  const [autoClose, setAutoClose] = useState(() => getLS(AUTO_CLOSE_KEY, true));
  useEffect(() => setLS(AUTO_CLOSE_KEY, autoClose), [autoClose]);

  // ensure default ZIP/County exist in LS (so Intake can reuse)
  useEffect(() => {
    if (getLS(DEFAULT_ZIP_KEY, null) === null) setLS(DEFAULT_ZIP_KEY, FALLBACK_ZIP);
    if (getLS(DEFAULT_COUNTY_KEY, null) === null)
      setLS(DEFAULT_COUNTY_KEY, FALLBACK_COUNTY);
  }, []);

  // refs
  const inputRef = useRef(null);
  const dialogRef = useRef(null);

  const monthKey = useMemo(() => {
    if (!selectedDate) return "";
    return selectedDate.slice(0, 7); // YYYY-MM
  }, [selectedDate]);

  /* ---------- Load active candidates for org + (optional) location ---------- */
  const loadCandidates = useCallback(async () => {
    if (!org?.id) {
      setCands([]);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const filters = [where("orgId", "==", org.id)];
      if (location?.id) filters.push(where("locationId", "==", location.id));

      const qv = query(
        collection(db, "clients"),
        ...filters,
        orderBy("firstName"),
        qLimit(1000)
      );

      const snap = await getDocs(qv);
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((c) => c.inactive !== true);

      setCands(rows);
    } catch (e) {
      console.error("AddVisitButton: loadCandidates error", e);
      setError("Couldn’t load clients.");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }, [org?.id, location?.id]);

  /* ---------- USDA marker pre-check for one client (selected month) ---------- */
  const checkUsdaEligibility = useCallback(
    async (clientId) => {
      if (!open || !org?.id || !monthKey || !clientId) return;

      setUsdaElig((m) => ({ ...m, [clientId]: { ...(m[clientId] || {}), checking: true } }));
      try {
        const markerId = `${org.id}_${clientId}_${monthKey}`;
        const snap = await getDoc(doc(db, "usda_first", markerId));
        const allowed = !snap.exists();
        setUsdaElig((m) => ({ ...m, [clientId]: { allowed, checking: false } }));
        if (!allowed && expandedId === clientId) {
          // Force UI to "No" if already counted this month
          setRowUsdaYes(false);
        }
      } catch {
        // If we can't check, default to allowed so we don't block;
        // Firestore rules will still protect on create
        setUsdaElig((m) => ({ ...m, [clientId]: { allowed: true, checking: false } }));
      }
    },
    [open, org?.id, monthKey, expandedId]
  );

  /* ---------- Open modal ---------- */
  const openSheet = useCallback(() => {
    if (!selectedDate) return;
    if (!allowLogVisits) {
      alert("You don’t have permission to log visits.");
      return;
    }
    if (isAll) {
      alert("Pick a specific location to add a visit.");
      return;
    }
    setConfirmMsg("");
    setSearch("");
    setExpandedId(null);
    setRowHH(1);
    setRowUsdaYes(true);
    setUsdaElig({}); // clear month-scoped cache when re-opening
    setConfirmForId(null);
    clearTimeout(confirmTimerRef.current);
    setOpen(true);
  }, [selectedDate, allowLogVisits, isAll]);

  /* ---------- Effects ---------- */
  useEffect(() => {
    if (!open) return;
    loadCandidates();
  }, [open, loadCandidates]);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 80);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(id);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    return () => clearTimeout(confirmTimerRef.current);
  }, []);

  // Reset USDA cache when the selected month changes
  useEffect(() => {
    setUsdaElig({});
    if (expandedId) {
      // Re-check the expanded one for the new month
      checkUsdaEligibility(expandedId);
    }
  }, [monthKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Search filter + count ---------- */
  const filtered = useMemo(() => {
    const q = (search || "").trim().toLowerCase();
    if (!q) return cands;
    const isLookingForHomeless = q.includes("homeless");
    return cands.filter((c) => {
      const name = `${c.firstName || ""} ${c.lastName || ""}`.toLowerCase();
      const addrRaw = (c.address || "").toLowerCase();
      const addr = addrRaw.replace(/\s+/g, " ").trim();
      const zip = (c.zip || "").toLowerCase();

      const baseMatch = name.includes(q) || addr.includes(q) || zip.includes(q);
      if (baseMatch) return true;

      // Homeless-friendly: if query contains “homeless”, match clients with blank address or address containing “homeless”
      if (isLookingForHomeless) {
        if (!addr || addr.includes("homeless")) return true;
      }
      return false;
    });
  }, [search, cands]);

  const clientCount = filtered.length;

  /* ---------- Row expand ---------- */
  const expandRow = useCallback(
    (client) => {
      if (!client) return;
      const next = expandedId === client.id ? null : client.id;
      setExpandedId(next);
      setConfirmForId(null);
      clearTimeout(confirmTimerRef.current);

      if (next) {
        const baseHH = Math.max(
          MIN_HH,
          Math.min(MAX_HH, Number(client.householdSize || 1))
        );
        setRowHH(baseHH);
        setRowUsdaYes(true);
        // Pre-check USDA eligibility for this client+month
        checkUsdaEligibility(client.id);
      }
    },
    [expandedId, checkUsdaEligibility]
  );

  /* ---------- Add Visit (row-scoped) ---------- */
  const addVisit = useCallback(
    async (client, hhOverride, usdaOverride) => {
      const hhVal = Math.max(
        MIN_HH,
        Math.min(MAX_HH, Number(hhOverride || MIN_HH))
      );

      const elig = usdaElig[client?.id];
      const usdaAllowed = elig ? !!elig.allowed : true;
      const wantsUsda = !!usdaOverride && usdaAllowed;

      if (!allowLogVisits) {
        alert("You don’t have permission to log visits.");
        return;
      }
      if (isAll) {
        alert("Pick a specific location to add a visit.");
        return;
      }
      if (!client || !org?.id || !selectedDate) return;
      if (client.inactive === true) {
        alert("This client is deactivated. Reactivate before logging a visit.");
        return;
      }

      setBusy(true);
      setError("");
      try {
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

        const mk = monthKey;
        const dKey = selectedDate;
        const wKey = isoWeekKey(when);
        const weekday = when.getDay();
        const currentUser = auth.currentUser?.uid || null;
        const locId = location?.id || null;

        const visitRef = doc(collection(db, "visits"));

        const fullName =
          `${client.firstName || ""} ${client.lastName || ""}`.trim() ||
          client.id;

        // pull sticky defaults
        const stickyZip = getLS(DEFAULT_ZIP_KEY, FALLBACK_ZIP) || FALLBACK_ZIP;
        const stickyCounty =
          getLS(DEFAULT_COUNTY_KEY, FALLBACK_COUNTY) || FALLBACK_COUNTY;

        let snapAddress = "";
        let snapZip = "";
        let snapCounty = "";

        await runTransaction(db, async (tx) => {
          const clientRef = doc(db, "clients", client.id);
          const clientSnap = await tx.get(clientRef);
          if (!clientSnap.exists()) throw new Error("Client document not found.");
          const cur = clientSnap.data() || {};

          if (cur.orgId && cur.orgId !== org.id) {
            throw new Error("Client belongs to a different organization.");
          }
          if (cur.inactive === true) {
            throw new Error(
              "This client is deactivated. Reactivate before logging a visit."
            );
          }

          // snapshot (apply sticky defaults when missing)
          snapAddress = cur.address || client.address || "";
          snapZip = (cur.zip || client.zip || "").trim() || stickyZip;
          snapCounty = (cur.county || client.county || "").trim() || stickyCounty;

          // keep defaults fresh in LS for intake to reuse
          if (snapZip) setLS(DEFAULT_ZIP_KEY, snapZip);
          if (snapCounty) setLS(DEFAULT_COUNTY_KEY, snapCounty);

          // USDA monthly marker (create-once; re-check inside the txn)
          if (wantsUsda && mk) {
            const markerId = `${org.id}_${client.id}_${mk}`;
            const markerRef = doc(db, "usda_first", markerId);
            const markerSnap = await tx.get(markerRef);
            if (!markerSnap.exists()) {
              const markerLocId = locId || cur.locationId || null;
              tx.set(markerRef, {
                orgId: org.id,
                clientId: client.id,
                locationId: markerLocId,
                monthKey: mk,
                createdAt: serverTimestamp(),
                createdByUserId: currentUser || null,
              });
            }
          }

          tx.set(visitRef, {
            orgId: org.id,
            locationId: locId,
            clientId: client.id,
            clientFirstName: client.firstName || cur.firstName || "",
            clientLastName: client.lastName || cur.lastName || "",
            clientAddress: snapAddress,
            clientZip: snapZip,
            clientCounty: snapCounty,
            visitAt: when,
            createdAt: serverTimestamp(),
            monthKey: mk,
            dateKey: dKey,
            weekKey: wKey,
            weekday,
            householdSize: Number(hhVal),
            // only true if user chose Yes AND it's allowed this month
            usdaFirstTimeThisMonth: !!(wantsUsda && mk),
            createdByUserId: currentUser || null,
            editedAt: null,
            editedByUserId: null,
            addedByReports: true,
          });

          tx.update(clientRef, {
            lastVisitAt: serverTimestamp(),
            lastVisitMonthKey: mk,
            updatedAt: serverTimestamp(),
            updatedByUserId: currentUser || null,
            visitCountLifetime: increment(1),
            [`visitCountByMonth.${mk}`]: increment(1),
            householdSize: Number(hhVal),
          });
        });

        onAdded?.({
          id: visitRef.id,
          clientId: client.id,
          clientFirstName: client.firstName || "",
          clientLastName: client.lastName || "",
          orgId: org.id,
          locationId: location?.id || null,
          clientAddress: snapAddress,
          clientZip: snapZip,
          clientCounty: snapCounty,
          visitAt: when,
          dateKey: dKey,
          monthKey: mk,
          weekKey: wKey,
          weekday,
          householdSize: Number(hhVal),
          usdaFirstTimeThisMonth: !!(wantsUsda && mk),
          addedByReports: true,
          createdAt: new Date(),
        });

        setConfirmMsg(`Added ${fullName} for ${dKey}.`);
        setExpandedId(null);
        setConfirmForId(null);

        // Auto-close after save (persisted)
        if (autoClose) setOpen(false);
      } catch (e) {
        console.error("AddVisitButton: addVisit error", e);
        setError(e?.message || "Failed to add visit. Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [
      allowLogVisits,
      isAll,
      org?.id,
      location?.id,
      selectedDate,
      monthKey,
      onAdded,
      autoClose,
      usdaElig,
    ]
  );

  /* =========================
     Render
  ========================== */
  return (
    <>
      {/* Entry button */}
      <button
        disabled={disabled || !selectedDate || !allowLogVisits || isAll}
        onClick={openSheet}
        title={
          !allowLogVisits
            ? "You don’t have permission to log visits"
            : isAll
            ? "Pick a specific location to add a visit"
            : "Add a visit to this day"
        }
        aria-label="Add visit"
        className={cx(
          "min-w-[120px] inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 px-3.5 py-2.5 text-white font-semibold shadow hover:from-brand-800 hover:via-brand-700 hover:to-brand-600 active:from-brand-900 active:via-brand-800 active:to-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-300 transition",
          disabled || !selectedDate || !allowLogVisits || isAll
            ? "opacity-60 pointer-events-none"
            : "",
          className
        )}
      >
        <Plus className="h-4 w-4 shrink-0" />
        Add Visit
      </button>

      {/* Modal */}
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
              absolute left-1/2 -translate-x-1/2 w-full sm:w-[min(780px,94vw)]
              bottom-0 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2
              bg-white shadow-2xl ring-1 ring-brand-200/70 overflow-hidden
              rounded-t-3xl sm:rounded-3xl
              flex flex-col
            "
            style={{
              maxHeight: "calc(100vh - 28px)",
              marginTop: "env(safe-area-inset-top, 8px)",
            }}
          >
            {/* Header */}
            <div className="sticky top-0 z-10">
              <div className="bg-gradient-to-r from-[color:var(--brand-700)] to-[color:var(--brand-600)] text-white border-b shadow-sm">
                <div className="px-4 sm:px-6 py-3 sm:py-4">
                  <div className="flex items-start sm:items-center justify-between gap-3 sm:gap-6">
                    <div className="min-w-0 flex-1">
                      <h2
                        id="add-visit-title"
                        className="text-base sm:text-xl font-semibold truncate"
                      >
                        Add Visit
                      </h2>
                      <p className="text-[11px] sm:text-xs opacity-90 truncate">
                        {selectedDate ? `for ${selectedDate}` : "Choose a date"}
                      </p>
                    </div>

                    <div className="hidden sm:flex flex-col text-[12px] leading-4 text-white/90">
                      <span>
                        Org: <b>{org?.name ?? org?.id ?? "—"}</b>
                      </span>
                      <span>
                        Loc: <b>{location?.name ?? location?.id ?? "—"}</b>
                      </span>
                    </div>

                    <button
                      onClick={() => setOpen(false)}
                      className="rounded-xl px-3 h-9 sm:h-10 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 shrink-0"
                      aria-label="Close"
                      title="Close"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Controls strip (search + count + banners) */}
              <div className="sticky top-[--header-bottom] px-4 sm:px-6 py-3 bg-white/95 backdrop-blur border-b z-10">
                {confirmMsg && (
                  <div
                    role="status"
                    className="mb-3 flex items-center justify-between rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900"
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>{confirmMsg}</span>
                    </div>
                    <button
                      className="text-green-800/80 hover:text-green-900"
                      onClick={() => setConfirmMsg("")}
                      aria-label="Dismiss"
                      title="Dismiss"
                    >
                      ×
                    </button>
                  </div>
                )}

                {error && (
                  <div
                    role="alert"
                    className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
                  >
                    {error}
                  </div>
                )}

                <div className="grid gap-3 lg:grid-cols-[1fr,auto] items-center">
                  {/* Search */}
                  <div className="relative">
                    <input
                      ref={inputRef}
                      className="w-full rounded-2xl border border-brand-200 px-4 pl-11 py-3 h-12 text-[15px] shadow-sm bg-white placeholder:text-gray-400 focus:outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-200"
                      placeholder='Search name, address or ZIP… (tip: try "homeless")'
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        if (expandedId) setExpandedId(null);
                        setConfirmForId(null);
                      }}
                      aria-label="Find client"
                    />
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                  </div>

                  {/* Client count */}
                  <div className="flex items-center justify-end">
                    <span
                      className="inline-flex items-center gap-2 rounded-full border border-brand-300 bg-white px-3 py-1.5 text-xs font-semibold text-brand-900 shadow-sm"
                      aria-live="polite"
                    >
                      Clients
                      <span className="inline-flex h-6 min-w-[1.75rem] items-center justify-center rounded-full bg-brand-700 px-2 text-white">
                        {clientCount}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Results */}
            <div
              className="flex-1 overflow-auto pretty-scroll"
              style={{ WebkitOverflowScrolling: "touch" }}
              aria-label="Client search results"
            >
              {busy ? (
                <div className="p-6 space-y-2">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-14 rounded-xl bg-gray-100 animate-pulse"
                    />
                  ))}
                </div>
              ) : (
                <ul className="divide-y">
                  {filtered.slice(0, 800).map((c) => {
                    const initials =
                      `${(c.firstName || "").slice(0, 1)}${(c.lastName || "").slice(0, 1)}`
                        .toUpperCase() || "👤";
                    const fullName =
                      `${c.firstName || ""} ${c.lastName || ""}`.trim() || c.id;
                    const sub = [c.address || "", c.zip || ""]
                      .filter(Boolean)
                      .join(" • ");
                    const isOpen = expandedId === c.id;

                    const elig = usdaElig[c.id] || { allowed: true, checking: false };
                    const usdaYesDisabled = elig.checking || !elig.allowed;

                    return (
                      <li key={c.id} className="p-0">
                        {/* Row (click to expand) */}
                        <button
                          type="button"
                          className={cx(
                            "w-full text-left p-3 sm:p-4 transition-colors",
                            "hover:bg-brand-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
                            isOpen ? "bg-brand-50/70" : ""
                          )}
                          onClick={() => expandRow(c)}
                          aria-expanded={isOpen}
                          aria-controls={`visit-row-${c.id}`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="h-10 w-10 rounded-2xl bg-[color:var(--brand-50)] text-[color:var(--brand-900)] ring-1 ring-[color:var(--brand-200)] grid place-items-center text-sm font-semibold shrink-0">
                                {initials}
                              </div>
                              <div className="min-w-0">
                                <div className="font-medium truncate text-[15px] text-gray-900">
                                  {fullName}
                                </div>
                                <div className="text-xs text-gray-600 truncate">
                                  {sub || "—"}
                                </div>
                              </div>
                            </div>
                            <div className="shrink-0 text-gray-400">
                              {isOpen ? (
                                <ChevronDown className="h-5 w-5" />
                              ) : (
                                <ChevronRight className="h-5 w-5" />
                              )}
                            </div>
                          </div>
                        </button>

                        {/* Inline controls (accordion) */}
                        <div
                          id={`visit-row-${c.id}`}
                          className={cx(
                            "transition-[grid-template-rows] duration-300 ease-out grid",
                            isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                          )}
                        >
                          <div className="overflow-hidden">
                            <div className="px-3 sm:px-4 pb-3 sm:pb-4">
                              <div className="rounded-2xl border border-brand-200 bg-white shadow-sm">
                                <div className="grid items-center gap-3 sm:gap-4 px-3 py-3 sm:px-4 sm:py-4 lg:grid-cols-[1fr,auto,auto]">
                                  {/* HH (− / input / +) */}
                                  <div className="flex items-center gap-3">
                                    <label className="text-xs font-medium text-gray-700 whitespace-nowrap select-none">
                                      <Users
                                        size={16}
                                        className="text-brand-600 inline mr-1"
                                      />
                                      Household size
                                    </label>

                                    <div
                                      className="
                                        inline-flex items-center overflow-hidden rounded-2xl bg-white
                                        border border-brand-300 ring-1 ring-brand-100 shadow-soft
                                        focus-within:ring-2 focus-within:ring-brand-200
                                      "
                                      aria-label="Adjust household size"
                                    >
                                      <button
                                        type="button"
                                        className="h-10 w-10 grid place-items-center text-lg font-semibold hover:bg-brand-50 active:scale-[.98] focus:outline-none"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setRowHH((n) =>
                                            Math.max(
                                              MIN_HH,
                                              Number(n || MIN_HH) - 1
                                            )
                                          );
                                        }}
                                        aria-label="Decrease household size"
                                      >
                                        <Minus className="h-4 w-4" />
                                      </button>

                                      <input
                                        type="number"
                                        min={MIN_HH}
                                        max={MAX_HH}
                                        value={rowHH}
                                        onChange={(e) => {
                                          const v = Number(
                                            e.target.value || MIN_HH
                                          );
                                          setRowHH(
                                            Math.max(
                                              MIN_HH,
                                              Math.min(MAX_HH, v)
                                            )
                                          );
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        onWheel={(e) =>
                                          e.currentTarget.blur()
                                        }
                                        className="
                                          h-10 w-[84px] border-x border-brand-200 bg-white text-center
                                          text-sm font-semibold tabular-nums tracking-tight
                                          focus:outline-none
                                        "
                                        aria-live="polite"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                      />

                                      <button
                                        type="button"
                                        className="h-10 w-10 grid place-items-center text-lg font-semibold hover:bg-brand-50 active:scale-[.98] focus:outline-none"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setRowHH((n) =>
                                            Math.min(
                                              MAX_HH,
                                              Number(n || MIN_HH) + 1
                                            )
                                          );
                                        }}
                                        aria-label="Increase household size"
                                      >
                                        <Plus className="h-4 w-4" />
                                      </button>
                                    </div>
                                  </div>

                                  {/* USDA toggle (with monthly eligibility) */}
                                  <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 justify-start lg:justify-center">
                                    <label className="text-xs font-medium text-gray-700 select-none leading-none">
                                      USDA
                                    </label>

                                    <div
                                      className="
                                        inline-flex w-auto shrink-0 self-start sm:self-auto
                                        rounded-2xl overflow-hidden bg-white
                                        border border-brand-300 ring-1 ring-brand-100 shadow-soft
                                      "
                                      role="group"
                                      aria-label="USDA first visit this month"
                                      title={
                                        usdaElig[c.id]?.checking
                                          ? "Checking eligibility…"
                                          : usdaElig[c.id]?.allowed === false
                                          ? `Already counted for ${monthKey}`
                                          : "Mark this as first USDA visit this month"
                                      }
                                    >
                                      <button
                                        type="button"
                                        className={cx(
                                          "h-9 px-3 sm:px-4 text-sm font-semibold transition-colors focus:outline-none",
                                          usdaYesDisabled
                                            ? "opacity-60 cursor-not-allowed"
                                            : "hover:bg-brand-50",
                                          rowUsdaYes && !usdaYesDisabled
                                            ? "bg-gradient-to-b from-[color:var(--brand-600)] to-[color:var(--brand-700)] text-white shadow"
                                            : "text-brand-900"
                                        )}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (!usdaYesDisabled) setRowUsdaYes(true);
                                        }}
                                        aria-pressed={rowUsdaYes && !usdaYesDisabled}
                                      >
                                        <Soup size={16} className="inline mr-1" />
                                        Yes
                                      </button>

                                      <div
                                        className="w-px bg-brand-200/70"
                                        aria-hidden="true"
                                      />

                                      <button
                                        type="button"
                                        className={cx(
                                          "h-9 px-3 sm:px-4 text-sm font-semibold transition-colors focus:outline-none",
                                          "hover:bg-brand-50",
                                          !rowUsdaYes || usdaYesDisabled
                                            ? "bg-gradient-to-b from-[color:var(--brand-600)] to-[color:var(--brand-700)] text-white shadow"
                                            : "text-brand-900"
                                        )}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setRowUsdaYes(false);
                                        }}
                                        aria-pressed={!rowUsdaYes || usdaYesDisabled}
                                      >
                                        No
                                      </button>
                                    </div>
                                  </div>

                                  {/* Actions */}
                                  <div className="flex items-center justify-end gap-2 sm:gap-3">
                                    <button
                                      className="
                                        h-9 px-3 rounded-xl border border-brand-300 text-brand-800
                                        bg-white hover:bg-brand-50 hover:border-brand-400
                                        active:scale-[.99] focus:outline-none
                                      "
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setExpandedId(null);
                                        setConfirmForId(null);
                                      }}
                                      title="Cancel"
                                    >
                                      Cancel
                                    </button>

                                    <button
                                      className={cx(
                                        "inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold text-white",
                                        "shadow-sm transition focus:outline-none focus-visible:ring-4 active:scale-[.98]",
                                        "hover:brightness-105 hover:contrast-110"
                                      )}
                                      style={{
                                        background:
                                          "linear-gradient(160deg, var(--brand-700) 0%, var(--brand-600) 55%, var(--brand-500) 100%)",
                                      }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        addVisit(c, rowHH, rowUsdaYes);
                                      }}
                                      disabled={busy || !allowLogVisits || isAll}
                                      title="Add visit"
                                    >
                                      <Check className="h-4 w-4" />
                                      Add
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
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
              <div className="flex items-center justify-between gap-3">
                {/* Auto-close preference (persisted) */}
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 select-none">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300"
                    checked={!!autoClose}
                    onChange={(e) => setAutoClose(e.target.checked)}
                  />
                  Auto-close after save
                </label>

                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span>Default ZIP</span>
                  <span className="inline-flex items-center rounded-full border px-2 py-0.5">
                    {getLS(DEFAULT_ZIP_KEY, FALLBACK_ZIP)}
                  </span>
                  <span>County</span>
                  <span className="inline-flex items-center rounded-full border px-2 py-0.5">
                    {getLS(DEFAULT_COUNTY_KEY, FALLBACK_COUNTY)}
                  </span>
                </div>

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
      )}    </>
  );
}
