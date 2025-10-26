// src/components/AddVisitButton.jsx
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

/* =========================
   Helpers
========================= */
function isoWeekKey(d = new Date()) {
  // ISO week (Mon-based; Thursday trick)
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
const monthKeyFor = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const cx = (...xs) => xs.filter(Boolean).join(" ");

export default function AddVisitButton({
  org,
  location,
  selectedDate, // "YYYY-MM-DD"
  onAdded,
  disabled = false,
  className = "",
}) {
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
    setOpen(true);
    setHH(1);
    setUSDA(true);
    setSearch("");
  }, [selectedDate]);

  useEffect(() => {
    if (!open) return;
    loadCandidates();
  }, [open, loadCandidates]);

  // autofocus + ESC close
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 50);
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
      if (!client || !org?.id || !selectedDate) return;
      setBusy(true);
      try {
        // Compose a concrete timestamp on the chosen day, current time of day
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

        const latestHH = Math.max(1, Math.min(20, Number(hh || 1)));
        const isFirst = !!usda;
        const currentUser = auth.currentUser?.uid || null;
        const locId = location?.id || null;

        await runTransaction(db, async (tx) => {
          // 1) Read client to ensure it exists and guard cross-org
          const clientRef = doc(db, "clients", client.id);
          const clientSnap = await tx.get(clientRef);
          if (!clientSnap.exists()) throw new Error("Client document not found.");
          const cur = clientSnap.data() || {};
          if (cur.orgId && cur.orgId !== org.id) {
            throw new Error("Client belongs to a different organization.");
          }

          // 2) USDA first marker (id includes org for safety)
          if (isFirst) {
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
            visitAt: when,
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

          // 4) Client counters / last-visit (no silent reassignment of org/location)
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
    [org?.id, location?.id, selectedDate, monthKey, hh, usda, onAdded]
  );

  return (
    <>
      {/* Entry button */}
      <button
        disabled={disabled || !selectedDate}
        onClick={openSheet}
        title="Add a visit to this day"
        aria-label="Add visit"
        className={cx(
          "inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white shadow-sm",
          "focus:outline-none focus-visible:ring-4",
          "active:scale-[.98] transition",
          disabled || !selectedDate ? "opacity-60 pointer-events-none" : "",
          className
        )}
        style={{
          background:
            "linear-gradient(160deg, var(--brand-700) 0%, var(--brand-600) 55%, var(--brand-500) 100%)",
        }}
      >
        <PlusIcon className="h-4 w-4 shrink-0" />
        Add Visit
      </button>

      {/* Sheet */}
      {open && (
        <div className="fixed inset-0 z-50">
          {/* Backdrop */}
          <button
            className="absolute inset-0 bg-black/45"
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
              bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden
              bottom-0 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2
              rounded-t-3xl sm:rounded-3xl
              h-[92svh] sm:h-auto max-h-[100svh]
              pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]
              flex flex-col
            "
          >
            {/* Header — brand gradient bar */}
            <div className="sticky top-0 z-10">
              <div
                className="text-white border-b shadow-sm"
                style={{
                  background:
                    "linear-gradient(160deg, var(--brand-700) 0%, var(--brand-600) 55%, var(--brand-500) 100%)",
                }}
              >
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
                        Org: <b>{org?.name ?? "—"}</b>
                      </span>
                      <span>
                        Loc: <b>{location?.name ?? "—"}</b>
                      </span>
                    </div>

                    {/* Close */}
                    <button
                      onClick={() => setOpen(false)}
                      className="rounded-xl px-3 h-10 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 shrink-0"
                      aria-label="Close"
                      title="Close"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Context (mobile) */}
                  <div className="mt-2 sm:hidden text-[11px] text-white/90 flex flex-wrap gap-x-4 gap-y-1">
                    <span>
                      Org: <b>{org?.name ?? "—"}</b>
                    </span>
                    <span>
                      Loc: <b>{location?.name ?? "—"}</b>
                    </span>
                  </div>
                </div>
              </div>

              {/* Controls strip — airy spacing */}
              <div className="px-4 sm:px-6 py-3 bg-white/95 backdrop-blur border-b">
                <div className="grid gap-3 lg:grid-cols-[1fr,auto] items-center">
                  {/* Search */}
                  <div className="relative">
                    <input
                      ref={inputRef}
                      className="w-full rounded-2xl border px-4 pl-11 py-3 h-12 text-[15px] shadow-sm bg-white placeholder:text-gray-400 focus:outline-none focus:border-[color:var(--brand-500)] focus:ring-4 focus:ring-[color:var(--brand-200)]"
                      placeholder="Search name, address or zip…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      aria-label="Find client"
                    />
                    <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                  </div>

                  {/* Quick controls */}
                  <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
                    {/* HH preset chips */}
                    <div className="hidden md:flex items-center gap-1.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          className={cx(
                            "h-9 px-2 rounded-lg border text-sm transition",
                            Number(hh) === n
                              ? "bg-[color:var(--brand-700)] text-white border-[color:var(--brand-700)]"
                              : "bg-white hover:bg-gray-50 border-gray-300"
                          )}
                          onClick={() => setHH(n)}
                          aria-label={`Set household size to ${n}`}
                        >
                          HH {n}
                        </button>
                      ))}
                    </div>

                    {/* HH stepper */}
                    <div className="inline-flex items-center rounded-full border bg-white overflow-hidden shadow-sm">
                      <button
                        className="h-10 w-10 text-lg font-semibold hover:bg-gray-100 active:scale-[.98]"
                        onClick={() => setHH((n) => Math.max(1, Number(n) - 1))}
                        aria-label="Decrease household size"
                      >
                        –
                      </button>
                      <div className="px-3 text-sm font-semibold tabular-nums min-w-[2ch] text-center select-none">
                        {hh}
                      </div>
                      <button
                        className="h-10 w-10 text-lg font-semibold hover:bg-gray-100 active:scale-[.98]"
                        onClick={() => setHH((n) => Math.min(20, Number(n) + 1))}
                        aria-label="Increase household size"
                      >
                        +
                      </button>
                    </div>

                    {/* USDA toggle */}
                    <div className="inline-flex rounded-full border bg-white overflow-hidden">
                      <button
                        className={cx(
                          "px-3 h-9 text-sm font-medium",
                          usda ? "bg-[color:var(--brand-700)] text-white" : "hover:bg-gray-50"
                        )}
                        onClick={() => setUSDA(true)}
                        aria-pressed={usda}
                      >
                        USDA: Yes
                      </button>
                      <button
                        className={cx(
                          "px-3 h-9 text-sm font-medium border-l",
                          !usda ? "bg-[color:var(--brand-700)] text-white" : "hover:bg-gray-50"
                        )}
                        onClick={() => setUSDA(false)}
                        aria-pressed={!usda}
                      >
                        USDA: No
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
                    const initials = `${(c.firstName || "").slice(0, 1)}${(c.lastName || "").slice(0, 1)}`.toUpperCase();
                    const fullName = `${c.firstName || ""} ${c.lastName || ""}`.trim() || c.id;
                    const line2 = [c.address || "", c.zip || ""].filter(Boolean).join(" • ");

                    return (
                      <li key={c.id} className="p-3 sm:p-4 hover:bg-brand-50/70">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-10 w-10 rounded-2xl bg-[color:var(--brand-50)] text-[color:var(--brand-900)] ring-1 ring-[color:var(--brand-200)] flex items-center justify-center text-sm font-semibold shrink-0">
                              {initials || "?"}
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium truncate text-[15px] text-gray-900">
                                {fullName}
                              </div>
                              <div className="text-xs text-gray-600 truncate">{line2}</div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-xs text-gray-500 hidden sm:inline">
                              HH {hh} • {usda ? "USDA" : "Non-USDA"}
                            </span>
                            <button
                              className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold text-white shadow-sm focus:outline-none focus-visible:ring-4 active:scale-[.98] transition"
                              style={{
                                background:
                                  "linear-gradient(160deg, var(--brand-700) 0%, var(--brand-600) 55%, var(--brand-500) 100%)",
                              }}
                              onClick={() => addVisit(c)}
                              disabled={busy}
                              title="Add this client"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.currentTarget.click();
                              }}
                            >
                              <CheckIcon className="h-4 w-4" />
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
                  className="h-11 px-5 rounded-xl border hover:bg-gray-50 active:scale-[.98] transition"
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

/* =========================
   Icons
========================= */
function PlusIcon({ className = "h-4 w-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function SearchIcon({ className = "h-5 w-5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}
function CheckIcon({ className = "h-4 w-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
