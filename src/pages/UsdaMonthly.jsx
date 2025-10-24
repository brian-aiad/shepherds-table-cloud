// src/pages/UsdaMonthly.jsx
// Shepherds Table Cloud — USDA / EFAP Monthly (mobile-first, iPhone-friendly)
// P1 fixes implemented:
//  - Index-friendly query (orgId [+locationId], dateKey ASC) with robust onSnapshot→getDocs fallback
//  - Accurate unduplicated totals (first USDA visit per client within the month)
//  - Admin-only guard (component-level, in addition to route guard)
//  - iOS-safe UI, keyboard shortcuts (←/→/T), CSV + EFAP monthly PDF export
//  - Brand palette + focus rings + accessible labels

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
import { downloadbuildEfapMonthlyPdf } from "../utils/buildEfapMonthlyPdf";

/* =========================
   Pure helpers
========================= */
const parseLocalYMD = (ymd) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const fmtYMD = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function startAndEndOfMonth(year, monthIndex0) {
  const start = new Date(year, monthIndex0, 1);
  const end = new Date(year, monthIndex0 + 1, 0);
  return { start, end, startKey: fmtYMD(start), endKey: fmtYMD(end) };
}

function buildCalendarDays(year, monthIndex0) {
  const first = new Date(year, monthIndex0, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const last = new Date(year, monthIndex0 + 1, 0);
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - last.getDay()));
  const out = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) out.push(fmtYMD(d));
  return out;
}

// Month aggregator for UI + EFAP export
function aggregateMonth(visits) {
  const byDay = new Map();
  let monthVisits = 0;
  let monthPersons = 0;

  // Map of clientId -> earliest USDA visit in month (to compute unduplicated)
  const firstsByClient = new Map();

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
   Small UI bits
========================= */
function StatCard({ title, children }) {
  return (
    <div className="rounded-2xl ring-1 ring-brand-900/10 bg-white shadow-sm p-4 sm:p-5">
      <div className="text-xs sm:text-sm text-gray-500 mb-1">{title}</div>
      {children}
    </div>
  );
}

/* =========================
   Month Navigator (compact)
========================= */
function MonthNav({ month, setMonth }) {
  const [y, m] = month.split("-").map(Number);
  const cur = new Date(y, m - 1, 1);

  const jump = useCallback(
    (delta) => {
      const d = new Date(cur);
      d.setMonth(d.getMonth() + delta);
      setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    },
    [cur, setMonth]
  );

  const goToday = useCallback(() => {
    const t = new Date();
    setMonth(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`);
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

  const label = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const iconBtn =
    "inline-flex h-11 w-11 items-center justify-center rounded-xl border bg-white hover:bg-gray-50 active:bg-gray-100 transition";

  return (
    <div className="inline-flex items-center gap-2 sm:gap-3 rounded-2xl border bg-white px-2.5 sm:px-3 py-1.5 sm:py-2 shadow-sm">
      <button onClick={() => jump(-1)} className={iconBtn} aria-label="Previous month" title="Previous month">
        <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" fill="none" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" strokeWidth="2" />
        </svg>
      </button>
      <div className="min-w-[160px] text-center">
        <span className="text-base sm:text-lg font-semibold tracking-tight">{label}</span>
      </div>
      <button onClick={() => jump(1)} className={iconBtn} aria-label="Next month" title="Next month">
        <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" fill="none" aria-hidden="true">
          <path d="M9 6l6 6-6 6" strokeWidth="2" />
        </svg>
      </button>
      <button
        onClick={goToday}
        className="hidden md:inline-flex h-11 items-center justify-center rounded-xl border bg-white px-3 hover:bg-gray-50 active:bg-gray-100 transition ml-1"
        title="Jump to current month (T)"
      >
        Today
      </button>
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
  const [shadeBy, setShadeBy] = useState("visits"); // "visits" | "persons"
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

  // Tenant-scoped monthly fetch — live listener with safe fallback
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
    // Volunteers get auto-scoped by location via rules (and UI). Keep equality before range.
    if (location?.id) filters.unshift(where("locationId", "==", location.id));

    // NOTE: Requires composite index (present in firestore.indexes.json):
    // visits: (orgId ASC, locationId ASC, dateKey ASC) and visits: (orgId ASC, dateKey ASC)
    const qv = query(collection(db, "visits"), ...filters, orderBy("dateKey", "asc"));

    setError("");
    setLoading(true);
    let off;

    (async () => {
      try {
        off = onSnapshot(
          qv,
          (snap) => {
            const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            setVisits(rows);
            setLoading(false);
            setLastSyncedAt(new Date());
          },
          async (e) => {
            console.warn("onSnapshot failed, falling back to getDocs", e);
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

    await downloadbuildEfapMonthlyPdf(
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
    const alpha = 0.06 + v * 0.22; // light → darker within brand red spectrum
    return `rgba(153,27,27,${alpha})`; // brand.900-ish with alpha
  }
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Mobile scroller config
  const scrollerRef = useRef(null);
  const MOBILE_COL_PX = 110; // width per day column on mobile
  const MOBILE_GAP_PX = 10;
  const MOBILE_ROW_MIN = 100; // min height of a day box

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

  const scopePill = (
    <div className="mb-2 text-xs text-gray-600">
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-brand-200 bg-white">
        <span className="font-semibold">Scope</span> • <span>{org?.name || "—"}</span>
        {location?.name ? (
          <>
            <span className="opacity-60">/</span>
            <span>{location.name}</span>
          </>
        ) : (
          <span className="opacity-70">(all locations)</span>
        )}
      </span>
    </div>
  );

  return (
    <div
      className="p-3 sm:p-4 md:p-6"
      style={{
        paddingBottom: "env(safe-area-inset-bottom)", // iOS safe area
      }}
    >
      {scopePill}

      {/* Top bar */}
      <div className="mb-4 sm:mb-6 flex flex-col gap-3 md:grid md:grid-cols-3 md:items-center">
        <div className="flex items-center gap-3">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">USDA Monthly Report</h1>
          <span className="hidden md:inline text-xs text-gray-500">Synced {syncAgo || "—"}</span>
        </div>
        <div className="md:flex md:justify-center">
          <MonthNav month={month} setMonth={setMonth} />
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">
          <label className="sr-only" htmlFor="shadeBy">Shade calendar cells by</label>
          <select
            id="shadeBy"
            className="w-full sm:w-auto min-h-[44px] rounded-xl border px-3 py-2 bg-white text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
            value={shadeBy}
            onChange={(e) => setShadeBy(e.target.value)}
            title="Shade calendar cells by"
          >
            <option value="visits">Shade by Visits</option>
            <option value="persons">Shade by Persons</option>
          </select>
          <div className="flex w-full sm:w-auto gap-2">
            <button
              onClick={exportMonthlyPdf}
              className="flex-1 sm:flex-none min-h-[44px] rounded-xl bg-red-700 px-3 sm:px-4 py-2 text-white shadow hover:bg-red-800 active:bg-red-900"
            >
              USDA Monthly Form
            </button>
            <button
              onClick={exportCsv}
              className="flex-1 sm:flex-none min-h-[44px] rounded-xl bg-brand-700 px-3 py-2 text-white shadow hover:bg-brand-800 active:bg-brand-900"
            >
              Export CSV
            </button>
          </div>
        </div>
      </div>

      {error && <div className="mb-3 rounded-lg border bg-red-50 p-3 text-red-700">{error}</div>}
      {loading && <div className="mb-3 text-sm text-gray-600">Loading…</div>}

      {!loading && (
        <>
          {/* Legend */}
          <div className="mb-3 flex items-center gap-2 text-xs text-gray-600">
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 bg-white">
              <span className="inline-block h-3 w-3 rounded" style={{ background: "rgba(153,27,27,0.08)" }} />
              Light = fewer {shadeBy}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 bg-white">
              <span className="inline-block h-3 w-3 rounded" style={{ background: "rgba(153,27,27,0.28)" }} />
              Dark = more {shadeBy}
            </span>
          </div>

          {/* ===== MOBILE: full month horizontal scroll ===== */}
          <div className="sm:hidden relative rounded-3xl border bg-white shadow-sm">
            {/* soft edge fades */}
            <div className="pointer-events-none absolute left-0 top-0 h-full w-6 bg-gradient-to-r from-white to-transparent rounded-l-3xl" />
            <div className="pointer-events-none absolute right-0 top-0 h-full w-6 bg-gradient-to-l from-white to-transparent rounded-r-3xl" />

            <div
              ref={scrollerRef}
              className="overflow-x-auto snap-x snap-mandatory px-2 pb-3 pt-3 rounded-3xl"
              style={{
                scrollBehavior: "smooth",
                WebkitOverflowScrolling: "touch", // iOS momentum
              }}
            >
              {/* weekday header (sticky) */}
              <div
                className="grid sticky top-0 bg-white/95 backdrop-blur z-10 pb-2"
                style={{ gridTemplateColumns: `repeat(7, ${MOBILE_COL_PX}px)`, columnGap: MOBILE_GAP_PX }}
              >
                {weekdays.map((d) => (
                  <div key={d} className="text-center text-[11px] font-medium text-gray-500">
                    {d}
                  </div>
                ))}
              </div>

              {/* month grid */}
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
                        "snap-start rounded-2xl border px-2.5 py-2.5 text-left flex flex-col gap-1.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.45)] transition min-h-[44px]",
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

          {/* ===== TABLET/DESKTOP: roomy grid ===== */}
          <div className="hidden sm:block">
            <div className="relative rounded-3xl border bg-white shadow-sm">
              <div className="px-2 pb-2">
                <div className="grid grid-cols-7 gap-2 sticky top-0 bg-white/95 backdrop-blur pt-3 pb-2 z-10">
                  {weekdays.map((d) => (
                    <div key={d} className="text-center text-xs font-medium text-gray-500">
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
                      "group rounded-xl border p-3 flex flex-col gap-1 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.45)] transition-transform";
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

          {/* Totals */}
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
              <div className="text-xs text-gray-600">
                “Unduplicated” counts each client only on their <b>first USDA visit of the month</b> and uses the
                household size recorded on that visit.
              </div>
            </StatCard>
          </div>
        </>
      )}
    </div>
  );
}
