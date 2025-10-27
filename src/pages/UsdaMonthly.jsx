// src/pages/UsdaMonthly.jsx
// Shepherds Table Cloud — USDA / EFAP Monthly (theme-forward, centered mobile, organized desktop)
// - Mobile: centered stack (Shade → Month → Actions)
// - Desktop: Shade on left, Month centered, Actions on right
// - Strong brand outlines on calendar & stat cards
// - Snapshot → getDocs fallback; unduplicated logic; CSV + EFAP PDF
// - Keyboard: ← / → / T

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  getDocs,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../auth/useAuth";
import { downloadEfapMonthlyPdf } from "../utils/buildEfapMonthlyPdf";

/* =========================
   Pure helpers
========================= */
const parseLocalYMD = (ymd) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const fmtYMD = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

function startAndEndOfMonth(year, monthIndex0) {
  const start = new Date(year, monthIndex0, 1);
  const end = new Date(year, monthIndex0 + 1, 0);
  return { start, end, startKey: fmtYMD(start), endKey: fmtYMD(end) };
}

function buildCalendarDays(year, monthIndex0) {
  const first = new Date(year, monthIndex0, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay()); // back to Sunday
  const last = new Date(year, monthIndex0 + 1, 0);
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - last.getDay())); // forward to Saturday
  const out = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) out.push(fmtYMD(d));
  return out;
}

// Aggregate for UI + exports
function aggregateMonth(visits) {
  const byDay = new Map();
  let monthVisits = 0;
  let monthPersons = 0;
  const firstsByClient = new Map(); // clientId -> earliest USDA visit in month

  for (const v of visits || []) {
    const dk = v.dateKey;
    const persons = Number(v.householdSize || 0);

    const prev = byDay.get(dk) || { visits: 0, persons: 0 };
    prev.visits += 1;
    prev.persons += persons;
    byDay.set(dk, prev);

    monthVisits += 1;
    monthPersons += persons;

    if (v.clientId && v.usdaFirstTimeThisMonth) {
      const cur = firstsByClient.get(v.clientId);
      if (!cur || dk < cur.dateKey) firstsByClient.set(v.clientId, { dateKey: dk, persons });
    }
  }

  const undHH = firstsByClient.size;
  const undPP = Array.from(firstsByClient.values()).reduce((s, x) => s + x.persons, 0);

  return {
    byDay,
    monthTotals: { visits: monthVisits, persons: monthPersons },
    unduplicated: { households: undHH, persons: undPP },
  };
}

function toCsv(rows) {
  const cols = Object.keys(rows[0] || {});
  const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  return cols.map(esc).join(",") + "\n" + rows.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\n") + "\n";
}

const cx = (...xs) => xs.filter(Boolean).join(" ");

/* =========================
   Tiny components
========================= */
function StatCard({ title, children }) {
  // brand red outline
  return (
    <div className="rounded-2xl border border-brand-200 ring-1 ring-brand-100 bg-white shadow-sm p-4 sm:p-5">
      <div className="text-xs sm:text-sm text-gray-600 mb-1">{title}</div>
      {children}
    </div>
  );
}

// ----------------------- MonthNav (white pill, Reports style, no native month input) -----------------------
function MonthNav({ month, setMonth }) {
  const [y, m] = month.split("-").map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const [open, setOpen] = useState(false);
  const [yearView, setYearView] = useState(y);

  const monthKeyFor = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  const jump = useCallback((delta) => {
    const d = new Date(y, m - 1, 1);
    d.setMonth(d.getMonth() + delta);
    setMonth(monthKeyFor(d));
  }, [y, m, setMonth]);

  const goToday = useCallback(() => {
    const t = new Date();
    setMonth(monthKeyFor(t));
    setYearView(t.getFullYear());
  }, [setMonth]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowLeft") jump(-1);
      if (e.key === "ArrowRight") jump(1);
      if (e.key.toLowerCase() === "t") goToday();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [jump, goToday]);

  // close popover on outside click
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      const pop = document.querySelector('[role="dialog"][aria-label="Select month and year"]');
      const trigger = e.target.closest?.('[aria-haspopup="dialog"][data-month-trigger]');
      if (pop && !pop.contains(e.target) && !trigger) setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);

  const commit = useCallback((yy, monthIndex0) => {
    const d = new Date(yy, monthIndex0, 1);
    setMonth(monthKeyFor(d));
    setYearView(yy);
    setOpen(false);
  }, [setMonth]);

  const MonthCell = ({ mIndex0 }) => {
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const isCurrent = y === yearView && m === mIndex0 + 1;
  return (
    <button
      onClick={() => commit(yearView, mIndex0)}
      className={
        "px-2.5 py-1.5 rounded-lg text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 " +
        (isCurrent
          ? "bg-brand-700 text-white"
          : "bg-white text-brand-700 border border-brand-200 hover:bg-brand-50/60")
      }
    >
      {names[mIndex0]}
    </button>
  );
};


  const baseBtn = "inline-flex items-center justify-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-black/50";
  const size = "h-10 w-10 md:h-11 md:w-11";

  return (
    <div className="relative z-[1000]">

      {/* unified capsule */}
      <div className="inline-flex items-center gap-0 rounded-2xl bg-white border border-gray-300 ring-1 ring-gray-200 shadow-[0_6px_16px_-6px_rgba(0,0,0,0.15)] px-1.5 py-1">
        {/* Prev */}
        <button
          onClick={() => jump(-1)}
          className={`${baseBtn} ${size} rounded-xl hover:bg-gray-50 active:bg-gray-100 text-black`}
          aria-label="Previous month"
          title="Previous month"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" fill="none" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" strokeWidth="2" />
          </svg>
        </button>

        {/* divider */}
        <span className="mx-1 h-7 md:h-8 w-px bg-black/10" aria-hidden="true" />

        {/* Month button */}
        <div className="relative">
          <button
            data-month-trigger
            onClick={() => { setYearView(y); setOpen(v => !v); }}
            className="inline-flex items-center justify-center gap-2 rounded-full px-4 md:px-5 h-10 md:h-11 text-black font-semibold tracking-tight hover:bg-gray-50 active:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/50"
            aria-haspopup="dialog"
            aria-expanded={open}
            title="Jump to a specific month/year"
          >
            <span className="text-[15px] md:text-[16px]">{label}</span>
            <svg className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" stroke="currentColor" fill="none">
              <path d="M6 9l6 6 6-6" strokeWidth="2" />
            </svg>
          </button>

          {/* Popover (no native month input to avoid OS overlay) */}
          {open && (
            <div
              className="absolute left-1/2 top-full z-[1100] mt-2 w-[320px] -translate-x-1/2 rounded-2xl border border-black/20 bg-white shadow-xl p-3"
              role="dialog"
              aria-label="Select month and year"
            >
              {/* Year header */}
              <div className="flex items-center justify-between mb-2">
                <button
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-black/20 bg-white hover:bg-gray-50 text-black"
                  onClick={() => setYearView(yy => yy - 1)}
                  aria-label="Previous year"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" fill="none">
                    <path d="M15 6l-6 6 6 6" strokeWidth="2" />
                  </svg>
                </button>

                <div className="font-semibold text-black">{yearView}</div>

                <button
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-black/20 bg-white hover:bg-gray-50 text-black"
                  onClick={() => setYearView(yy => yy + 1)}
                  aria-label="Next year"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" fill="none">
                    <path d="M9 6l6 6-6 6" strokeWidth="2" />
                  </svg>
                </button>
              </div>

              {/* Month grid */}
              <div className="grid grid-cols-4 gap-2">
                {Array.from({ length: 12 }, (_, i) => (
                  <MonthCell key={i} mIndex0={i} />
                ))}
              </div>

              {/* Footer: Today button only (prevents native date picker overlay) */}
              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="flex-1 rounded-lg border border-black/10 px-2 py-2 text-sm text-black bg-gray-50/60">
                  {label}
                </div>
                <button
                  className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm hover:bg-gray-50 text-black"
                  onClick={goToday}
                  title="Jump to current month"
                >
                  Today
                </button>
              </div>
            </div>
          )}
        </div>

        {/* divider */}
        <span className="mx-1 h-7 md:h-8 w-px bg-black/10" aria-hidden="true" />

        {/* Next */}
        <button
          onClick={() => jump(1)}
          className={`${baseBtn} ${size} rounded-xl hover:bg-gray-50 active:bg-gray-100 text-black`}
          aria-label="Next month"
          title="Next month"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" fill="none" aria-hidden="true">
            <path d="M9 6l6 6-6 6" strokeWidth="2" />
          </svg>
        </button>

        {/* divider (md+) */}
        <span className="mx-1 h-7 md:h-8 w-px bg-black/10 hidden md:block" aria-hidden="true" />

        {/* Today (md+) */}
        <button
          onClick={goToday}
          className="hidden md:inline-flex items-center justify-center rounded-full px-3 h-10 md:h-11 text-black hover:bg-gray-50 active:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/50"
          title="Jump to current month (T)"
        >
          Today
        </button>
      </div>
    </div>
  );
}






/* =========================
   Page
========================= */
export default function UsdaMonthly() {
  const nav = useNavigate();
  const { loading: authLoading, org, location, isAdmin, email } = useAuth() || {};

  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

  const [month, setMonth] = useState(defaultMonth);
  const [loading, setLoading] = useState(false);
  const [visits, setVisits] = useState([]);
  const [error, setError] = useState("");
  const [shadeBy, setShadeBy] = useState("visits");
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  const syncAgo = useMemo(() => {
    if (!lastSyncedAt) return "";
    const secs = Math.max(0, Math.floor((Date.now() - lastSyncedAt.getTime()) / 1000));
    return secs < 60 ? `${secs}s ago` : `${Math.floor(secs / 60)}m ago`;
  }, [lastSyncedAt]);

  const { year, monthIndex0 } = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    return { year: y, monthIndex0: m - 1 };
  }, [month]);

  const calendarDays = useMemo(() => buildCalendarDays(year, monthIndex0), [year, monthIndex0]);
  const agg = useMemo(() => aggregateMonth(visits), [visits]);

  const maxVisits = useMemo(
    () => Math.max(1, ...calendarDays.map((dk) => agg.byDay.get(dk)?.visits ?? 0)),
    [calendarDays, agg.byDay]
  );
  const maxPersons = useMemo(
    () => Math.max(1, ...calendarDays.map((dk) => agg.byDay.get(dk)?.persons ?? 0)),
    [calendarDays, agg.byDay]
  );

  // Live monthly fetch (with safe fallback)
  useEffect(() => {
    if (authLoading) return;
    if (!org?.id) {
      setVisits([]);
      setLoading(false);
      return;
    }

    const { startKey, endKey } = startAndEndOfMonth(year, monthIndex0);
    const filters = [
      where("orgId", "==", org.id),
      where("dateKey", ">=", startKey),
      where("dateKey", "<=", endKey),
    ];
    if (location?.id) filters.unshift(where("locationId", "==", location.id));

    const qv = query(collection(db, "visits"), ...filters, orderBy("dateKey", "asc"));

    setError("");
    setLoading(true);
    let off;

    (async () => {
      try {
        off = onSnapshot(
          qv,
          (snap) => {
            setVisits(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
            setLoading(false);
            setLastSyncedAt(new Date());
          },
          async () => {
            try {
              const snap2 = await getDocs(qv);
              setVisits(snap2.docs.map((d) => ({ id: d.id, ...d.data() })));
            } catch {
              setError("Couldn’t load data for that month.");
            } finally {
              setLoading(false);
              setLastSyncedAt(new Date());
            }
          }
        );
      } catch (e) {
        console.error(e);
        setError("Couldn’t load data for that month.");
        setLoading(false);
      }
    })();

    return () => (off ? off() : undefined);
  }, [authLoading, org?.id, location?.id, year, monthIndex0]);

  /* ---------- Exports ---------- */
  function exportCsv() {
    const rows = calendarDays.map((dk) => {
      const a = agg.byDay.get(dk) || { visits: 0, persons: 0 };
      return { date: dk, visits: a.visits, persons: a.persons };
    });
    rows.push(
      { date: "Monthly Totals", visits: agg.monthTotals.visits, persons: agg.monthTotals.persons },
      { date: "Unduplicated Households", visits: agg.unduplicated.households, persons: "" },
      { date: "Unduplicated Persons", visits: "", persons: agg.unduplicated.persons }
    );
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `USDA_${month}_${org?.slug || org?.id}${location?.id ? `_${location.id}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportMonthlyPdf() {
    const monthLabel = new Date(year, monthIndex0, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
    const byDayForPdf = new Map(
      Array.from(agg.byDay.entries()).map(([k, v]) => [k, { households: v.visits, persons: v.persons }])
    );

    await downloadEfapMonthlyPdf(
      {
        year,
        monthIndex0,
        byDayMap: byDayForPdf,
        monthTotals: { households: agg.monthTotals.visits, persons: agg.monthTotals.persons },
        unduplicated: agg.unduplicated,
        header: {
          agency: org?.name || "Your Organization",
          acct: "—",
          phone: "—",
          contact: email || "—",
          address: location?.address || "—",
        },
      },
      `EFAP_Monthly_${monthLabel}_${org?.slug || org?.id}${location?.id ? `_${location.id}` : ""}.pdf`
    );
  }

  /* ---------- Visual helpers ---------- */
  function cellShade(a) {
    const v = shadeBy === "visits" ? (a?.visits ?? 0) / (maxVisits || 1) : (a?.persons ?? 0) / (maxPersons || 1);
    const alpha = 0.06 + v * 0.22;
    return `rgba(153,27,27,${alpha})`; // brand.900-ish with alpha
  }
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Mobile scroller config
  const scrollerRef = useRef(null);
  const MOBILE_COL_PX = 110;
  const MOBILE_GAP_PX = 10;
  const MOBILE_ROW_MIN = 100;

  // Early UI states
  if (authLoading) return <div className="p-4 sm:p-6">Loading…</div>;
  if (!isAdmin) {
    return (
      <div className="p-4 sm:p-6">
        <div className="rounded-xl border bg-amber-50 text-amber-900 px-3 py-2 text-sm">
          You don’t have permission to view USDA Monthly.
        </div>
      </div>
    );
  }
  if (!org?.id) {
    return (
      <div className="p-4 sm:p-6">
        <div className="rounded-xl border bg-white px-3 py-2 text-sm">Select an organization to begin.</div>
      </div>
    );
  }

  /* ---------- Scope + Sync (USDA style) ---------- */
  const scopeChip = (
    <span
      className="
        inline-flex items-center gap-1.5
        rounded-full bg-white text-brand-900
        ring-1 ring-black/5 shadow-sm
        px-3 py-1 text-[12px]
      "
    >
      <span className="text-gray-600">Scope</span>
      <span className="text-gray-400">•</span>
      <span className="font-semibold">{org?.name || "—"}</span>
      {location?.name ? (
        <>
          <span className="text-gray-300">/</span>
          <span className="text-gray-700">{location.name}</span>
        </>
      ) : (
        <span className="text-gray-600">(all locations)</span>
      )}
    </span>
  );

  const syncChip = (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200 px-3 py-1 text-[12px]">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Synced {syncAgo || "—"}
    </span>
  );


  return (
    <div className="p-3 sm:p-4 md:p-6" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
   {/* ===== THEMED TOOLBAR — floating month pill like Reports ===== */}
<div className="mb-4 sm:mb-6 rounded-3xl overflow-visible shadow-sm ring-1 ring-black/5 relative">
  {/* Brand gradient header (pill sits on the seam) */}
  <div className="rounded-t-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 p-3 sm:p-4 relative pb-8 shadow-[inset_0_-1px_0_rgba(255,255,255,0.25)]">
    <div className="flex flex-wrap items-center justify-center md:justify-between gap-2">
      <h1 className="text-white text-xl sm:text-2xl font-semibold tracking-tight text-center md:text-left">
        USDA Monthly Report
      </h1>
      <div className="hidden md:flex items-center gap-2">{syncChip}</div>
    </div>
    <div className="mt-2 md:mt-3 flex flex-wrap items-center justify-center md:justify-start gap-2">
      {scopeChip}
    </div>

    {/* MonthNav floats between header and controls */}
    <div className="absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 z-10">
      <MonthNav month={month} setMonth={setMonth} />
    </div>
  </div>

  {/* Controls surface – stacked on mobile, aligned L/R on desktop */}
<div className="rounded-b-3xl bg-white/95 backdrop-blur px-3 sm:px-5 pt-9 md:pt-6 pb-4 overflow-visible">
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
      {/* LEFT: Shade select */}
      <div className="w-full md:w-auto max-w-[480px]">
        <label htmlFor="shadeBy" className="sr-only">Shade calendar cells by</label>
        <select
          id="shadeBy"
          className="w-full min-h-[44px] rounded-xl border border-brand-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
          value={shadeBy}
          onChange={(e) => setShadeBy(e.target.value)}
          title="Shade calendar cells by"
        >
          <option value="visits">Shade by Visits</option>
          <option value="persons">Shade by Persons</option>
        </select>
      </div>

      {/* RIGHT: Actions */}
      <div className="w-full md:w-auto md:ml-auto">
        <button
          onClick={exportMonthlyPdf}
          className="w-full md:w-auto min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl
                     bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 px-5 py-2.5 text-white font-semibold shadow
                     hover:from-brand-800 hover:via-brand-700 hover:to-brand-600
                     active:from-brand-900 active:via-brand-800 active:to-brand-700
                     focus:outline-none focus:ring-2 focus:ring-brand-300 transition"
        >
          <span>Download USDA Monthly</span>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 animate-bounce-slow" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-6-6m6 6l6-6" />
            <line x1="4" y1="21" x2="20" y2="21" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</div>



      {error && <div className="mb-3 rounded-lg border bg-red-50 p-3 text-red-700">{error}</div>}
      {loading && <div className="mb-3 text-sm text-gray-600">Loading…</div>}

      {/* Legend */}
      {!loading && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-700">
          <span className="inline-flex items-center gap-1 rounded-full border border-brand-200 px-2 py-1 bg-brand-50/60">
            <span className="inline-block h-3 w-3 rounded" style={{ background: "rgba(153,27,27,0.08)" }} />
            Light = fewer {shadeBy}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-brand-200 px-2 py-1 bg-brand-50/60">
            <span className="inline-block h-3 w-3 rounded" style={{ background: "rgba(153,27,27,0.28)" }} />
            Dark = more {shadeBy}
          </span>
        </div>
      )}

      {/* ===== MOBILE: Horizontal month ===== */}
      {!loading && (
        <div className="sm:hidden relative rounded-3xl border border-brand-200 ring-1 ring-brand-100 bg-white shadow-sm">
          {/* edge fades */}
          <div className="pointer-events-none absolute left-0 top-0 h-full w-6 bg-gradient-to-r from-white to-transparent rounded-l-3xl" />
          <div className="pointer-events-none absolute right-0 top-0 h-full w-6 bg-gradient-to-l from-white to-transparent rounded-r-3xl" />

          <div
            ref={scrollerRef}
            className="overflow-x-auto snap-x snap-mandatory px-2 pb-3 pt-3 rounded-3xl"
            style={{ scrollBehavior: "smooth", WebkitOverflowScrolling: "touch" }}
          >
            {/* weekday header */}
            <div
             
              className="grid sticky top-0 bg-white/95 backdrop-blur z-0 pb-2"

              style={{ gridTemplateColumns: `repeat(7, ${MOBILE_COL_PX}px)`, columnGap: MOBILE_GAP_PX }}
            >
              {weekdays.map((d) => (
                <div key={d} className="text-center text-[11px] font-medium text-brand-900/70">
                  {d}
                </div>
              ))}
            </div>

            {/* grid */}
            <div
              className="grid"
              style={{
                gridTemplateColumns: `repeat(7, ${MOBILE_COL_PX}px)`,
                columnGap: MOBILE_GAP_PX,
                rowGap: MOBILE_GAP_PX,
                gridAutoRows: `minmax(${MOBILE_ROW_MIN}px, auto)`,
              }}
            >
              {calendarDays.map((dk) => {
                const d = parseLocalYMD(dk);
                const inMonth = d.getMonth() === monthIndex0;
                const a = agg.byDay.get(dk) || { visits: 0, persons: 0 };

                const tip = `${dk}\nVisits: ${a.visits}\nPersons: ${a.persons}`;

                return (
                  <button
                    key={dk}
                    title={tip}
                    aria-label={`${dk}: ${a.visits} visits, ${a.persons} persons`}
                    className={cx(
                      "snap-start rounded-2xl border border-brand-200 ring-1 ring-brand-100 px-2.5 py-2.5 text-left flex flex-col gap-1.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.45)] transition min-h-[44px]",
                      inMonth
                        ? "hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                        : "opacity-35 cursor-not-allowed bg-gray-50 text-gray-400"
                    )}
                    style={{ background: inMonth ? cellShade(a) : undefined }}
                    onClick={() => inMonth && nav("/reports", { state: { jumpToDate: dk } })}
                  >
                    <div className="flex items-start justify-between">
                      <span className="text-[12px] font-semibold">{d.getDate()}</span>
                      {(a.visits > 0 || a.persons > 0) && (
                        <span className="text-[10px] px-1 rounded bg-white/85 border shadow-sm tabular-nums">
                          {a.visits}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] leading-5">
                      <span className="font-semibold tabular-nums">{a.visits}</span> v ·{" "}
                      <span className="font-semibold tabular-nums">{a.persons}</span> p
                    </div>
                    <div className="mt-auto pt-1">
                      <div className="h-1.5 w-full rounded bg-white/60 overflow-hidden">
                        <div
                          className="h-full"
                          style={{
                            width: `${Math.min(100, (a.visits / (maxVisits || 1)) * 100)}%`,
                            background: "rgba(153,27,27,0.85)",
                          }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ===== DESKTOP: Roomy grid ===== */}
      {!loading && (
        <div className="hidden sm:block">
          <div className="relative rounded-3xl border border-brand-200 ring-1 ring-brand-100 bg-white shadow-sm">
            <div className="px-2 pb-2">
              <div className="grid grid-cols-7 gap-2 sticky top-0 bg-white/95 backdrop-blur pt-3 pb-2 z-0">
                {weekdays.map((d) => (
                  <div key={d} className="text-center text-xs font-medium text-brand-900/70">
                    {d}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-2 auto-rows-[minmax(118px,auto)]">
                {calendarDays.map((dk) => {
                  const d = parseLocalYMD(dk);
                  const inMonth = d.getMonth() === monthIndex0;
                  const a = agg.byDay.get(dk) || { visits: 0, persons: 0 };
                  const tip = `${dk}\nVisits: ${a.visits}\nPersons: ${a.persons}`;

                  const base =
                    "group rounded-xl border border-brand-200 ring-1 ring-brand-100 p-3 flex flex-col gap-1 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.45)] transition-transform";
                  const enabledHover =
                    "hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300";
                  const disabled = "opacity-50 cursor-not-allowed bg-gray-50 text-gray-400";

                  return (
                    <div
                      key={dk}
                      title={tip}
                      role={inMonth ? "button" : "img"}
                      tabIndex={inMonth ? 0 : -1}
                      aria-label={`${dk}: ${a.visits} visits, ${a.persons} persons`}
                      className={cx(base, inMonth ? enabledHover : disabled)}
                      style={{ background: inMonth ? cellShade(a) : undefined }}
                      onClick={() => inMonth && nav("/reports", { state: { jumpToDate: dk } })}
                      onKeyDown={(e) => {
                        if (!inMonth) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          nav("/reports", { state: { jumpToDate: dk } });
                        }
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold">{d.getDate()}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/85 border shadow-sm">
                          {a.visits} visits
                        </span>
                      </div>
                      <div className="text-[11px] leading-4">
                        <div>
                          Visits: <span className="font-semibold tabular-nums">{a.visits}</span>
                        </div>
                        <div>
                          Persons: <span className="font-semibold tabular-nums">{a.persons}</span>
                        </div>
                      </div>
                      <div className="mt-auto pt-2">
                        <div className="h-1.5 w-full rounded bg-white/60 overflow-hidden">
                          <div
                            className="h-full"
                            style={{
                              width: `${Math.min(100, (a.visits / (maxVisits || 1)) * 100)}%`,
                              background: "rgba(153,27,27,0.85)",
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Totals */}
      {!loading && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <StatCard title="Monthly Totals">
            <div className="text-sm">
              Visits: <span className="font-semibold tabular-nums">{agg.monthTotals.visits}</span>
            </div>
            <div className="text-sm">
              Persons: <span className="font-semibold tabular-nums">{agg.monthTotals.persons}</span>
            </div>
          </StatCard>
          <StatCard title="Unduplicated Totals">
            <div className="text-sm">
              Households: <span className="font-semibold tabular-nums">{agg.unduplicated.households}</span>
            </div>
            <div className="text-sm">
              Persons: <span className="font-semibold tabular-nums">{agg.unduplicated.persons}</span>
            </div>
          </StatCard>
          <StatCard title="Notes">
            <div className="text-xs text-gray-700">
              “Unduplicated” counts each client only on their <b>first USDA visit of the month</b> and uses the household size recorded on that visit.
            </div>
          </StatCard>
        </div>
      )}
    </div>
  );
}
