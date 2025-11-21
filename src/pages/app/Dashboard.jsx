import { useEffect, useMemo, useState } from "react";
import { db } from "../../lib/firebase";
import { collection, onSnapshot, query, orderBy, where } from "firebase/firestore";
import { useAuth } from "../../auth/useAuth";
import NewClientForm from "../../components/NewClientForm";
import EditForm from "../../components/EditForm";
import LogVisitForm from "../../components/LogVisitForm";
import { MapPin } from "lucide-react";

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
  const sec = c?.updatedAt?._seconds ?? 0;
  score += sec / 100000;
  return score;
}

const tcase = (s = "") =>
  s
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());

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

const missingFieldsFor = (c = {}) => {
  const miss = [];
  if (!((c.phone || "").toString().trim() || (c.dob || "").toString().trim())) {
    miss.push("phone or DOB");
  }
  if (!((c.address || "").toString().trim())) miss.push("address");
  if (!((c.zip || "").toString().trim())) miss.push("ZIP");
  return miss;
};
const hasMissingInfo = (c = {}) => missingFieldsFor(c).length > 0;

// UI atoms
const cardCls =
  "rounded-2xl border border-brand-100 bg-white/95 shadow-soft shadow-[0_18px_40px_rgba(148,27,21,0.06)]";
const subCardCls =
  "rounded-xl border border-brand-100 bg-white/90 shadow-[0_10px_25px_rgba(148,27,21,0.04)]";
const sectionHdrCls =
  "sticky top-0 z-10 px-4 py-2.5 rounded-t-2xl bg-brand-50/80 supports-[backdrop-filter]:bg-brand-50/60 backdrop-blur text-brand-900 border-b border-brand-200 shadow-[inset_0_-1px_0_rgba(0,0,0,0.04)]";

// Tighter shell on mobile so content stretches wider
const shellCls =
  "mx-auto w-full max-w-6xl px-1.5 sm:px-3 md:px-6 pt-3 md:pt-4 pb-4 md:pb-6";

/* ===========================
   Component
=========================== */
export default function Dashboard() {
  const {
    loading,
    org,
    location,
    isAdmin,
    hasCapability,
    canPickAllLocations = false,
    canCreateClients,
    canEditClients,
    canLogVisits,
  } = useAuth() || {};

  const [clients, setClients] = useState([]);
  const [recentVisits, setRecentVisits] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedVisits, setSelectedVisits] = useState([]);

  const orgId = org?.id ?? null;
  const locId = location?.id ?? null;
  const isAll = isAdmin && locId === "";

  const [term, setTerm] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [editor, setEditor] = useState({ open: false, client: null });
  const [visitSheet, setVisitSheet] = useState({ open: false, client: null });
  const [toast, setToast] = useState(null);
  const [err, setErr] = useState("");

  const [todayCount, setTodayCount] = useState(0);

  const scopeKey = `${org?.id || "no-org"}__${location?.id || "all"}`;
  useEffect(() => {
    setClients([]);
    setSelected(null);
    setSelectedVisits([]);
    setRecentVisits([]);
    setTodayCount(0);
    setErr("");
  }, [org?.id, location?.id]);

  /* ---- live clients ---- */
  useEffect(() => {
    if (loading || !org?.id) return;

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

  /* ---- visit history for selected ---- */
  useEffect(() => {
    if (!selected?.id || !org?.id) {
      setSelectedVisits([]);
      return;
    }

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

  /* ---- recent visits ---- */
  useEffect(() => {
    if (!org?.id) return;
    if (!location?.id) {
      setRecentVisits([]);
      return;
    }

    const q2 = query(
      collection(db, "visits"),
      where("orgId", "==", org?.id),
      where("locationId", "==", location.id),
      orderBy("visitAt", "desc")
    );

    const unsub = onSnapshot(
      q2,
      (snap) => {
        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setRecentVisits(all.slice(0, 10));
      },
      (e) => {
        console.error("recent visits onSnapshot error:", e);
        setRecentVisits([]);
      }
    );

    return () => unsub();
  }, [org?.id, location?.id]);

  /* ---- visits today count ---- */
  useEffect(() => {
    if (!org?.id) return;

    const today = localDateKey();
    const filters = [where("orgId", "==", orgId), where("dateKey", "==", today)];
    if (!isAll && locId) filters.push(where("locationId", "==", locId));

    const q3 = query(collection(db, "visits"), ...filters);
    return onSnapshot(q3, (snap) => setTodayCount(snap.size));
  }, [org?.id, location?.id]);

  /* ---- "/" focuses search ---- */
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

  function logVisit(c) {
    if (!(canLogVisits ?? hasCapability?.("logVisits"))) {
      setToast({ msg: "You don’t have permission to log visits." });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    setVisitSheet({ open: true, client: c });
  }

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
      <div className={shellCls}>
        <div className={`${cardCls} p-4`}>
          <SkeletonRows />
        </div>
      </div>
    );
  }

  if (!org?.id) {
    return (
      <div className={shellCls}>
        <div className={`${cardCls} p-6 text-sm text-gray-700`}>
          <div className="text-base font-semibold mb-1">Choose an organization</div>
          <p>Select an organization from the navbar to begin.</p>
        </div>
      </div>
    );
  }

  const allowNewClient = (canCreateClients ?? hasCapability?.("createClients")) === true;
  const allowEditClient = (canEditClients ?? hasCapability?.("editClients")) === true;

  return (
    <>
      <div key={scopeKey} className={shellCls}>
        {/* toast */}
        {toast && (
          <div
            className="fixed bottom-[calc(env(safe-area-inset-bottom)+16px)] left-1/2 -translate-x-1/2 z-50"
            aria-live="polite"
          >
            <div className="flex items-center gap-3 rounded-lg bg-gray-900 text-white px-4 py-2 shadow-lg border border-brand-300">
              <span className="text-sm">{toast.msg}</span>
              <button
                className="text-gray-300 text-sm"
                onClick={() => setToast(null)}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* ───────────────── Scope pill ───────────────── */}
        <div className="mb-2.5 md:mb-3 text-xs text-brand-900">
          <div
            className="flex w-full items-center gap-3 rounded-2xl bg-white/95 ring-1 ring-brand-100/80 shadow-sm px-3.5 py-2 md:px-4"
            aria-label="Current scope"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-50 text-[color:var(--brand-700)] ring-1 ring-brand-200 shrink-0">
              <MapPin className="h-4 w-4" aria-hidden="true" />
            </div>

            <div className="flex flex-col gap-0.5 leading-tight min-w-0">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                Scope
              </span>

              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] font-semibold text-gray-800">
                <span className="truncate max-w-[7.5rem] sm:max-w-[11rem]">
                  {org?.name || "—"}
                </span>

                {isAll ? (
                  <>
                    <span className="text-gray-300">/</span>
                    <span className="text-gray-700 whitespace-nowrap">All locations</span>
                  </>
                ) : location?.name ? (
                  <>
                    <span className="text-gray-300">/</span>
                    <span className="text-gray-700 whitespace-nowrap">{location.name}</span>
                  </>
                ) : canPickAllLocations ? (
                  <span className="text-gray-500">(all locations)</span>
                ) : (
                  <span className="text-gray-500">(select location)</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ───────────────── Visits today + CTA (mobile) ───────────────── */}
        <div className="block md:hidden mb-3">
          <section
            className="rounded-2xl bg-white/98 ring-1 ring-brand-100/80 shadow-sm px-3 py-2.5"
            aria-labelledby="kpi-today"
          >
            <div className="flex items-center gap-3">
              <div className="min-w-0 mr-auto">
                <p
                  id="kpi-today"
                  className="text-[11px] font-medium text-gray-600 leading-tight"
                >
                  Visits Today
                </p>
                <p
                  className="text-[26px] leading-none font-extrabold tracking-tight tabular-nums text-brand-800"
                  aria-live="polite"
                >
                  {todayCount}
                </p>
              </div>

              {allowNewClient && (
                <button
                  onClick={() => setShowNew(true)}
                  className="inline-flex items-center justify-center
                    h-11 px-5 rounded-full font-semibold text-white text-[14px]
                    bg-gradient-to-r from-[color:var(--brand-700)] to-[color:var(--brand-600)]
                    hover:from-[color:var(--brand-800)] hover:to-[color:var(--brand-700)]
                    active:from-[color:var(--brand-900)] active:to-[color:var(--brand-800)]
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200
                    shadow-[0_10px_20px_rgba(199,58,49,0.35)]
                    w-[70%] ml-auto transition-transform duration-150 active:scale-[0.97]"
                  aria-label="Add new client"
                >
                  <span className="mr-2 grid place-items-center h-6 w-6 rounded-full bg-white/20 shrink-0">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="h-5 w-5"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 4a1 1 0 011 1v4h4a1 1 0 110 2h-4v4a1 1 0 11-2 0v-4H6a1 1 0 110-2h4V5a1 1 0 011-1z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </span>
                  <span className="truncate">Add New Client</span>
                </button>
              )}
            </div>
          </section>
        </div>

        {/* ───────────────── Top bar (search + desktop CTA) ───────────────── */}
        <div className="relative flex flex-wrap md:flex-nowrap items-center gap-2.5 md:gap-4 mb-2.5 md:mb-3">
          {/* search */}
          <div className="relative w-full min-w-0 flex-1 rounded-2xl bg-white/98 ring-1 ring-brand-100/80 shadow-sm">
            <input
              className="w-full bg-transparent rounded-2xl pl-10 pr-10 py-2.5 md:py-3 text-[15px] md:text-[16px] placeholder:text-gray-400 focus:outline-none"
              placeholder={`Search ${
                location?.name ? `${location.name} ` : ""
              }clients…`}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              type="search"
              enterKeyHint="search"
              autoCapitalize="none"
              inputMode="search"
              aria-label="Search clients by name or phone"
            />

            <div
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              aria-hidden="true"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-4.35-4.35m1.6-5.4a7 7 0 11-14 0 7 7 0 0114 0z"
                />
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

          {/* desktop KPI + CTA */}
          <div className="hidden md:flex items-center gap-2.5 lg:gap-3 shrink-0">
            <div
              role="status"
              aria-label={`Visits today ${todayCount}`}
              className="inline-flex items-center gap-2 h-10 px-3.5 rounded-full bg-brand-50/90 ring-1 ring-brand-100 shadow-sm text-brand-900 leading-none"
            >
              <span className="text-[11px] font-medium text-gray-600">Visits today</span>
              <span className="h-5 w-px bg-brand-100" aria-hidden="true" />
              <span className="text-lg font-extrabold tabular-nums tracking-tight text-brand-800">
                {todayCount}
              </span>
            </div>

            {allowNewClient && (
              <button
                onClick={() => setShowNew(true)}
                className="inline-flex items-center gap-2 h-11 px-6 rounded-full text-[14px] font-semibold text-white 
           bg-gradient-to-r from-[color:var(--brand-700)] to-[color:var(--brand-600)]
           hover:from-[color:var(--brand-800)] hover:to-[color:var(--brand-700)]
           active:from-[color:var(--brand-900)] active:to-[color:var(--brand-800)]
           shadow-[0_12px_24px_rgba(199,58,49,0.40)]
           border border-brand-800/10 transition-all duration-150 active:scale-[0.97]"
                aria-label="Add new client"
              >
                <span className="grid place-items-center h-7 w-7 rounded-full bg-white/20">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-5 w-5"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 4a1 1 0 011 1v4h4a1 1 0 110 2h-4v4a1 1 0 11-2 0v-4H6a1 1 0 110-2h4V5a1 1 0 011-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                </span>
                <span>Add New Client</span>
              </button>
            )}
          </div>
        </div>

        {/* main content grid */}
        <div
          className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 mt-3"
          style={{ alignItems: "stretch", minHeight: 0 }}
        >
          {/* left: list */}
          <div
            className={`lg:col-span-2 ${cardCls} p-0 flex flex-col h-full lg:max-h-[calc(100vh-260px)] overflow-hidden`}
            style={{ minHeight: 0 }}
          >

            <div
              className={`${sectionHdrCls} text-[15px] font-bold rounded-t-3xl shadow bg-white/90 border-b border-brand-100/70`}
            >
              Client List
            </div>
            <div
              className="p-2.5 sm:p-3 flex-1 flex flex-col h-full bg-brand-50/40"
              style={{ minHeight: 0 }}
            >
              <div className="text-sm text-brand-900 mb-2.5 flex items-center justify-between font-semibold">
                <span>
                  {searchTokens.length > 0
                    ? `Showing ${filteredSorted.length} best match${
                        filteredSorted.length === 1 ? "" : "es"
                      }`
                    : `Showing ${clients.length} client${
                        clients.length === 1 ? "" : "s"
                      }`}
                </span>
              </div>

              {letterChips.length > 0 && searchTokens.length === 0 && (
                <div className="flex gap-2 pb-2 pt-1.5 pl-1.5 pr-1.5 overflow-x-auto desktop-scrollbar bg-white border border-brand-100 rounded-xl">
                  {letterChips.map((L) => {
                    const isActive = term === L;
                    return (
                      <button
                        key={L}
                        aria-pressed={isActive}
                        className={[
                          "px-2.5 py-1 rounded-full text-xs mt-0.5 ml-0.5 font-semibold transition-colors duration-150",
                          "ring-1 shadow-sm",
                          isActive
                            ? "bg-[color:var(--brand-700)] text-white ring-brand-700 shadow-[0_6px_14px_rgba(199,58,49,0.45)]"
                            : "bg-white/95 text-brand-900 ring-brand-100 hover:bg-brand-50 active:bg-brand-100",
                        ].join(" ")}
                        onClick={() => setTerm((t) => (t === L ? "" : L))}
                        aria-label={`Jump to ${L}`}
                      >
                        {L}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Scrollable list, capped so it doesn't run past the details panel */}
              <div className="flex-1 min-h-0 max-h-[75vh] md:max-h-[520px] overflow-auto desktop-scrollbar px-1 sm:px-2">

                {(searchTokens.length > 0
                  ? [{ letter: null, items: filteredSorted }]
                  : grouped.map(([letter, items]) => ({ letter, items }))).map(
                  ({ letter, items }) => (
                    <div key={letter ?? "best"} className="mb-3">
                      {letter && (
                        <div className="sticky top-0 z-10 bg-brand-50/95 text-xs font-semibold text-brand-800 py-1 border-b border-brand-100">
                          {letter}
                        </div>
                      )}
                      <ul className="space-y-1 w-full">
                        {items.map((c) => {
                          const isSelected = selected?.id === c.id;
                          return (
                            <li
                              key={c.id}
                              onClick={() => setSelected(c)}
                              className={[
                                "group w-full flex items-center flex-nowrap gap-3 py-2.5 px-3 rounded-2xl transition",
                                "border",
                                isSelected
                                  ? "bg-white shadow-md border-brand-200 ring-1 ring-brand-200"
                                  : "bg-white/90 hover:bg-white border-brand-100 shadow-[0_4px_10px_rgba(148,27,21,0.06)]",
                              ].join(" ")}
                            >
                              <div className="flex items-center w-full gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="font-semibold truncate flex items-center gap-2 text-brand-900">
                                    <span
                                      className="truncate"
                                      style={{
                                        userSelect: "text",
                                        pointerEvents: "none",
                                      }}
                                    >
                                      {tcase(c.firstName)} {tcase(c.lastName)}
                                    </span>
                                  </div>
                                  <div className="text-xs text-gray-600 truncate">
                                    <span
                                      style={{
                                        userSelect: "text",
                                        pointerEvents: "none",
                                      }}
                                    >
                                      {[
                                        c.phone || null,
                                        c.address ? `• ${c.address}` : null,
                                      ]
                                        .filter(Boolean)
                                        .join(" ")}
                                    </span>
                                  </div>
                                </div>

                                {/* missing-info icon intentionally removed from list items */}

                                {canLogVisits ?? hasCapability?.("logVisits") ? (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      logVisit(c);
                                      setSelected(c);
                                    }}
                                    className={[
                                      "inline-flex items-center justify-center",
                                      "h-9 px-4 rounded-lg bg-brand-700 text-white font-bold shadow hover:bg-brand-800 active:bg-brand-900 transition whitespace-nowrap",
                                      "shrink-0",
                                    ].join(" ")}
                                    aria-label="Log visit"
                                    title="Log visit"
                                  >
                                    Log Visit
                                  </button>
                                ) : null}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>

          {/* right: quick details */}
          <aside
            className={`${cardCls} overflow-hidden h-full`}
            style={{ height: "100%" }}
          >
            <div className={`${sectionHdrCls} flex items-center justify-between`}>
              <div className="text-sm font-semibold">Client Details</div>
              {selected && (
                <div className="hidden sm:flex flex-wrap items-center gap-1.5 md:gap-2">
                  {(canLogVisits ?? hasCapability?.("logVisits")) && (
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
                        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200",
                      ].join(" ")}
                      aria-label="Log visit"
                      title="Log visit"
                    >
                      Log Visit
                    </button>
                  )}

                  {allowEditClient && (
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
                        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200",
                      ].join(" ")}
                    >
                      Edit
                    </button>
                  )}
                </div>
              )}
            </div>

            {selected ? (
              <div className="p-4 sm:p-5 space-y-4">
                {(() => {
                  const missing = [];
                  if (!selected.address) missing.push("Address");
                  if (!selected.dob) missing.push("DOB");
                  if (!selected.phone) missing.push("Phone");
                  if (!selected.zip) missing.push("ZIP");
                  if (!selected.county) missing.push("County");
                  if (missing.length === 0) return null;
                  return (
                    <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm shadow-sm">
                      <span className="inline-flex items-center justify-center pt-1">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-5 w-5 text-amber-500"
                          viewBox="0 0 20 20"
                          aria-hidden="true"
                        >
                          <circle
                            cx="10"
                            cy="10"
                            r="8"
                            fill="#FEF3C7"
                            stroke="#F59E0B"
                            strokeWidth="1.5"
                          />
                          <text
                            x="10"
                            y="14"
                            textAnchor="middle"
                            fontSize="11"
                            fontWeight="bold"
                            fill="#92400E"
                            fontFamily="Arial, sans-serif"
                          >
                            !
                          </text>
                        </svg>
                      </span>
                      <span>
                        <span className="font-semibold">Missing:</span>
                        <ul className="list-disc ml-5 mt-1">
                          {missing.map((field) => (
                            <li key={field}>{field}</li>
                          ))}
                        </ul>
                        <span className="block mt-1 font-normal">
                          Please edit to complete.
                        </span>
                      </span>
                    </div>
                  );
                })()}
                <div>
                  <div className="text-base font-semibold leading-tight mb-3 border-b border-gray-100 pb-2">
                    {tcase(selected.firstName)} {tcase(selected.lastName)}
                  </div>
                  <dl className="grid grid-cols-[120px,1fr] md:grid-cols-[150px,1fr] gap-y-2 text-[14px] leading-6">
                    <dt className="text-gray-500 text-left">Address</dt>
                    <dd className="text-gray-900 break-words">
                      {selected.address || "—"}
                    </dd>
                    <dt className="text-gray-500 text-left">DOB</dt>
                    <dd className="text-gray-900">{selected.dob || "—"}</dd>
                    <dt className="text-gray-500 text-left">Phone</dt>
                    <dd className="text-gray-900">{selected.phone || "—"}</dd>
                    <dt className="text-gray-500 text-left">ZIP</dt>
                    <dd className="text-gray-900">{selected.zip || "—"}</dd>
                    <dt className="text-gray-500 text-left">County</dt>
                    <dd className="text-gray-900 break-words">
                      {selected.county || "—"}
                    </dd>
                    <dt className="text-gray-500 text-left">Household</dt>
                    <dd className="text-gray-900">
                      {Number.isFinite(Number(selected.householdSize))
                        ? Number(selected.householdSize)
                        : "—"}
                    </dd>
                    <dt className="text-gray-500 text-left">USDA this month</dt>
                    <dd className="text-gray-900">
                      {selectedVisits.length ? (usdaThisMonth ? "Yes" : "No") : "—"}
                    </dd>
                  </dl>
                </div>

                <div className="pt-3 border-t">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-semibold">Visit history</div>
                    <div className="text-[11px] text-gray-500">
                      {selectedVisits.length} total
                    </div>
                  </div>
                  <ul className="divide-y max-h-36 md:max-h-40 overflow-y-auto overflow-x-hidden px-2 pr-1 desktop-scrollbar">
                    {selectedVisits.length === 0 && (
                      <li className="py-3 text-sm text-gray-500">No visits yet.</li>
                    )}

                    {selectedVisits.map((v) => (
                      <li
                        key={v.id}
                        className="py-2 text-[13px] grid grid-cols-5 items-center gap-x-2"
                      >
                        <div className="col-span-3 text-gray-900 truncate">
                          {fmtLocal(v.visitAt)}
                        </div>
                        <div className="text-gray-700 text-right pr-1">
                          HH{" "}
                          <span className="tabular-nums">
                            {Number.isFinite(Number(v.householdSize))
                              ? Number(v.householdSize)
                              : "—"}
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
                            <span className="uppercase tracking-wide text-[10px] opacity-70">
                              USDA
                            </span>
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
              <div className="p-5">
                <div className="rounded-xl border border-brand-100 bg-brand-50 text-brand-900 px-3 py-2 text-sm">
                  Select a person in the list to view quick details and history.
                </div>
              </div>
            )}
          </aside>
        </div>

        {/* recent activity table */}
        <div className={`mt-4 ${cardCls} p-0`}>
          <div className={`${sectionHdrCls} text-[13px] font-semibold rounded-t-2xl`}>
            Recent Activity (latest 10)
          </div>
          <div className="p-3">
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
                    const date = v.visitAt?.toDate
                      ? v.visitAt.toDate()
                      : new Date(v.visitAt);
                    const person = clientsById.get(v.clientId);
                    const fallback = `${tcase(v.clientFirstName || "")} ${tcase(
                      v.clientLastName || ""
                    )}`.trim();
                    const label = person
                      ? `${tcase(person.firstName)} ${tcase(person.lastName)}`.trim()
                      : fallback || v.clientId || "Deleted client";

                    return (
                      <tr
                        key={v.id}
                        className="border-t odd:bg-brand-50/40 hover:bg-brand-50/80 cursor-pointer"
                        onClick={() => person && setSelected(person)}
                      >
                        <td className="px-3 py-2">{label}</td>
                        <td className="px-3 py-2">{date.toLocaleString()}</td>
                        <td className="px-3 py-2">
                          {Number.isFinite(Number(v.householdSize))
                            ? Number(v.householdSize)
                            : ""}
                        </td>
                        <td className="px-3 py-2">
                          {v.usdaFirstTimeThisMonth === true
                            ? "Yes"
                            : v.usdaFirstTimeThisMonth === false
                            ? "No"
                            : ""}
                        </td>
                      </tr>
                    );
                  })}
                  {recentVisits.length === 0 && (
                    <tr>
                      <td className="px-3 py-6 text-gray-600" colSpan={4}>
                        {isAll
                          ? "Choose a location to see recent activity for that location."
                          : !location?.id
                          ? "Select a location to see recent activity."
                          : "No activity yet."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* mobile quick actions bar */}
        {selected && (
          <div className="md:hidden fixed inset-x-2 z-40 bottom-[calc(env(safe-area-inset-bottom)+8px)] backdrop-blur-md">
            <div
              className="rounded-3xl border-2 border-brand-700 bg-white/80 shadow-2xl px-3 py-2 flex items-center justify-between gap-3 ring-1 ring-brand-100/60"
              style={{ borderWidth: "2px", borderColor: "#b91c1c" }}
            >
              <div className="min-w-0 text-base font-semibold text-brand-900 truncate">
                {tcase(selected.firstName)} {tcase(selected.lastName)}
              </div>
              <div className="flex gap-2 items-center">
                {/* show missing-info indicator on mobile quick bar if selected has missing info */}
                {hasMissingInfo(selected) && (
                  <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-amber-50 border border-amber-200 text-amber-600">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="12" height="12" aria-hidden="true">
                      <circle cx="10" cy="10" r="8" fill="none" stroke="#F59E0B" strokeWidth="1" />
                      <text x="10" y="13" textAnchor="middle" fontSize="9" fontWeight="700" fill="#92400E" fontFamily="Arial, sans-serif">!</text>
                    </svg>
                  </span>
                )}

                {(canLogVisits ?? hasCapability?.("logVisits")) && (
                  <button
                    onClick={() => logVisit(selected)}
                    className="h-8 px-3 rounded-lg bg-brand-700 text-white font-bold shadow-lg hover:bg-brand-800 active:bg-brand-900 transition whitespace-nowrap text-base"
                  >
                    Log Visit
                  </button>
                )}
                {allowEditClient && (
                  <button
                    onClick={() => setEditor({ open: true, client: selected })}
                    className="h-8 px-4 rounded-lg border-2 border-brand-300 text-brand-800 bg-white font-bold shadow-lg hover:bg-brand-50 active:bg-brand-100 transition whitespace-nowrap text-base"
                  >
                    Edit
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* modals */}
      <NewClientForm
        open={showNew}
        onClose={() => setShowNew(false)}
        onSaved={(c) => {
          setClients((prev) => {
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
          setClients((prev) =>
            prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p))
          );
          setSelected((prev) =>
            prev && prev.id === updated.id ? { ...prev, ...updated } : prev
          );
          setEditor({ open: false, client: null });
          setToast({
            msg: `Saved changes for ${updated.firstName} ${updated.lastName}`,
          });
          setTimeout(() => setToast(null), 3000);
        }}
      />

      <LogVisitForm
        open={visitSheet.open}
        client={visitSheet.client}
        onClose={() => setVisitSheet({ open: false, client: null })}
        onSaved={() => {
          setToast({
            msg: `Visit logged for ${visitSheet.client.firstName} ${visitSheet.client.lastName}`,
          });
          setVisitSheet({ open: false, client: null });
          setSelected((prev) =>
            prev ? clients.find((x) => x.id === prev.id) ?? prev : null
          );
          setTimeout(() => setToast(null), 4000);
        }}
      />
    </>
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
