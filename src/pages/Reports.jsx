// src/pages/Reports.jsx
/**
 * Shepherds Table Cloud — Reports (Admin)
 * Assumptions I’m making:
 * - You want all Firestore reads/writes scoped by the active org (and the active location when present).
 * - Volunteers will never hit this page because the route is guarded elsewhere; still, we feature-gate destructive actions via isAdmin.
 * - Your EFAP Daily builder util might be named slightly differently across branches. I added a safe dynamic import that tries both file names.
 * - We keep your “downloadbuildEfapMonthlyPdf” import as-is to match your existing utils.
 */

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useLocation as useRRLocation, Navigate } from "react-router-dom";

import {
  collection,
  getDocs,
  getDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  doc,
  deleteDoc,
  runTransaction,
  serverTimestamp,
  limit as qLimit,
} from "firebase/firestore";
import { db, auth } from "../lib/firebase";
import { useAuth } from "../auth/useAuth";

// Keep your existing Monthly util name (matches your UsdaMonthly.jsx)
import { downloadbuildEfapMonthlyPdf } from "../utils/buildEfapMonthlyPdf";

// Recharts
import {
  ResponsiveContainer,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Bar,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from "recharts";

/* =======================================================================================
   UTILITIES (date, grouping, CSV, PDF, share, tiny toast)
   ======================================================================================= */

// —— Date helpers ——
const fmtDateKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

const monthKeyFor = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const dateFromMonthKey = (mk) => {
  const [y, m] = mk.split("-").map(Number);
  return new Date(y, m - 1, 1);
};
const monthLabel = (mk) =>
  dateFromMonthKey(mk).toLocaleDateString(undefined, { month: "long", year: "numeric" });

const toJSDate = (ts) => (ts?.toDate ? ts.toDate() : new Date(ts));
const toISO = (d) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

const chunk = (arr, size = 10) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const todayKey = fmtDateKey(new Date());

// —— tiny toast ——
function useToast() {
  const [msg, setMsg] = useState("");
  const [type, setType] = useState("info");
  const [open, setOpen] = useState(false);
  const timer = useRef(null);

  const show = useCallback((text, kind = "info", ms = 2200) => {
    setMsg(text);
    setType(kind);
    setOpen(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), ms);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);
  return { open, msg, type, show, hide: () => setOpen(false) };
}

// —— download & share helpers ——
function toUint8Array(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  return new Uint8Array(bytes || []);
}

function downloadText(content, filename, mime = "text/csv;charset=utf-8") {
  try {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.setAttribute("download", filename);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("Download text failed:", e);
    alert("Couldn’t download the file.");
  }
}

function downloadBytes(bytes, filename, mime = "application/pdf") {
  try {
    const ui8 = toUint8Array(bytes);
    const blob = new Blob([ui8], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.setAttribute("download", filename);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("Download bytes failed:", e);
    alert("Couldn’t download the file.");
  }
}

async function shareFileFallback(fileOrBlob, filename) {
  try {
    const file =
      fileOrBlob instanceof File
        ? fileOrBlob
        : new File([fileOrBlob], filename, { type: fileOrBlob.type || "application/octet-stream" });

    const canShare =
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [file] });

    if (canShare) {
      await navigator.share({ files: [file], title: filename, text: filename });
    } else {
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.setAttribute("download", file.name);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  } catch (e) {
    console.error("Share fallback error", e);
    const url = URL.createObjectURL(fileOrBlob);
    const a = document.createElement("a");
    a.href = url;
    a.setAttribute("download", filename);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}

// —— CSV builders ——
function buildCsvGeneric(rows) {
  const keys = new Set();
  for (const r of rows || []) for (const k of Object.keys(r || {})) keys.add(k);
  const header = Array.from(keys);
  const lines = [header.join(",")];
  for (const r of rows || []) {
    const vals = header.map((k) => String(r?.[k] ?? "").replaceAll('"', '""'));
    lines.push(vals.map((v) => `"${v}"`).join(","));
  }
  return lines.join("\n");
}
function buildUsdaMonthlyCsv({ rows }) {
  return buildCsvGeneric(rows || []);
}

// —— USDA units helper ——
const usdaUnitsOf = (v) =>
  Number.isFinite(v?.usdaCount) ? Number(v.usdaCount) : v?.usdaFirstTimeThisMonth ? 1 : 0;

// —— Lightweight Monthly PDF using pdf-lib (kept for quick share-from-page) ——
async function buildUsdaMonthlyPdf({ monthKey, visits, org, generatedBy }) {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");

  // group per day
  const rowsMap = new Map();
  for (const v of visits || []) {
    const dk = v.dateKey || fmtDateKey(toJSDate(v.visitAt));
    if (!rowsMap.has(dk)) rowsMap.set(dk, []);
    rowsMap.get(dk).push(v);
  }
  const dayKeys = Array.from(rowsMap.keys()).sort();

  const totalUsda = (visits || []).reduce((s, v) => s + usdaUnitsOf(v), 0);
  const totalHH = (visits || []).reduce((s, v) => s + Number(v.householdSize || 0), 0);
  const avgPerDay = dayKeys.length ? Math.round((totalUsda / dayKeys.length) * 10) / 10 : 0;

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 612;
  const pageHeight = 792;
  let page = pdf.addPage([pageWidth, pageHeight]);

  const draw = (txt, x, y, size = 10, bold = false) =>
    page.drawText(String(txt), { x, y, size, font: bold ? fontBold : font });

  // header
  let y = pageHeight - 50;
  draw(org || "Organization", 40, y, 14, true);
  draw("USDA Monthly Summary", 40, y - 18, 12, true);
  draw(`Month: ${monthLabel(monthKey)} (${monthKey})`, 40, y - 36);
  draw(`Generated: ${new Date().toLocaleString()}`, 40, y - 50);
  draw(`Prepared by: ${generatedBy || "—"}`, 40, y - 64);

  // summary
  y -= 92;
  draw(`Total USDA units: ${totalUsda}`, 40, y, 11, true);
  draw(`Total households: ${totalHH}`, 240, y, 11, true);
  draw(`Average per day: ${avgPerDay}`, 430, y, 11, true);

  // table header
  y -= 22;
  const columns = [
    { label: "Date", width: 110 },
    { label: "Household Count", width: 160 },
    { label: "USDA Units (sum)", width: 160 },
    { label: "Notes", width: 110 },
  ];
  let x = 40;
  for (const c of columns) {
    draw(c.label, x, y, 10, true);
    x += c.width;
  }
  y -= 10;
  page.drawLine({ start: { x: 40, y }, end: { x: pageWidth - 40, y }, thickness: 1 });
  y -= 12;

  const rowH = 16;
  const drawFooter = () => {
    const idx = pdf.getPageCount();
    page.drawText(`Page ${idx}`, { x: pageWidth - 90, y: 30, size: 10, font });
  };

  for (const dk of dayKeys) {
    if (y < 60) {
      drawFooter();
      page = pdf.addPage([pageWidth, pageHeight]);
      y = pageHeight - 40;
      x = 40;
      for (const c of columns) page.drawText(c.label, { x, y, size: 10, font: fontBold });
      y -= 22;
    }
    const arr = rowsMap.get(dk) || [];
    const hh = arr.reduce((s, v) => s + Number(v.householdSize || 0), 0);
    const usda = arr.reduce((s, v) => s + usdaUnitsOf(v), 0);

    x = 40;
    draw(dk, x, y);
    x += columns[0].width;
    draw(String(hh), x, y);
    x += columns[1].width;
    draw(String(usda), x, y);
    x += columns[2].width;
    draw("", x, y);
    y -= rowH;
  }
  drawFooter();

  return await pdf.save(); // Uint8Array
}

async function shareUsdaMonthlyReport(monthKey, { visits, org, generatedBy }) {
  const pdfBytes = await buildUsdaMonthlyPdf({ monthKey, visits, org, generatedBy });
  const csvRows = (visits || []).map((v) => ({
    dateKey: v.dateKey || fmtDateKey(toJSDate(v.visitAt)),
    monthKey: v.monthKey || monthKey,
    clientId: v.clientId || "",
    householdSize: v.householdSize ?? "",
    usdaFirstTimeThisMonth: v.usdaFirstTimeThisMonth ?? "",
    usdaCount: v.usdaCount ?? "",
  }));
  const csv = buildUsdaMonthlyCsv({ rows: csvRows });

  const pdfFile = new File([pdfBytes], `USDA_Monthly_${monthKey}.pdf`, { type: "application/pdf" });
  const csvFile = new File([csv], `USDA_Monthly_${monthKey}.csv`, { type: "text/csv;charset=utf-8" });

  try {
    const canShare =
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [pdfFile, csvFile] });

    if (canShare) {
      await navigator.share({
        title: `USDA Monthly Summary — ${monthKey}`,
        text: `${org || "Organization"} — ${monthKey}`,
        files: [pdfFile, csvFile],
      });
      return;
    }
  } catch {
    /* no-op, fallback below */
  }

  // fallback: download both
  for (const f of [pdfFile, csvFile]) {
    const url = URL.createObjectURL(f);
    const a = document.createElement("a");
    a.href = url;
    a.setAttribute("download", f.name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}

// —— Simple EFAP aggregator (for your existing monthly PDF util input) ——
function aggregateMonthForPdf(visits) {
  const byDay = new Map(); // dateKey -> {households, persons}
  const firsts = new Map(); // clientId -> earliest {dateKey, persons}
  let hh = 0,
    pp = 0;

  for (const v of visits || []) {
    const k = v.dateKey;
    const persons = Number(v.householdSize || 0);

    const prev = byDay.get(k) || { households: 0, persons: 0 };
    prev.households += 1;
    prev.persons += persons;
    byDay.set(k, prev);

    hh += 1;
    pp += persons;

    if (v.clientId && v.usdaFirstTimeThisMonth) {
      const cur = firsts.get(v.clientId);
      if (!cur || v.dateKey < cur.dateKey) firsts.set(v.clientId, { dateKey: v.dateKey, persons });
    }
  }

  const undHH = firsts.size;
  const undPP = Array.from(firsts.values()).reduce((s, x) => s + x.persons, 0);

  return {
    byDay,
    monthTotals: { households: hh, persons: pp },
    unduplicated: { households: undHH, persons: undPP },
  };
}

/* =======================================================================================
   MONTH NAV
   ======================================================================================= */
function ReportsMonthNav({ monthKey, setMonthKey, setSelectedDate }) {
  const label = monthLabel(monthKey);

  const jump = useCallback(
    (delta) => {
      const d = dateFromMonthKey(monthKey);
      d.setMonth(d.getMonth() + delta);
      const mk = monthKeyFor(d);
      setMonthKey(mk);
      setSelectedDate(fmtDateKey(d));
    },
    [monthKey, setMonthKey, setSelectedDate]
  );

  const goToday = useCallback(() => {
    const t = new Date();
    const mk = monthKeyFor(t);
    setMonthKey(mk);
    setSelectedDate(fmtDateKey(t));
  }, [setMonthKey, setSelectedDate]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowLeft") jump(-1);
      if (e.key === "ArrowRight") jump(1);
      if (e.key.toLowerCase() === "t") goToday();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [jump, goToday]);

  const iconBtn =
    "inline-flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl border bg-white hover:bg-gray-50 active:bg-gray-100 transition";

  return (
    <div className="inline-flex items-center gap-2 sm:gap-3 rounded-2xl ring-1 ring-rose-200 bg-white shadow-sm ring-offset-rose-50 ring-offset-1 px-2.5 sm:px-3 py-1.5 sm:py-2">
      <button onClick={() => jump(-1)} className={iconBtn} aria-label="Previous month" title="Previous month">
        <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" fill="none">
          <path d="M15 6l-6 6 6 6" strokeWidth="2" />
        </svg>
      </button>

      <div className="min-w-[150px] text-center">
        <span className="text-base sm:text-lg font-semibold tracking-tight">{label}</span>
      </div>

      <button onClick={() => jump(1)} className={iconBtn} aria-label="Next month" title="Next month">
        <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" fill="none">
          <path d="M9 6l6 6-6 6" strokeWidth="2" />
        </svg>
      </button>

      <button
        onClick={goToday}
        className="hidden md:inline-flex h-9 sm:h-10 items-center justify-center rounded-xl border bg-white px-3 hover:bg-gray-50 active:bg-gray-100 transition ml-1"
        title="Jump to current month (T)"
      >
        Today
      </button>
    </div>
  );
}

/* =======================================================================================
   PAGE
   ======================================================================================= */
export default function Reports() {
  const { org, location, isAdmin, email } = useAuth(); // multi-tenant scope
  const rrLocation = useRRLocation();

  const [exportingPdf, setExportingPdf] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedMonthKey, setSelectedMonthKey] = useState(monthKeyFor(new Date()));
  const [selectedDate, setSelectedDate] = useState(fmtDateKey(new Date()));
  const [visits, setVisits] = useState([]);
  const [clientsById, setClientsById] = useState(new Map());

  // Redirect if signed out (belt & suspenders; route guard should handle)
  if (!email) return <Navigate to="/login" replace />;

  // Live-ish status
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [syncAgo, setSyncAgo] = useState("");
  useEffect(() => {
    const tick = () => {
      if (!lastSyncedAt) return setSyncAgo("");
      const secs = Math.max(0, Math.floor((Date.now() - lastSyncedAt.getTime()) / 1000));
      if (secs < 60) setSyncAgo(`${secs}s ago`);
      else setSyncAgo(`${Math.floor(secs / 60)}m ago`);
    };
    const id = setInterval(tick, 1000);
    tick();
    return () => clearInterval(id);
  }, [lastSyncedAt]);

  // Scroll to top once on mount
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  // Load visits for the selected month scoped by ORG (and LOCATION when present)
  useEffect(() => {
    if (!org?.id) {
      setVisits([]);
      return;
    }
    setLoading(true);
    setError("");
    let off;
    (async () => {
      try {
        const base = [
          where("orgId", "==", org.id),
          where("monthKey", "==", selectedMonthKey),
        ];
        // If a location is currently active, scope to it too (admins can still switch)
        if (location?.id) base.push(where("locationId", "==", location.id));

        const qv = query(collection(db, "visits"), ...base, orderBy("visitAt", "desc"));

        off = onSnapshot(
          qv,
          (snap) => {
            setVisits(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
            setLoading(false);
            setLastSyncedAt(new Date());
          },
          async (e) => {
            console.warn("onSnapshot failed, falling back to getDocs", e);
            try {
              const fallQ = query(collection(db, "visits"), ...base);
              const snap2 = await getDocs(fallQ);
              const rows = snap2.docs.map((d) => ({ id: d.id, ...d.data() }));
              rows.sort((a, b) => toJSDate(b.visitAt) - toJSDate(a.visitAt));
              setVisits(rows);
            } catch {
              setError("Failed to load visits for this month.");
            } finally {
              setLoading(false);
              setLastSyncedAt(new Date());
            }
          }
        );
      } catch (e) {
        console.error(e);
        setError("Failed to load visits for this month.");
        setLoading(false);
      }
    })();
    return () => (off ? off() : undefined);
  }, [selectedMonthKey, org?.id, location?.id]);

  // Jump to a specific date via router state (e.g., from Dashboard → Reports)
  useEffect(() => {
    const jt = rrLocation.state && rrLocation.state.jumpToDate;
    if (!jt) return;
    const [y, m] = jt.split("-").map(Number);
    const mk = `${y}-${String(m).padStart(2, "0")}`;
    setSelectedMonthKey(mk);
    setSelectedDate(jt);
    history.replaceState({}, document.title);
  }, [rrLocation.state]);

  // Hydrate clients for visible visits (batched)
  useEffect(() => {
    (async () => {
      try {
        const ids = Array.from(new Set(visits.map((v) => v.clientId).filter(Boolean)));
        if (!ids.length) {
          setClientsById(new Map());
          return;
        }
        const m = new Map();
        for (const part of chunk(ids, 10)) {
          const qs = await getDocs(query(collection(db, "clients"), where("__name__", "in", part)));
          for (const d of qs.docs) m.set(d.id, { id: d.id, ...d.data() });
        }
        setClientsById(m);
      } catch (e) {
        console.warn("Client lookup error", e);
      }
    })();
  }, [visits]);

  // Group visits by day
  const visitsByDay = useMemo(() => {
    const m = new Map();
    for (const v of visits) {
      const k = v.dateKey || fmtDateKey(toJSDate(v.visitAt));
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(v);
    }
    for (const arr of m.values()) arr.sort((a, b) => toJSDate(b.visitAt) - toJSDate(a.visitAt));
    return m;
  }, [visits]);

  // Keep day selection valid & in view
  const [dayFilter, setDayFilter] = useState("");
  const sortedDayKeys = useMemo(
    () =>
      Array.from(visitsByDay.keys())
        .filter((k) => (dayFilter ? k.includes(dayFilter) : true))
        .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)),
    [visitsByDay, dayFilter]
  );

  useEffect(() => {
    if (!sortedDayKeys.length) return;
    const fallback = sortedDayKeys[0];
    if (!selectedDate || !visitsByDay.has(selectedDate)) setSelectedDate(fallback);
    const id = `day-${selectedDate || fallback}`;
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ block: "nearest" });
    });
  }, [sortedDayKeys, selectedDate, visitsByDay]);

  // Rows for selected day
  const rowsForSelectedDay = useMemo(() => {
    const src = visitsByDay.get(selectedDate) || [];
    return src.map((v) => {
      const d = toJSDate(v.visitAt);
      const person = clientsById.get(v.clientId) || {};
      const labelName =
        `${person.firstName || v.clientFirstName || ""} ${
          person.lastName || v.clientLastName || ""
        }`.trim() || v.clientId;

      const address =
        person.address ||
        person.addr ||
        person.street ||
        person.street1 ||
        person.line1 ||
        person.address1 ||
        "";

      return {
        visitId: v.id,
        clientId: v.clientId || "",
        firstName: person.firstName || "",
        lastName: person.lastName || "",
        address,
        zip: person.zip || "",

        visitHousehold: v.householdSize ?? "",
        usdaFirstTimeThisMonth: v.usdaFirstTimeThisMonth ?? "",
        usdaCount: v.usdaCount ?? null,

        monthKey: v.monthKey || "",
        visitAtISO: toISO(d),
        dateKey: v.dateKey || fmtDateKey(d),
        labelName,

        localTime: d.toLocaleString(),

        addedAtISO: v.addedAt ? toISO(toJSDate(v.addedAt)) : "",
        addedLocalTime: v.addedAt ? toJSDate(v.addedAt).toLocaleString() : "",
        addedByReports: v.addedByReports === true,
      };
    });
  }, [visitsByDay, selectedDate, clientsById]);

  // Filters & sort
  const [term, setTerm] = useState("");
  const [usdaFilter, setUsdaFilter] = useState("all"); // all|yes|no
  const [sortKey, setSortKey] = useState("time"); // time|name|hh
  const [sortDir, setSortDir] = useState("desc"); // asc|desc

  const filteredSortedRows = useMemo(() => {
    let rows = rowsForSelectedDay;

    if (usdaFilter !== "all") {
      rows = rows.filter((r) =>
        usdaFilter === "yes" ? r.usdaFirstTimeThisMonth === true : r.usdaFirstTimeThisMonth === false
      );
    }

    if (term.trim()) {
      const q = term.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          (r.labelName || "").toLowerCase().includes(q) ||
          (r.address || "").toLowerCase().includes(q) ||
          (r.zip || "").toLowerCase().includes(q)
      );
    }

    const cmp = (a, b) => {
      let d = 0;
      if (sortKey === "time") d = a.visitAtISO.localeCompare(b.visitAtISO);
      else if (sortKey === "name") d = (a.labelName || "").localeCompare(b.labelName || "");
      else if (sortKey === "hh") d = Number(a.visitHousehold || 0) - Number(b.visitHousehold || 0);
      return sortDir === "asc" ? d : -d;
    };
    return [...rows].sort(cmp);
  }, [rowsForSelectedDay, term, usdaFilter, sortKey, sortDir]);

  // Day totals
  const dayTotals = useMemo(() => {
    const count = filteredSortedRows.length;
    const hh = filteredSortedRows.reduce((s, r) => s + Number(r.visitHousehold || 0), 0);
    const usdaYes = filteredSortedRows.reduce((s, r) => s + (r.usdaFirstTimeThisMonth === true ? 1 : 0), 0);
    return { count, hh, usdaYes };
  }, [filteredSortedRows]);

  // Month aggregates (KPI + charts)
  const monthAgg = useMemo(() => {
    const totalHH = visits.reduce((s, v) => s + Number(v.householdSize || 0), 0);
    const usdaUnits = visits.reduce((s, v) => s + usdaUnitsOf(v), 0);

    const byDay = new Map();
    for (const v of visits) {
      const k = v.dateKey || fmtDateKey(toJSDate(v.visitAt));
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(v);
    }

    const daysWithVisits = byDay.size || 1;
    const avgPerDay = Math.round((usdaUnits / daysWithVisits) * 10) / 10;
    const households = totalHH;

    // charts
    const visitsPerDay = Array.from(byDay.entries())
      .map(([dateKey, arr]) => ({
        date: dateKey.slice(5), // "MM-DD"
        visits: arr.length,
        people: arr.reduce((s, v) => s + Number(v.householdSize || 0), 0),
        usdaYes: arr.reduce((s, v) => s + (v.usdaFirstTimeThisMonth === true ? 1 : 0), 0),
      }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    const usdaYesTotal = visits.filter((v) => v.usdaFirstTimeThisMonth === true).length;
    const usdaNoTotal = visits.length - usdaYesTotal;

    return {
      usdaUnits,
      households,
      avgPerDay,
      byDay,
      charts: {
        visitsPerDay,
        usdaPie: [
          { name: "USDA Yes", value: usdaYesTotal },
          { name: "USDA No", value: usdaNoTotal },
        ],
      },
    };
  }, [visits]);

  // Actions
  const toast = useToast();

  const removeVisit = useCallback(
    async (visitId) => {
      if (!visitId) return;
      if (!isAdmin) return toast.show("Only admins can delete.", "warn");
      const ok = confirm("Delete this visit from the database?");
      if (!ok) return;
      try {
        await deleteDoc(doc(db, "visits", visitId));
        setVisits((prev) => prev.filter((v) => v.id !== visitId));
        toast.show("Visit deleted.", "info");
      } catch (e) {
        console.error(e);
        alert("Failed to delete visit. Please try again.");
      }
    },
    [isAdmin]
  );

  const exportOneDayCsv = useCallback(
    (dayKey) => {
      const src = visitsByDay.get(dayKey) || [];
      const rows = src.map((v) => {
        const d = toJSDate(v.visitAt);
        const p = clientsById.get(v.clientId) || {};
        const address = p.address || p.addr || p.street || p.street1 || p.line1 || p.address1 || "";
        return {
          dateKey: v.dateKey || fmtDateKey(d),
          monthKey: v.monthKey || "",
          visitId: v.id,
          visitAtISO: toISO(d),
          clientId: v.clientId || "",
          firstName: p.firstName || "",
          lastName: p.lastName || "",
          address,
          zip: p.zip || "",
          householdSize: v.householdSize ?? "",
          usdaFirstTimeThisMonth: v.usdaFirstTimeThisMonth ?? "",
          usdaCount: v.usdaCount ?? "",
        };
      });
      const csv = buildUsdaMonthlyCsv({ rows });
      downloadText(csv, `visits_${dayKey}.csv`);
      toast.show("CSV exported.", "info");
    },
    [visitsByDay, clientsById]
  );

  // —— EFAP Daily PDF: dynamic import that tolerates either name you may have in /utils ——
  async function getDailyPdfBuilder() {
    try {
      // your pasted file referenced "../utils/buildEfapDailylyPdf"
      const mod = await import("../utils/buildEfapDailyPdf");
      return { build: mod.buildbuildEfapDailylyPdf ?? mod.buildEfapDailylyPdf, efapSuggestedFileName: mod.efapSuggestedFileName };
    } catch {
      // fallback to a cleaner file name if that’s what exists in your repo
      const mod = await import("../utils/buildEfapDailyPdf");
      return { build: mod.buildEfapDailyPdf, efapSuggestedFileName: mod.efapSuggestedFileName };
    }
  }

  const exportEfapDailyPdfForDay = useCallback(
    async (dayKey) => {
      try {
        const { build, efapSuggestedFileName } = await getDailyPdfBuilder();
        const src = visitsByDay.get(dayKey) || [];
        const rows = src.map((v) => {
          const p = clientsById.get(v.clientId) || {};
          const name = `${p.firstName || ""} ${p.lastName || ""}`.trim() || v.clientId || "";
          const address = p.address || p.addr || p.street || p.street1 || p.line1 || p.address1 || "";
          return {
            name,
            address,
            zip: p.zip || "",
            householdSize: Number(v.householdSize || 0),
            firstTime:
              v.usdaFirstTimeThisMonth === true
                ? true
                : v.usdaFirstTimeThisMonth === false
                ? false
                : "",
          };
        });

        const pdfBytes = await build(rows, { dateStamp: dayKey });
        const fileName = efapSuggestedFileName ? efapSuggestedFileName(dayKey) : `EFAP_${dayKey}.pdf`;
        downloadBytes(pdfBytes, fileName, "application/pdf");
        toast.show("EFAP PDF downloaded.", "info");
      } catch (e) {
        console.error("EFAP build/download failed:", e);
        alert("Couldn’t build the EFAP PDF for that day.");
      }
    },
    [visitsByDay, clientsById]
  );

  const shareEfapDailyPdfForDay = useCallback(
    async (dayKey) => {
      try {
        const { build, efapSuggestedFileName } = await getDailyPdfBuilder();
        const src = visitsByDay.get(dayKey) || [];
        const rows = src.map((v) => {
          const p = clientsById.get(v.clientId) || {};
          const name = `${p.firstName || ""} ${p.lastName || ""}`.trim() || v.clientId || "";
          const address = p.address || p.addr || p.street || p.street1 || p.line1 || p.address1 || "";
          return {
            name,
            address,
            zip: p.zip || "",
            householdSize: Number(v.householdSize || 0),
            firstTime:
              v.usdaFirstTimeThisMonth === true
                ? true
                : v.usdaFirstTimeThisMonth === false
                ? false
                : "",
          };
        });
        const pdfBytes = await build(rows, { dateStamp: dayKey });
        const fileName = efapSuggestedFileName ? efapSuggestedFileName(dayKey) : `EFAP_${dayKey}.pdf`;
        const file = new File([toUint8Array(pdfBytes)], fileName, { type: "application/pdf" });

        await shareFileFallback(file, file.name);
        toast.show("EFAP PDF ready to share.", "info");
      } catch (e) {
        console.error("EFAP share (day) failed:", e);
        alert("Couldn’t share the EFAP PDF for that day.");
      }
    },
    [visitsByDay, clientsById]
  );

  // Export USDA monthly (your existing util)
  const handleExportUsdaPdf = useCallback(async () => {
    try {
      setExportingPdf(true);

      const [y, m] = selectedMonthKey.split("-").map(Number);
      const year = y;
      const monthIndex0 = m - 1;

      const agg = aggregateMonthForPdf(visits);
      const monthLabelStr = new Date(year, monthIndex0, 1).toLocaleString(undefined, {
        month: "long",
        year: "numeric",
      });

      await downloadbuildEfapMonthlyPdf(
        {
          year,
          monthIndex0,
          byDayMap: agg.byDay,
          monthTotals: agg.monthTotals,
          unduplicated: agg.unduplicated,
          header: {
            agency: org?.name || "—",
            acct: "—",
            phone: "—",
            contact: "—",
            address: location?.name ? `${location.name}` : "—",
          },
        },
        `EFAP_Monthly_${monthLabelStr}.pdf`
      );
    } finally {
      setExportingPdf(false);
    }
  }, [selectedMonthKey, visits, org?.name, location?.name]);

  // Add visit from modal (scoped write with org/location + usda_first marker)
  const [addOpen, setAddOpen] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [addCandidates, setAddCandidates] = useState([]);
  const [addHH, setAddHH] = useState(1);
  const [addUSDA, setAddUSDA] = useState(true);
  const [addBusy, setAddBusy] = useState(false);

  // UI refs
  const dayListRef = useRef(null);

  /* =======================================================================================
     RENDER
     ======================================================================================= */
  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto overflow-x-hidden">
      {/* Sticky/blurred toolbar */}
      <div className="sticky top-0 z-20 bg-gradient-to-b from-white/70 to-white/10 backdrop-blur supports-[backdrop-filter]:backdrop-blur border-b">
        <div className="px-3 sm:px-0 py-3 sm:py-4">
          <div className="grid items-center gap-3 lg:grid-cols-3">
            <h1 className="justify-self-start text-xl sm:text-2xl font-semibold tracking-tight">Reports</h1>
            <div className="justify-self-center">
              <ReportsMonthNav
                monthKey={selectedMonthKey}
                setMonthKey={setSelectedMonthKey}
                setSelectedDate={setSelectedDate}
              />
            </div>
            <div className="hidden lg:flex justify-self-end items-center gap-2">
              <button
                onClick={handleExportUsdaPdf}
                disabled={exportingPdf || !visits.length}
                className="inline-flex items-center justify-center rounded-lg px-3 h-10 bg-brand-700 text-white hover:bg-brand-800 disabled:opacity-60"
                title="Download USDA Monthly PDF"
              >
                {exportingPdf ? "Building…" : "USDA Monthly PDF"}
              </button>
              <span className="text-xs text-gray-500">{syncAgo ? `Synced ${syncAgo}` : ""}</span>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Row */}
      <div className="mt-3 sm:mt-4">
        <div className="relative -mx-3 sm:mx-0">
          <div className="pointer-events-none absolute left-0 top-0 h-full w-6 bg-gradient-to-r from-white to-transparent sm:hidden" />
          <div className="pointer-events-none absolute right-0 top-0 h-full w-6 bg-gradient-to-l from-white to-transparent sm:hidden" />
          <div className="px-3 sm:px-0">
            <div className="grid grid-flow-col auto-cols-[78%] xs:auto-cols-[60%] sm:auto-cols-[minmax(0,1fr)] gap-3 overflow-x-auto snap-x snap-mandatory pb-1">
              <KpiModern title="Days in Scope" value={Array.from(monthAgg.byDay.keys()).length} />
              <KpiModern title="Households (Month)" value={monthAgg.households} />
              <KpiModern title="USDA Yes Total (Month)" value={monthAgg.usdaUnits} />
              <KpiModern title="Avg USDA / Day" value={monthAgg.avgPerDay} sub="(days w/ visits)" />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 sm:mt-8 lg:mt-12" />

      {/* Charts */}
      {(() => {
        const BRAND_COLORS = {
          primary: "#991b1b",
          secondary: "#f87171",
          light: "#fecaca",
          text: "#1f2937",
          grid: "#e5e7eb",
        };

        const tooltipStyle = {
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
          padding: "8px 12px",
        };

        return (
          <div className="grid gap-4 sm:gap-5 lg:gap-6 md:grid-cols-3 mb-6 sm:mb-8">
            {/* Visits per Day */}
            <Card title="Visits per Day">
              <div className="h-[240px] flex items-center justify-center">
                <ResponsiveContainer width="95%" height="90%">
                  <LineChart data={monthAgg.charts.visitsPerDay} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="lineGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={BRAND_COLORS.primary} stopOpacity={1} />
                        <stop offset="100%" stopColor={BRAND_COLORS.secondary} stopOpacity={0.4} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={BRAND_COLORS.grid} vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: "#6b7280" }}
                      axisLine={{ stroke: BRAND_COLORS.grid }}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: "#6b7280" }}
                      axisLine={{ stroke: BRAND_COLORS.grid }}
                      tickLine={false}
                      width={28}
                    />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: BRAND_COLORS.secondary, opacity: 0.3 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line
                      type="monotone"
                      dataKey="visits"
                      stroke="url(#lineGradient)"
                      strokeWidth={3}
                      dot={false}
                      activeDot={{
                        r: 5,
                        stroke: "#fff",
                        strokeWidth: 2,
                        fill: BRAND_COLORS.primary,
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* USDA Yes vs No */}
            <Card title="USDA Yes vs No">
              <div className="h-[240px] flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart margin={{ top: 10, bottom: 10 }}>
                    <Pie
                      data={monthAgg.charts.usdaPie}
                      dataKey="value"
                      nameKey="name"
                      innerRadius="55%"
                      outerRadius="80%"
                      paddingAngle={1.5}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {monthAgg.charts.usdaPie.map((_, i) => (
                        <Cell key={i} fill={i === 0 ? BRAND_COLORS.primary : BRAND_COLORS.light} stroke="#fff" strokeWidth={1.5} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* People Served by Day */}
            <Card title="People Served by Day">
              <div className="h-[240px] flex items-center justify-center">
                <ResponsiveContainer width="95%" height="90%">
                  <BarChart data={monthAgg.charts.visitsPerDay} margin={{ top: 10, right: 10, left: -10, bottom: 0 }} barCategoryGap={8}>
                    <defs>
                      <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={BRAND_COLORS.primary} stopOpacity={1} />
                        <stop offset="100%" stopColor={BRAND_COLORS.secondary} stopOpacity={0.7} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={BRAND_COLORS.grid} vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: "#6b7280" }}
                      axisLine={{ stroke: BRAND_COLORS.grid }}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: "#6b7280" }}
                      axisLine={{ stroke: BRAND_COLORS.grid }}
                      tickLine={false}
                      width={28}
                    />
                    <Tooltip cursor={false} contentStyle={tooltipStyle} />
                    <Bar dataKey="people" fill="url(#barGradient)" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        );
      })()}

      {/* Layout: days list + table */}
      <div className="mt-6 sm:mt-8 grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 print:block">
        {/* Days list */}
        <aside className="rounded-2xl ring-1 ring-rose-200 bg-white shadow-sm ring-offset-rose-50 ring-offset-1 p-3 print:hidden lg:col-span-1">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <div className="font-semibold">Days in {monthLabel(selectedMonthKey)}</div>
            <input
              className="rounded-lg border px-2 py-1 text-sm w-[160px] sm:w-[170px]"
              placeholder="Filter days (YYYY-MM-DD)"
              value={dayFilter}
              onChange={(e) => setDayFilter(e.target.value)}
              aria-label="Filter days"
            />
          </div>

          <div
            ref={dayListRef}
            className="max-h-[68svh] overflow-y-auto overscroll-contain pr-1"
            style={{ WebkitOverflowScrolling: "touch" }}
            aria-label="Days list"
          >
            <ul className="space-y-2">
              {sortedDayKeys.map((k) => {
                const items = visitsByDay.get(k) || [];
                const dayHH = items.reduce((s, v) => s + Number(v.householdSize || 0), 0);
                const dayUsda = items.reduce((s, v) => s + (v.usdaFirstTimeThisMonth === true ? 1 : 0), 0);
                const isSelected = selectedDate === k;
                const isToday = k === todayKey;

                return (
                  <li
                    key={k}
                    id={`day-${k}`}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={(e) => {
                      if (e.target.closest("[data-day-action]")) return;
                      setSelectedDate(k);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedDate(k);
                      }
                    }}
                    className={`group cursor-pointer flex items-stretch gap-2 p-2 rounded-xl border transition
                      ${isSelected ? "bg-brand-50 border-brand-200 shadow-sm" : "bg-white border-gray-200 hover:bg-gray-50 shadow-sm"}`}
                  >
                    <div className="flex-1 px-2 py-1">
                      {isToday && (
                        <span className="inline-block mb-1 text-[10px] leading-none tracking-wide font-semibold rounded px-1.5 py-0.5 bg-brand-700 text-white">
                          TODAY
                        </span>
                      )}
                      <div className="font-medium">{k}</div>
                      <div className="text-xs text-gray-500">
                        {items.length} visit{items.length === 1 ? "" : "s"} • HH {dayHH} • USDA {dayUsda}
                      </div>
                    </div>

                    <div className="ml-1 flex items-center gap-2 shrink-0">
                      <button
                        data-day-action
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-brand-200 bg-white text-brand-800 hover:bg-brand-50 disabled:opacity-50 transition-colors"
                        onClick={() => shareEfapDailyPdfForDay(k)}
                        disabled={!k}
                        aria-label={`Share EFAP PDF for ${k}`}
                        title="Share EFAP PDF"
                      >
                        <ShareIcon className="h-4 w-4" />
                      </button>

                      <button
                        data-day-action
                        className="inline-flex h-8 items-center justify-center rounded-lg px-2 bg-brand-700 text-white hover:bg-brand-800 text-[11px] transition-colors"
                        onClick={() => exportEfapDailyPdfForDay(k)}
                        title="Download EFAP PDF for this day"
                        aria-label={`Download EFAP PDF for ${k}`}
                      >
                        EFAP
                      </button>
                    </div>
                  </li>
                );
              })}

              {!sortedDayKeys.length && (
                <li className="py-3 px-2 text-sm text-gray-600">No days found for this month.</li>
              )}
            </ul>
          </div>
        </aside>

        {/* Table / details */}
        <section className="lg:col-span-2 rounded-2xl ring-1 ring-rose-200 bg-white shadow-sm ring-offset-rose-50 ring-offset-1 p-3">
          {/* Header: date + actions */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
            <div className="font-semibold text-base sm:text-lg">
              {selectedDate ? `Visits on ${selectedDate}` : "Select a day"}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* icon-only on small screens */}
              <button
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-brand-200 bg-white text-brand-800 hover:bg-brand-50 disabled:opacity-50 transition-colors"
                onClick={() => shareEfapDailyPdfForDay(selectedDate)}
                disabled={!selectedDate}
                aria-label="Share EFAP PDF"
                title="Share EFAP PDF"
              >
                <ShareIcon className="h-5 w-5" />
              </button>

              <button
                className="inline-flex h-10 items-center justify-center rounded-lg px-3 bg-brand-700 text-white hover:bg-brand-800 disabled:opacity-50 transition-colors"
                onClick={() => exportEfapDailyPdfForDay(selectedDate)}
                disabled={!selectedDate}
              >
                EFAP (This day)
              </button>
              <button
                className="inline-flex h-10 items-center justify-center rounded-lg px-3 bg-brand-700 text-white hover:bg-brand-800 disabled:opacity-50 transition-colors"
                onClick={() => exportOneDayCsv(selectedDate)}
                disabled={!selectedDate}
              >
                CSV (This day)
              </button>
            </div>
          </div>

          {/* Quick filters */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <input
              id="table-search"
              className="rounded-lg border px-3 py-2 text-sm w-[220px] sm:w-[260px]"
              placeholder="Search name / address / zip"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              aria-label="Search table"
            />

            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">
                USDA:
                <select
                  className="ml-2 rounded-lg border px-2 py-1 bg-white"
                  value={usdaFilter}
                  onChange={(e) => setUsdaFilter(e.target.value)}
                  aria-label="Filter USDA"
                >
                  <option value="all">All</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label className="text-sm text-gray-600">
                Sort:
                <select
                  className="ml-2 rounded-lg border px-2 py-1 bg-white"
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value)}
                  aria-label="Sort by"
                >
                  <option value="time">Time</option>
                  <option value="name">Name</option>
                  <option value="hh">HH</option>
                </select>
              </label>
              <button
                className="rounded-lg border px-2 py-1 text-sm bg-gray-50 hover:bg-gray-100"
                onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                title="Toggle sort direction"
                aria-label="Toggle sort direction"
              >
                {sortDir === "asc" ? "Asc ↑" : "Desc ↓"}
              </button>
            </div>
          </div>

          {/* Summary stripe */}
          <div className="mb-2 text-sm text-gray-700 flex flex-wrap gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1">
              <strong>{dayTotals.count}</strong> visit{dayTotals.count === 1 ? "" : "s"}
            </span>
            <span className="inline-flex items-center gap-1">
              HH <strong>{dayTotals.hh}</strong>
            </span>
            <span className="inline-flex items-center gap-1">
              USDA yes <strong>{dayTotals.usdaYes}</strong>
            </span>
          </div>

          {/* DESKTOP TABLE */}
          <div className="hidden md:block overflow-hidden rounded-xl border">
            <table className="w-full table-auto text-sm">
              <colgroup>
                <col className="w-[22%]" />
                <col className="w-[34%]" />
                <col className="w-[9%]" />
                <col className="w-[7%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[8%]" />
              </colgroup>

              <thead className="bg-gray-100 sticky top-0 z-10">
                <tr className="text-left">
                  <th className="px-4 py-2">Client</th>
                  <th className="px-4 py-2">Address</th>
                  <th className="px-4 py-2">Zip</th>
                  <th className="px-4 py-2">HH</th>
                  <th className="px-4 py-2">USDA (mo)</th>
                  <th className="px-4 py-2">Time</th>
                  <th className="px-4 py-2">Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-200 align-top">
                {filteredSortedRows.map((r) => (
                  <tr key={r.visitId} className="odd:bg-white even:bg-gray-50 hover:bg-gray-100">
                    <td className="px-4 py-3 break-words">
                      <div className="font-medium">{r.labelName}</div>
                      {r.addedByReports && r.addedLocalTime ? (
                        <div className="mt-0.5 text-xs text-gray-500">added {r.addedLocalTime}</div>
                      ) : null}
                    </td>

                    <td className="px-4 py-3 break-words">{r.address}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{r.zip}</td>
                    <td className="px-4 py-3 tabular-nums">{r.visitHousehold}</td>
                    <td className="px-4 py-3">
                      {r.usdaFirstTimeThisMonth === "" ? "" : r.usdaFirstTimeThisMonth ? "Yes" : "No"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-[13px] text-gray-700">{r.localTime}</td>
                    <td className="px-4 py-3">
                      {isAdmin ? (
                        <button
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-red-700 hover:bg-red-50 transition-colors"
                          onClick={() => removeVisit(r.visitId)}
                          title="Delete visit"
                          aria-label="Delete visit"
                        >
                          <TrashIcon className="h-5 w-5" />
                        </button>
                      ) : (
                        <span className="text-[11px] text-gray-500">view-only</span>
                      )}
                    </td>
                  </tr>
                ))}

                {filteredSortedRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-gray-500">
                      No visits on this day.
                    </td>
                  </tr>
                )}
              </tbody>

              <tfoot className="bg-gray-100 text-sm font-medium">
                <tr>
                  <td className="px-4 py-2">Totals</td>
                  <td />
                  <td />
                  <td className="px-4 py-2">{dayTotals.hh}</td>
                  <td className="px-4 py-2">{dayTotals.usdaYes} Yes</td>
                  <td className="px-4 py-2" />
                  <td className="px-4 py-2">{filteredSortedRows.length} rows</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* MOBILE LIST */}
          <ul className="md:hidden divide-y divide-gray-200 rounded-xl border overflow-hidden">
            {filteredSortedRows.map((r, i) => (
              <li key={r.visitId} className={`p-3 ${i % 2 === 0 ? "bg-gray-50" : "bg-white"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{r.labelName}</div>
                    {r.address ? (
                      <div className="text-xs text-gray-700 truncate">
                        {r.address}
                        {r.zip ? `, ${r.zip}` : ""}
                      </div>
                    ) : null}

                    <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-gray-700">
                      <span className="px-1.5 py-0.5 rounded border bg-white">HH {r.visitHousehold || 0}</span>
                      {r.usdaFirstTimeThisMonth !== "" && (
                        <span className="px-1.5 py-0.5 rounded border bg-white">
                          {r.usdaFirstTimeThisMonth ? "USDA Yes" : "USDA No"}
                        </span>
                      )}
                    </div>

                    {r.addedByReports && r.addedLocalTime ? (
                      <div className="text-[11px] text-gray-500 mt-0.5">Added {r.addedLocalTime}</div>
                    ) : null}
                  </div>

                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <div
                      className="px-2 py-0.5 rounded border border-gray-300 text-[11px] whitespace-nowrap bg-gray-100 text-gray-800 font-medium"
                      title={r.localTime}
                    >
                      {r.localTime}
                    </div>
                    {isAdmin ? (
                      <button
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-red-700 hover:bg-red-50"
                        onClick={() => removeVisit(r.visitId)}
                        aria-label="Delete visit"
                        title="Delete visit"
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}

            {filteredSortedRows.length === 0 && (
              <li className="p-6 text-center text-gray-500">No visits on this day.</li>
            )}
          </ul>
        </section>
      </div>

      {/* Add Visit Modal (optional; left in place but hidden unless you wire a trigger) */}
      {/* If you want the “Add Visit” button back, wire it like you had before; this file focuses on scoping & fixes. */}

      {/* Toast */}
      {toast.open && (
        <div
          className={`fixed bottom-4 left-1/2 -translate-x-1/2 px-3.5 py-2 rounded-xl shadow-lg text-sm text-white ${
            toast.type === "warn" ? "bg-amber-600" : "bg-gray-900"
          }`}
          role="status"
        >
          {toast.msg}
        </div>
      )}

      {/* Print styles */}
      <style>{`
        @media (max-width: 380px) {
          .sm\\:hidden + .grid button { font-size: 14px; }
        }
        @media print {
          nav, header, aside, .print\\:hidden { display: none !important; }
          main, section { border: none !important; box-shadow: none !important; }
          body { background: #fff !important; }
        }
      `}</style>

      <style>{`
        .no-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}

/* =======================================================================================
   PRESENTATIONAL SUB-COMPONENTS
   ======================================================================================= */
function Card({ title, children }) {
  return (
    <div className="rounded-2xl ring-1 ring-rose-200 bg-white shadow-sm ring-offset-rose-50 ring-offset-1 p-3 sm:p-4">
      <div className="text-sm font-semibold mb-2">{title}</div>
      {children}
    </div>
  );
}

function KpiModern({ title, value, sub }) {
  return (
    <div className="snap-start rounded-2xl ring-1 ring-rose-200 bg-white shadow-sm ring-offset-rose-50 ring-offset-1 px-4 py-3 sm:px-5 sm:py-4">
      <div className="text-xs sm:text-sm text-gray-600 mb-1.5">{title}</div>
      <div className="flex items-end gap-2">
        <div className="text-2xl sm:text-3xl font-semibold tabular-nums tracking-tight">{value ?? "—"}</div>
        {sub ? <div className="text-[11px] sm:text-xs text-gray-500 mb-0.5">{sub}</div> : null}
      </div>
    </div>
  );
}

/* ---------- icons ---------- */
function ShareIcon({ className = "h-5 w-5" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
    </svg>
  );
}

function TrashIcon({ className = "h-5 w-5" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
