// src/pages/Dashboard.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../lib/firebase";
import { collection, onSnapshot, query, orderBy, where } from "firebase/firestore";
import { useAuth } from "../auth/useAuth";
import NewClientForm from "../components/NewClientForm";
import EditForm from "../components/EditForm";
import LogVisitForm from "../components/LogVisitForm";

/* ===========================
   Helpers
=========================== */
const strip = (s = "") => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const tokensOf = (s = "") => strip(s).toLowerCase().split(/\s+/).filter(Boolean);

function relevanceScore(c, tks) {
  const first = strip(c.firstName || "").toLowerCase();
  const last = strip(c.lastName || "").toLowerCase();
  const full = `${first} ${last}`.trim();
  const digits = (c.phone || "").replace(/\D/g, "");

  let score = 0;
  for (const tk of tks) {
    const dtk = tk.replace(/\D/g, "");
    if (full.startsWith(tk)) score += 100;
    else if (first.startsWith(tk)) score += 80;
    else if (last.startsWith(tk)) score += 70;
    else if (full.includes(` ${tk}`)) score += 50;
    else if (full.includes(tk)) score += 30;
    else if (dtk && digits.includes(dtk)) score += 25;
  }
  // tiny recency nudge if Firestore TS exists
  const sec = c?.updatedAt?._seconds ?? 0;
  score += sec / 100000;
  return score;
}

const tcase = (s = "") =>
  s
    .toLowerCase()
    .replace(/[\p{L}]+('[\p{L}]+)?/gu, (w) => w[0].toUpperCase() + w.slice(1))
    .replace(/([- ][\p{L}])/gu, (m) => m[0] + m[1].toUpperCase());

const localDateKey = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const monthKeyOf = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const fmtLocal = (ts) => {
  try {
    return (ts?.toDate?.() ?? new Date(ts)).toLocaleString();
  } catch {
    return "";
  }
};

// UI atoms
const cardCls = "rounded-2xl border border-brand-100 bg-white shadow-soft";
const subCardCls = "rounded-xl border border-brand-100 bg-white";

/* ===========================
   Component
=========================== */
export default function Dashboard() {
  const { loading, org, location, isAdmin } = useAuth() || {};

  // Data
  const [clients, setClients] = useState([]);
  const [recentVisits, setRecentVisits] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedVisits, setSelectedVisits] = useState([]);

    // Derived scope helpers
  const orgId = org?.id ?? null;
  const locId = location?.id ?? null;
  const isAll = isAdmin && locId === "";   // "" sentinel = All locations (admins only)


  // UI
  const [term, setTerm] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [editor, setEditor] = useState({ open: false, client: null });
  const [visitSheet, setVisitSheet] = useState({ open: false, client: null });
  const [toast, setToast] = useState(null);
  const [err, setErr] = useState("");

  // KPI (only: visits today)
  const [todayCount, setTodayCount] = useState(0);

  // reset hard on scope changes
  const scopeKey = `${org?.id || "no-org"}__${location?.id || "all"}`;
  useEffect(() => {
    setClients([]);
    setSelected(null);
    setSelectedVisits([]);
    setRecentVisits([]);
    setTodayCount(0);
    setErr("");
  }, [org?.id, location?.id]);


/* ---- live clients (FULL LIST) ---- */
useEffect(() => {
  if (loading || !org?.id) return;

  // Volunteers MUST be location-scoped. If no location yet, don't attach a query.
  if (!isAdmin && !location?.id) {
    setClients([]);
    setSelected(null);
    setErr("Choose a location to view clients.");
    return;
  }

const filters = [where("orgId", "==", orgId)];
if (!isAll && locId) filters.push(where("locationId", "==", locId));


  const q1 = query(
    collection(db, "clients"),
    ...filters,
    orderBy("lastName"),
    orderBy("firstName")
  );

  const unsub = onSnapshot(
    q1,
    (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((c) => c.inactive !== true && !c.mergedIntoId);

      setClients(rows);
      setErr("");

      setSelected((prev) => (prev ? rows.find((r) => r.id === prev.id) || null : null));
    },
    (e) => {
      console.error("clients onSnapshot error:", e);
      setErr("Couldn’t load clients. Check org/location scope and rules.");
    }
  );

  return () => unsub();
}, [loading, org?.id, location?.id, isAdmin]);


  useEffect(() => {
    console.log("scope", { isAdmin, orgId: org?.id, locationId: location?.id });
  }, [isAdmin, org?.id, location?.id]);


/* ---- visit history for selected (client-specific) ---- */
useEffect(() => {
  if (!selected?.id || !org?.id) {
    setSelectedVisits([]);
    return;
  }

  // Volunteers must be location-scoped; admins can see all locations in the org.
  if (!isAdmin && !location?.id) {
    setSelectedVisits([]);
    return;
  }

  const filters = [where("clientId", "==", selected.id), where("orgId", "==", orgId)];
  if (!isAll && locId) filters.push(where("locationId", "==", locId));


  const qv = query(collection(db, "visits"), ...filters, orderBy("visitAt", "desc"));

  const unsub = onSnapshot(
    qv,
    (snap) => setSelectedVisits(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (e) => {
      console.error("visits (selected) onSnapshot error:", e);
      setSelectedVisits([]);
    }
  );
  return () => unsub();
}, [selected?.id, org?.id, location?.id, isAdmin]);

/* ---- recent visits (latest 10) ---- */
useEffect(() => {
  if (!org?.id) return;
  if (!isAdmin && !location?.id) { setRecentVisits([]); return; }

    const filters = [where("orgId", "==", orgId)];
    if (!isAll && locId) filters.push(where("locationId", "==", locId));



  const q2 = query(collection(db, "visits"), ...filters, orderBy("visitAt", "desc"));
  return onSnapshot(q2, (snap) => {
    const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    setRecentVisits(all.slice(0, 10));
  });
}, [org?.id, location?.id, isAdmin]);

/* ---- visits today count ---- */
  useEffect(() => {
    if (!org?.id) return;

    const today = localDateKey();
    const filters = [where("orgId", "==", orgId), where("dateKey", "==", today)];
    if (!isAll && locId) filters.push(where("locationId", "==", locId));


    const q3 = query(collection(db, "visits"), ...filters);
    return onSnapshot(q3, (snap) => setTodayCount(snap.size));
  }, [org?.id, location?.id]);

  /* ---- keyboard shortcut: focus search with "/" ---- */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        document.querySelector('input[type="search"]')?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---- search + grouping ---- */
  const searchTokens = useMemo(() => tokensOf(term), [term]);

  const filteredSorted = useMemo(() => {
    if (searchTokens.length === 0) return clients;
    return [...clients]
      .map((c) => ({ c, score: relevanceScore(c, searchTokens) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.c);
  }, [clients, searchTokens]);

  const grouped = useMemo(() => {
    if (searchTokens.length > 0) return [];
    const map = new Map();
    for (const c of clients) {
      const key = ((c.firstName || c.lastName || "?")[0] || "?").toUpperCase().slice(0, 1);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([letter, items]) => [
        letter,
        items.sort((a, b) => {
          const af = (a.firstName || "").localeCompare(b.firstName || "");
          if (af) return af;
          return (a.lastName || "").localeCompare(b.lastName || "");
        }),
      ]);
  }, [clients, searchTokens]);

  const letterChips = useMemo(() => grouped.map(([letter]) => letter), [grouped]);

  const clientsById = useMemo(() => {
    const m = new Map();
    for (const c of clients) m.set(c.id, c);
    return m;
  }, [clients]);

  /* ---- actions ---- */
  function logVisit(c) {
    setVisitSheet({ open: true, client: c });
  }

  // USDA status for selected (current month), derived from selectedVisits
  const currentMonthKey = useMemo(() => monthKeyOf(), []);
  const usdaThisMonth = useMemo(
    () =>
      selectedVisits.some((v) => {
        const mk =
          v.monthKey ||
          (() => {
            try {
              const d = v.visitAt?.toDate?.() ?? new Date(v.visitAt);
              return monthKeyOf(d);
            } catch {
              return "";
            }
          })();
        return mk === currentMonthKey && v.usdaFirstTimeThisMonth === true;
      }),
    [selectedVisits, currentMonthKey]
  );

  /* ===========================
     Render
  =========================== */
  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-4 md:p-6">
        <div className={`${cardCls} p-4`}>
          <SkeletonRows />
        </div>
      </div>
    );
  }

  if (!org?.id) {
    return (
      <div className="max-w-6xl mx-auto p-4 md:p-6">
        <div className={`${cardCls} p-6 text-sm text-gray-700`}>
          <div className="text-base font-semibold mb-1">Choose an organization</div>
          <p>Select an organization from the navbar to begin.</p>
        </div>
      </div>
    );
  }

  return (
    <div key={scopeKey} className="max-w-6xl mx-auto p-4 md:p-6">
      {/* toast */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50" aria-live="polite">
          <div className="flex items-center gap-3 rounded-lg bg-gray-900 text-white px-4 py-2 shadow-lg border border-brand-300">
            <span className="text-sm">{toast.msg}</span>
            <button className="text-gray-300 text-sm" onClick={() => setToast(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
        </div>
      )}

      {/* scope pill (above search) */}
      <div className="mb-2 text-xs text-gray-700">
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-brand-200 bg-white">
          <span className="font-semibold text-brand-900">Scope</span> • <span>{org?.name || "—"}</span>
          {isAll ? (
            <>
              <span className="opacity-60">/</span>
              <span>All locations</span>
            </>
          ) : location?.name ? (
            <>
              <span className="opacity-60">/</span>
              <span>{location.name}</span>
            </>
          ) : (
            <span className="opacity-70">(select a location)</span>
          )}

        </span>
      </div>

      {/* top bar */}
      <div className="relative flex flex-wrap md:flex-nowrap items-center gap-3 mb-1.5">
        {/* search */}
        <div className="relative w-full min-w-0 rounded-2xl border border-brand-200 bg-white shadow-sm">
          <input
            className="w-full bg-transparent rounded-2xl pl-10 pr-10 py-3 text-[17px] focus:outline-none"
            placeholder={`Search ${location?.name ? `${location.name} ` : ""}clients…`}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            type="search"
            enterKeyHint="search"
            autoCapitalize="none"
            inputMode="search"
            aria-label="Search clients by name or phone"
          />
          {/* lens */}
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m1.6-5.4a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>          
          {term && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setTerm("")}
              className="absolute top-1/2 -translate-y-1/2 right-2 grid place-items-center rounded-full 
                        w-7 h-7 text-[18px] font-semibold text-gray-500 
                        hover:text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
            >
              ×
            </button>
          )}

        </div>

        {/* actions */}
        <div className="flex items-center gap-3 md:gap-4 md:ml-auto shrink-0">
          {/* Today (smaller; left) */}
          <span
            role="status"
            aria-label={`Visits today ${todayCount}`}
            className="inline-flex items-center justify-center gap-2 h-11 px-3 rounded-2xl border border-brand-200 text-brand-900 bg-white shadow-sm leading-none shrink-0 min-w-[108px] md:min-w-0">
            <span className="text-sm font-semibold whitespace-nowrap">
              <span className="hidden md:inline">Visits </span>Today
            </span>
            <span className="h-4 w-px bg-brand-200 md:h-5" aria-hidden="true" />
            <span className="text-lg md:text-2xl font-bold tabular-nums tracking-tight">{todayCount}</span>
          </span>

          {/* Add New Client (longer; right) */}
          <button
            onClick={() => setShowNew(true)}
            className="btn btn-brand-grad px-6 min-w-[184px] md:min-w-[208px]"
            aria-label="Add new client"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 align-middle" aria-hidden="true">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
            <span className="md:hidden align-middle">Add New Client</span>
            <span className="hidden md:inline align-middle">Add New Client</span>
          </button>


        </div>

      </div>

      {err && (
        <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 text-red-800 px-3 py-2 text-sm">
          {err}
        </div>
      )}

      {/* main content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        {/* left: list */}
        <div className={`lg:col-span-2 ${cardCls} p-3`}>
          <div className="text-sm text-gray-600 mb-2 flex items-center justify-between">
            <span>
              {searchTokens.length > 0
              ? `Showing ${filteredSorted.length} best match${filteredSorted.length === 1 ? "" : "es"}`
              : `Showing ${clients.length} client${clients.length === 1 ? "" : "s"}`}

            </span>
          </div>

          {/* Letter chips (when not searching) */}
          {letterChips.length > 0 && searchTokens.length === 0 && (
            <div className="flex gap-2 pb-2 overflow-x-auto no-scrollbar">
              {letterChips.map((L) => (
                <button
                  key={L}
                  className="px-2 py-1 rounded-md text-xs bg-brand-50 text-brand-900 ring-1 ring-brand-100 hover:bg-brand-100 active:bg-brand-200"
                  onClick={() => setTerm((t) => (t === L ? "" : L))}
                  aria-label={`Jump to ${L}`}
                >
                  {L}
                </button>
              ))}
            </div>
          )}

          {/* List — full list, comfortable scrolling */}
          <div className="max-h-[70vh] md:max-h-[480px] overflow-auto pretty-scroll">
            {(searchTokens.length > 0
              ? [{ letter: null, items: filteredSorted }]
              : grouped.map(([letter, items]) => ({ letter, items })))
              .map(({ letter, items }) => (
                <div key={letter ?? "best"} className="mb-3">
                  {letter && (
                    <div className="sticky top-0 z-10 bg-white text-xs font-semibold text-brand-800 py-1 border-b border-brand-100">
                      {letter}
                    </div>
                  )}
                  <ul className="divide-y">
                    {items.map((c) => (
                      <li
                        key={c.id}
                        onClick={() => setSelected(c)}
                        className={`group flex items-center gap-3 py-2.5 px-2 rounded transition flex-nowrap ${
                          selected?.id === c.id ? "bg-brand-50 hover:bg-brand-100" : "hover:bg-gray-100"
                        }`}
                      >
                        {/* Left: name + details (takes remaining width and truncates) */}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">
                            {tcase(c.firstName)} {tcase(c.lastName)}
                          </div>
                          <div className="text-xs text-gray-600 truncate">
                            {[c.phone || null, c.address ? `• ${c.address}` : null].filter(Boolean).join(" ")}
                          </div>
                        </div>

                        {/* Right: fixed-width button that never wraps */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            logVisit(c);
                            setSelected(c);
                          }}
                          className={[
                            // size: smaller on mobile
                            "inline-flex items-center justify-center",
                            "h-9 px-3 shrink-0 whitespace-nowrap rounded-lg",
                            // responsive min-width so it never collapses, but stays compact
                            "min-w-[64px] sm:min-w-[92px]",
                            // brand look
                            "bg-gradient-to-b from-brand-600 to-brand-700 text-white",
                            "text-[13px] sm:text-[14px] font-medium",
                            "shadow-[0_6px_14px_-6px_rgba(199,58,49,0.5)] ring-1 ring-brand-700/40",
                            "hover:from-brand-500 hover:to-brand-600",
                            "active:translate-y-[1px] active:shadow-[0_4px_10px_-6px_rgba(199,58,49,0.6)]",
                            "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
                          ].join(" ")}
                          aria-label="Log visit"
                          title="Log visit"
                        >
                          <span className="sm:hidden">Log Visit</span>
                          <span className="hidden sm:inline">Log Visit</span>
                        </button>

                      </li>
                    ))}
                    {items.length === 0 && (
                      <li className="py-6 px-2 text-sm text-gray-600">
                        {searchTokens.length ? "No matches." : "No clients yet."}
                      </li>
                    )}
                  </ul>

                </div>
              ))}
          </div>
        </div>

        {/* right: quick details */}
        <aside className={`${cardCls} overflow-hidden`}>
          <div className="sticky top-0 z-10 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 flex items-center justify-between px-4 py-2.5 border-b border-brand-100">
            <div className="text-sm font-semibold">Client Details</div>
            {selected && (
              <div className="hidden sm:flex flex-wrap items-center gap-1.5 md:gap-2">
                {/* Log Visit — matches client list button */}
                <button
                  onClick={() => logVisit(selected)}
                  className={[
                    "inline-flex items-center justify-center",
                    "h-9 px-3 shrink-0 whitespace-nowrap rounded-lg",
                    "min-w-[64px] sm:min-w-[92px]",
                    "bg-gradient-to-b from-brand-600 to-brand-700 text-white",
                    "text-[13px] sm:text-[14px] font-medium",
                    "shadow-[0_6px_14px_-6px_rgba(199,58,49,0.5)] ring-1 ring-brand-700/40",
                    "hover:from-brand-500 hover:to-brand-600",
                    "active:translate-y-[1px] active:shadow-[0_4px_10px_-6px_rgba(199,58,49,0.6)]",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
                  ].join(" ")}
                  aria-label="Log visit"
                  title="Log visit"
                >
                  Log Visit
                </button>

                {/* Edit — outline mate */}
                {isAdmin && (
                  <button
                    onClick={() => setEditor({ open: true, client: selected })}
                    className={[
                      "inline-flex items-center justify-center",
                      "h-9 px-3 shrink-0 whitespace-nowrap rounded-lg",
                      "min-w-[64px]",
                      "bg-white text-brand-900",
                      "text-[13px] sm:text-[14px] font-medium",
                      "border border-brand-300 shadow-sm",
                      "hover:bg-brand-50 hover:border-brand-400",
                      "active:translate-y-[1px]",
                      "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
                    ].join(" ")}
                  >
                    Edit
                  </button>
                )}
              </div>
            )}
          </div>


          {selected ? (
            <div className="p-4 space-y-4">
              <div>
                <div className="text-base font-semibold leading-tight mb-3 border-b border-gray-100 pb-2">
                  {tcase(selected.firstName)} {tcase(selected.lastName)}
                </div>
                <dl className="grid grid-cols-[120px,1fr] md:grid-cols-[150px,1fr] gap-y-2 text-[14px] leading-6">
                  <dt className="text-gray-500 text-left">Address</dt>
                  <dd className="text-gray-900 break-words">{selected.address || "—"}</dd>
                  <dt className="text-gray-500 text-left">DOB</dt>
                  <dd className="text-gray-900">{selected.dob || "—"}</dd>
                  <dt className="text-gray-500 text-left">Phone</dt>
                  <dd className="text-gray-900">{selected.phone || "—"}</dd>
                  <dt className="text-gray-500 text-left">ZIP</dt>
                  <dd className="text-gray-900">{selected.zip || "—"}</dd>
                  <dt className="text-gray-500 text-left">Household</dt>
                  <dd className="text-gray-900">
                    {Number.isFinite(Number(selected.householdSize)) ? Number(selected.householdSize) : "—"}
                  </dd>
                  <dt className="text-gray-500 text-left">USDA this month</dt>
                  <dd className="text-gray-900">{selectedVisits.length ? (usdaThisMonth ? "Yes" : "No") : "—"}</dd>
                </dl>
              </div>

              <div className="pt-3 border-t">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold">Visit history</div>
                  <div className="text-[11px] text-gray-500">{selectedVisits.length} total</div>
                </div>
                {/* cap to ~5 rows before scrolling on desktop */}
                <ul className="divide-y max-h-52 md:max-h-56 overflow-y-auto overflow-x-hidden px-2 pr-1 pretty-scroll">
                  {selectedVisits.length === 0 && (
                    <li className="py-3 text-sm text-gray-500">No visits yet.</li>
                  )}

                  {selectedVisits.map((v) => (
                    <li key={v.id} className="py-2 text-[13px] grid grid-cols-5 items-center gap-x-2">
                      <div className="col-span-3 text-gray-900 truncate">{fmtLocal(v.visitAt)}</div>
                      <div className="text-gray-700 text-right pr-1">
                        HH{" "}
                        <span className="tabular-nums">
                          {Number.isFinite(Number(v.householdSize)) ? Number(v.householdSize) : "—"}
                        </span>
                      </div>
                      <div className="justify-self-start pl-1">
                        <span
                          className={[
                            "inline-flex flex-col items-center justify-center",
                            "rounded-xl px-2 py-0.5 text-[11px] leading-tight font-medium",
                            "border",
                            v.usdaFirstTimeThisMonth
                              ? "bg-green-50 text-green-700 border-green-200"
                              : "bg-red-50 text-red-700 border-red-200",
                          ].join(" ")}
                        >
                          <span className="uppercase tracking-wide text-[10px] opacity-70">USDA</span>
                          <span className="font-semibold mt-0.5">
                            {v.usdaFirstTimeThisMonth ? "Yes" : "No"}
                          </span>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="p-6">
              <div className="rounded-xl border border-brand-100 bg-brand-50 text-brand-900 px-3 py-2 text-sm">
                Select a person in the list to view quick details and history.
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* recent activity table */}
      <div className={`mt-5 ${cardCls} p-3`}>
        <div className="text-sm font-semibold mb-2">Recent activity (latest 10)</div>
        <div className={`${subCardCls} overflow-auto`}>
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr className="text-left text-gray-700">
                <th className="px-3 py-2 w-1/2 font-semibold">Client</th>
                <th className="px-3 py-2 font-semibold">Time</th>
                <th className="px-3 py-2 font-semibold">HH</th>
                <th className="px-3 py-2 font-semibold">USDA (mo)</th>
              </tr>
            </thead>
            <tbody>
              {recentVisits.map((v) => {
                const date = v.visitAt?.toDate ? v.visitAt.toDate() : new Date(v.visitAt);
                const person = clientsById.get(v.clientId);
                const fallback = `${tcase(v.clientFirstName || "")} ${tcase(v.clientLastName || "")}`.trim();
                const label =
                  person
                    ? `${tcase(person.firstName)} ${tcase(person.lastName)}`.trim()
                    : fallback || v.clientId || "Deleted client";

                return (
                  <tr
                    key={v.id}
                    className="border-t odd:bg-gray-50 hover:bg-gray-100 cursor-pointer"
                    onClick={() => person && setSelected(person)}
                  >
                    <td className="px-3 py-2">{label}</td>
                    <td className="px-3 py-2">{date.toLocaleString()}</td>
                    <td className="px-3 py-2">
                      {Number.isFinite(Number(v.householdSize)) ? Number(v.householdSize) : ""}
                    </td>
                    <td className="px-3 py-2">
                      {v.usdaFirstTimeThisMonth === true ? "Yes" : v.usdaFirstTimeThisMonth === false ? "No" : ""}
                    </td>
                  </tr>
                );
              })}
              {recentVisits.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-gray-600" colSpan={4}>
                    No activity yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* mobile quick actions bar */}
      {selected && (
        <div className="md:hidden fixed bottom-9 inset-x-2 z-40">
          <div className={`${cardCls} p-2 flex items-center justify-between gap-2`}>
            <div className="min-w-0 text-sm font-medium truncate">
              {tcase(selected.firstName)} {tcase(selected.lastName)}
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => logVisit(selected)}
                className="h-9 px-3 rounded-lg bg-brand-700 text-white font-medium shadow-sm hover:bg-brand-800 active:bg-brand-900 transition whitespace-nowrap"
              >
                Log Visit
              </button>
              {isAdmin && (
                <button
                  onClick={() => setEditor({ open: true, client: selected })}
                  className="h-9 px-3 rounded-lg border border-brand-300 text-brand-800 bg-white font-medium hover:bg-brand-50 active:bg-brand-100 transition whitespace-nowrap"
                >
                  Edit
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* modals */}
      <NewClientForm
        open={showNew}
        onClose={() => setShowNew(false)}
        onSaved={(c) => {
          setClients((prev) => {
            // ensure we keep the “hide inactive” rule even if a legacy form sent inactive
            const next = { id: c.id, ...c };
            if (next.inactive === true || next.mergedIntoId) return prev;
            const i = prev.findIndex((p) => p.id === c.id);
            if (i >= 0) {
              const copy = [...prev];
              copy[i] = { ...prev[i], ...next };
              return copy;
            }
            return [next, ...prev];
          });
          setSelected({ id: c.id, ...c });
        }}
      />

      <EditForm
        open={editor.open}
        client={editor.client}
        onClose={() => setEditor({ open: false, client: null })}
        onSaved={(updated) => {
          if (updated?.deleted || updated?.inactive === true || updated?.mergedIntoId) {
            setClients((prev) => prev.filter((p) => p.id !== updated.id));
            setSelected((prev) => (prev?.id === updated.id ? null : prev));
            setEditor({ open: false, client: null });
            setToast({ msg: "Client removed from list. Visit history kept." });
            setTimeout(() => setToast(null), 3500);
            return;
          }
          setClients((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
          setSelected((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
          setEditor({ open: false, client: null });
          setToast({ msg: `Saved changes for ${updated.firstName} ${updated.lastName}` });
          setTimeout(() => setToast(null), 3000);
        }}
      />

      <LogVisitForm
        open={visitSheet.open}
        client={visitSheet.client}
        onClose={() => setVisitSheet({ open: false, client: null })}
        onSaved={() => {
          setToast({ msg: `Visit logged for ${visitSheet.client.firstName} ${visitSheet.client.lastName}` });
          setVisitSheet({ open: false, client: null });
          // refresh selection from current list in case counters changed
          setSelected((prev) => (prev ? clients.find((x) => x.id === prev.id) ?? prev : null));
          setTimeout(() => setToast(null), 4000);
        }}
      />
    </div>
  );
}

/* ===========================
   Presentational bits
=========================== */
function SkeletonRows({ rows = 7 }) {
  return (
    <div className="animate-pulse space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 rounded-xl bg-gray-100" />
      ))}
    </div>
  );
}
