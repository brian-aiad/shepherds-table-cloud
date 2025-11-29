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
  if (!((c.phone || "").toString().trim())) miss.push("Phone");
  if (!((c.dob || "").toString().trim())) miss.push("DOB");
  if (!((c.address || "").toString().trim())) miss.push("Address");
  if (!((c.zip || "").toString().trim())) miss.push("ZIP");
  if (!((c.county || "").toString().trim())) miss.push("County");
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

// Standard shell used across app pages (matches Reports/Inventory/Donations)
const shellCls =
  "px-4 sm:px-6 lg:px-8 pt-2 sm:pt-3 max-w-7xl mx-auto overflow-visible";

// Primary CTA used across dashboard to match EFAP/Reports buttons
const primaryBtnCls =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 px-3.5 py-2.5 text-white font-semibold shadow " +
  "hover:from-brand-800 hover:via-brand-700 hover:to-brand-600 active:from-brand-900 active:via-brand-800 active:to-brand-700 " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 transition";

// Smaller primary variant for compact CTAs (keeps the same gradient & focus ring)
const primarySmallCls =
  "inline-flex items-center justify-center h-9 px-4 rounded-lg text-[13px] font-semibold text-white shadow shrink-0 " +
  "bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 hover:from-brand-800 hover:via-brand-700 hover:to-brand-600 " +
  "active:from-brand-900 active:via-brand-800 active:to-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 transition";

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

  // Scope chip (icon variant for header) — render under title on small, inline on md+
  const scopeChip = (
    <span className="inline-flex items-center gap-1 rounded-full bg-white text-brand-900 ring-1 ring-black/5 shadow-sm px-2 py-0.5 text-[12px]">
      <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-brand-50 text-[color:var(--brand-700)] ring-1 ring-brand-100 mr-1">
        <MapPin className="h-3 w-3" aria-hidden="true" />
      </span>
      <span className="font-semibold text-xs truncate">{location?.name ? `${org?.name || "—"} / ${location.name}` : org?.name || "—"}</span>
    </span>
  );

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

        {/* scope will be rendered in the themed header below (keeps parity with Reports) */}

        {/* ===== Themed header (all sizes; stacks on small screens) ===== */}
        <div className="block rounded-3xl overflow-visible shadow-sm ring-1 ring-black/5 relative mb-4">
          <div className="rounded-t-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 p-3 sm:p-4 relative pb-6 shadow-[inset_0_-1px_0_rgba(255,255,255,0.25)]">
            <div className="flex flex-wrap items-center justify-center md:justify-between gap-2">
              <h1 className="text-white text-xl sm:text-2xl font-semibold tracking-tight text-center md:text-left">
                Dashboard
              </h1>
              <div className="hidden md:flex items-center gap-2">{scopeChip}</div>
            </div>

            <div className="mt-2 md:mt-3 flex flex-wrap items-center justify-center md:justify-start gap-2">
              <div className="md:hidden">{scopeChip}</div>
            </div>
          </div>

          {/* Controls surface: mobile = Visits+CTA card above search, desktop = search left, KPI+CTA right */}
          <div className="rounded-b-3xl bg-white/95 backdrop-blur px-3 sm:px-5 py-3 border border-brand-100 ring-1 ring-brand-50 shadow-soft">
            <div className="max-w-7xl mx-auto flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              {/* MOBILE: Visits pill + Add button (inside header, above search) */}
              <div className="block md:hidden order-1">
                <section
                  className="rounded-2xl bg-white/98 ring-1 ring-brand-100/80 shadow-sm px-3 py-2.5"
                  aria-labelledby="kpi-today"
                >
                  <div className="flex items-center gap-3">
                    <div className="min-w-0">
                      <p
                        id="kpi-today"
                        className="text-[11px] font-medium text-gray-600 leading-tight mb-0.5"
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
                      <div className="ml-auto w-[72%] sm:w-[70%]">
                        <div className="relative inline-block w-full group">
                          <button
                            onClick={() => setShowNew(true)}
                            className={
                              primaryBtnCls +
                              " w-full h-11 px-5 rounded-full shadow-[0_10px_24px_rgba(0,0,0,0.08),0_4px_8px_rgba(148,27,21,0.035)] border border-brand-800/10 transition-transform duration-150 active:scale-[0.97] whitespace-nowrap flex items-center justify-center gap-2"
                            }
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
                            <span className="truncate">Add New Client</span>
                          </button>
                          <div
                            aria-hidden
                            className="absolute left-0 right-0 bottom-0 h-1 rounded-b-2xl bg-gradient-to-r from-brand-500 via-brand-400 to-brand-300 opacity-0 group-hover:opacity-[0.06] transition-opacity pointer-events-none"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              </div>

              {/* SEARCH – full width; sits under KPI card on mobile, left side on desktop */}
              <div className="order-2 lg:order-1 flex-1 w-full">
                <div className="relative w-full min-w-0">
                  <input
                    type="search"
                    value={term}
                    onChange={(e) => setTerm(e.target.value)}
                    placeholder={`Search ${location?.name ? `${location.name} ` : ""}clients…`}
                    className="w-full pl-9 pr-12 py-2.5 md:py-3 text-[15px] md:text-[17px] placeholder:text-gray-400 rounded-2xl bg-white border border-brand-300 ring-1 ring-brand-300/10 shadow-[0_8px_24px_-12px_rgba(148,27,21,0.06)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300/35 focus:border-brand-300"
                    aria-label="Search clients by name or phone"
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
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
                  </span>
                  {term && (
                    <button
                      type="button"
                      onClick={() => setTerm("")}
                      aria-label="Clear search"
                      className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full grid place-items-center text-gray-500 hover:bg-gray-100"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>

              {/* DESKTOP: Visits pill + Add button on the right */}
              <div className="hidden md:flex order-3 lg:order-2 items-center gap-3 justify-end flex-none lg:ml-4">
                <div
                  role="status"
                  aria-label={`Visits today ${todayCount}`}
                  className="inline-flex items-center gap-3 h-10 px-5 rounded-full bg-white/95 border border-brand-100 ring-1 ring-brand-100/80 shadow-sm text-gray-800 text-[14px] leading-none"
                >
                  <span className="text-[13px] font-medium text-brand-800">Visits Today</span>
                  <span className="h-5 w-px bg-brand-100" aria-hidden="true" />
                  <span className="text-xl font-extrabold tabular-nums tracking-tight text-brand-900">
                    {todayCount}
                  </span>
                </div>

                {allowNewClient && (
                  <div className="relative inline-block group">
                    <button
                      onClick={() => setShowNew(true)}
                      className={
                        primaryBtnCls +
                        " h-12 px-8 min-w-[220px] rounded-full shadow-[0_10px_24px_rgba(0,0,0,0.08),0_4px_8px_rgba(148,27,21,0.035)] border border-brand-800/10 transition-all duration-150 active:scale-[0.97] whitespace-nowrap"
                      }
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
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>




        


        {/* main content grid */}
        <div
          className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 mt-3"
          style={{ alignItems: "stretch", minHeight: 0 }}
        >
          {/* left: list */}
          <div
            className={`lg:col-span-2 ${cardCls} p-0 flex flex-col h-full lg:max-h-[calc(100vh-260px)] overflow-hidden group relative ` +
              `hover:shadow-[0_12px_28px_-12px_rgba(0,0,0,0.18)] hover:ring-brand-200 hover:border-brand-300 transition will-change-transform hover:scale-[1.01]`}
            style={{ minHeight: 0 }}
          >

            <div
              className={`px-4 py-2.5 rounded-t-3xl text-white text-[15px] font-bold bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 shadow-[inset_0_-1px_0_rgba(255,255,255,0.25)]`}
            >
              Client List
            </div>
            <div
              className="p-2.5 sm:p-3 flex-1 flex flex-col h-full bg-white/95 ring-1 ring-brand-50"
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
                            ? "bg-[color:var(--brand-700)] text-white ring-brand-700 shadow-[0_6px_14px_rgba(148,27,21,0.12)]"
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
                                                      primarySmallCls,
                                                      // Slightly larger on md+ so the button reads and fits better on desktop
                                                      "md:h-10 md:px-5 md:text-[16px] md:rounded-lg",
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
          <div aria-hidden className="absolute left-0 right-0 bottom-0 h-1 rounded-b-2xl bg-gradient-to-r from-brand-500 via-brand-400 to-brand-300 opacity-0 group-hover:opacity-[0.06] transition-opacity pointer-events-none" />

          {/* right: quick details */}
          <aside
            className={`${cardCls} overflow-hidden h-full group relative ` +
              `hover:shadow-[0_12px_28px_-12px_rgba(0,0,0,0.18)] hover:ring-brand-200 hover:border-brand-300 transition will-change-transform hover:scale-[1.01]`}
            style={{ height: "100%" }}
          >
            <div className={`px-4 py-2.5 rounded-t-2xl flex items-center justify-between text-white bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 shadow-[inset_0_-1px_0_rgba(255,255,255,0.25)]`}>
              <div className="text-sm font-semibold">Client Details</div>
              {selected && (
                <div className="hidden sm:flex items-center gap-2 md:gap-2 flex-nowrap">
                  {(canLogVisits ?? hasCapability?.("logVisits")) && (
                    <button
                      onClick={() => logVisit(selected)}
                      className={
                        "inline-flex items-center justify-center h-9 leading-none px-4 min-w-[80px] sm:min-w-[92px] rounded-lg " +
                        "text-[13px] sm:text-[14px] font-medium bg-white text-brand-900 border border-brand-300 shadow-sm " +
                        "hover:bg-brand-50 hover:border-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200 active:translate-y-[1px]"
                      }
                      aria-label="Log visit"
                      title="Log visit"
                    >
                      Log Visit
                    </button>
                  )}

                  {allowEditClient && (
                    <button
                      onClick={() => setEditor({ open: true, client: selected })}
                      className={
                        "inline-flex items-center justify-center h-9 leading-none px-4 min-w-[80px] rounded-lg " +
                        "text-[13px] sm:text-[14px] font-medium bg-white text-brand-900 border border-brand-300 shadow-sm " +
                        "hover:bg-brand-50 hover:border-brand-400 active:translate-y-[1px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
                      }
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
  if (!((selected.address || "").toString().trim())) missing.push("Address");
  if (!((selected.dob || "").toString().trim())) missing.push("DOB");
  if (!((selected.phone || "").toString().trim())) missing.push("Phone");
  if (!((selected.zip || "").toString().trim())) missing.push("ZIP");
  if (!((selected.county || "").toString().trim())) missing.push("County");
  if (missing.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/95 px-3.5 py-3 text-[13px] text-amber-900 shadow-sm">
      <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex-shrink-0">
    <span
      className="flex items-center justify-center h-5 w-5 rounded-full bg-amber-500 text-white shadow-[0_8px_18px_rgba(217,119,6,0.45)] ring-2 ring-amber-100/80 border border-amber-500"
      title="Client record has missing information"
    >
      <span className="text-[12px] leading-none font-extrabold">!</span>
      <span className="sr-only">Client record has missing information</span>
    </span>
  </div>

        <div className="flex-1">
          <p className="font-semibold text-[13px] flex items-center gap-2">
            Missing information
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium border border-amber-200">
              {missing.length} field{missing.length > 1 ? "s" : ""}
            </span>
          </p>
          <ul className="mt-1.5 list-disc ml-4 space-y-0.5">
            {missing.map((field) => (
              <li key={field}>{field}</li>
            ))}
          </ul>
          <p className="mt-1.5 text-[12px] text-amber-900/90">
            Please edit to complete this client record.
          </p>
        </div>
      </div>
    </div>
  );
})()}

                <div>
                  <div className="text-base font-semibold leading-tight mb-3 border-b border-gray-100 pb-2">
                    {tcase(selected.firstName)} {tcase(selected.lastName)}
                  </div>
                  <dl className="grid grid-cols-[110px,1fr] md:grid-cols-[130px,1fr] gap-y-2 text-[14px] leading-6">
                    <dt className="text-gray-500 text-left">Address</dt>
                    <dd className="text-gray-900 break-words whitespace-normal">
                      {selected.address || "—"}
                    </dd>
                    <dt className="text-gray-500 text-left">DOB</dt>
                    <dd className="text-gray-900 whitespace-normal">{selected.dob || "—"}</dd>
                    <dt className="text-gray-500 text-left">Phone</dt>
                    <dd className="text-gray-900 whitespace-normal">{selected.phone || "—"}</dd>
                    <dt className="text-gray-500 text-left">ZIP</dt>
                    <dd className="text-gray-900 whitespace-normal">{selected.zip || "—"}</dd>
                    <dt className="text-gray-500 text-left">County</dt>
                    <dd className="text-gray-900 break-words whitespace-normal">
                      {selected.county || "—"}
                    </dd>
                    <dt className="text-gray-500 text-left">Household</dt>
                    <dd className="text-gray-900 whitespace-normal">
                      {Number.isFinite(Number(selected.householdSize))
                        ? Number(selected.householdSize)
                        : "—"}
                    </dd>
                    <dt className="text-gray-500 text-left">USDA this month</dt>
                    <dd className="text-gray-900 whitespace-normal">
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
            <div aria-hidden className="absolute left-0 right-0 bottom-0 h-1 rounded-b-2xl bg-gradient-to-r from-brand-500 via-brand-400 to-brand-300 opacity-0 group-hover:opacity-[0.06] transition-opacity pointer-events-none" />
          </aside>
        </div>

        {/* recent activity table */}
          <div className={`mt-4 ${cardCls} p-0 group relative hover:shadow-[0_12px_28px_-12px_rgba(0,0,0,0.18)] hover:ring-brand-200 hover:border-brand-300 transition will-change-transform hover:scale-[1.01]`}>
          <div className={`px-4 py-2.5 rounded-t-2xl text-white text-[13px] font-semibold bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 shadow-[inset_0_-1px_0_rgba(255,255,255,0.25)]`}>
            Recent Activity (latest 10)
          </div>
          <div className="p-3">
            <div className={`${subCardCls} overflow-auto`}>
              <table className="min-w-full text-sm">
                <thead className="bg-[color:#eef1f2] sticky top-0 z-10 shadow-sm">
                  <tr className="text-left text-gray-800">
                    <th className="px-3 py-2 w-1/2 font-semibold border-b border-gray-300">Client</th>
                    <th className="px-3 py-2 font-semibold border-b border-gray-300">Time</th>
                    <th className="px-3 py-2 font-semibold border-b border-gray-300">HH</th>
                    <th className="px-3 py-2 font-semibold border-b border-gray-300">USDA (mo)</th>
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
          <div aria-hidden className="absolute left-0 right-0 bottom-0 h-1 rounded-b-2xl bg-gradient-to-r from-brand-500 via-brand-400 to-brand-300 opacity-0 group-hover:opacity-[0.06] transition-opacity pointer-events-none" />
        </div>
{/* mobile quick actions bar */}
{selected && (
  <div className="md:hidden fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-40">
    <div className="rounded-3xl bg-white/90 backdrop-blur-xl shadow-xl ring-1 ring-brand-200 border border-brand-300 px-4 py-2.5 flex items-center justify-between gap-3">
      {/* Name + Missing Info */}
      <div className="flex items-center min-w-0 gap-2">
        <div className="truncate font-semibold text-brand-900 text-[15px]">
          {tcase(selected.firstName)} {tcase(selected.lastName)}
        </div>

        {hasMissingInfo(selected) && (
          <span
            className="flex items-center justify-center h-5 w-5 rounded-full bg-amber-500 text-white shadow-[0_8px_18px_rgba(217,119,6,0.45)] ring-2 ring-amber-100/80 border border-amber-500 flex-shrink-0"
            title="Client record has missing information"
          >
            <span className="text-[12px] leading-none font-extrabold">!</span>
            <span className="sr-only">Client record has missing information</span>
          </span>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {(canLogVisits ?? hasCapability?.("logVisits")) && (
          <button
            onClick={() => logVisit(selected)}
            className="h-9 px-4 rounded-xl text-[13px] font-semibold text-white bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 shadow-md hover:brightness-105 active:scale-[0.98] transition whitespace-nowrap"
          >
            Log Visit
          </button>
        )}

        {allowEditClient && (
          <button
            onClick={() => setEditor({ open: true, client: selected })}
            className="h-9 px-4 rounded-xl border border-brand-300 text-brand-900 bg-white shadow-sm font-semibold text-[13px] hover:bg-brand-50 active:scale-[0.98] transition whitespace-nowrap"
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
