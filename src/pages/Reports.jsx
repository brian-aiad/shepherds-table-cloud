// src/pages/Reports.jsx
import {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  useLayoutEffect,
} from "react";
import { useLocation as useRouteLocation } from "react-router-dom";
import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  doc,
  deleteDoc,
  startAt,
  endAt,
} from "firebase/firestore";

// 🔐 project paths
import { db } from "../lib/firebase";
// NOTE: useAuth is a DEFAULT export in your app
import useAuth from "../auth/useAuth";
import AddVisitButton from "../components/AddVisitButton";

// EFAP / USDA builders (fixed names)
import {
  buildEfapDailyPdf,
  efapSuggestedFileName,
} from "../utils/buildEfapDailyPdf";
import { downloadEfapMonthlyPdf } from "../utils/buildEfapMonthlyPdf";

// Recharts (charts & responsive container)
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

/* ---------- date helpers ---------- */
const fmtDateKey = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const monthKeyFor = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const dateFromMonthKey = (mk) => {
  const [y, m] = mk.split("-").map(Number);
  return new Date(y, m - 1, 1);
};
const monthLabel = (mk) =>
  dateFromMonthKey(mk).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

const toJSDate = (ts) => (ts?.toDate ? ts.toDate() : new Date(ts));
const toISO = (d) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

const chunk = (arr, size = 10) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const todayKey = fmtDateKey(new Date());

/* ---------- tiny toast ---------- */
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

/* ---------- download & share helpers ---------- */
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
        : new File([fileOrBlob], filename, {
            type: fileOrBlob.type || "application/octet-stream",
          });

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

/* ---------- CSV builders ---------- */
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

/* ---------- USDA units helper ---------- */
const usdaUnitsOf = (v) =>
  Number.isFinite(v?.usdaCount)
    ? Number(v.usdaCount)
    : v?.usdaFirstTimeThisMonth
    ? 1
    : 0;

/* ---------- simple month aggregator (for EFAP monthly builder) ---------- */
function aggregateMonthForPdf(visits) {
  const byDay = new Map();
  const firsts = new Map();
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
      if (!cur || v.dateKey < cur.dateKey)
        firsts.set(v.clientId, { dateKey: v.dateKey, persons });
    }
  }

  const undHH = firsts.size;
  const undPP = Array.from(firsts.values()).reduce(
    (s, x) => s + x.persons,
    0
  );

  return {
    byDay,
    monthTotals: { households: hh, persons: pp },
    unduplicated: { households: undHH, persons: undPP },
  };
}

/* ---------- Lightweight Monthly PDF for share-all action ---------- */
async function buildUsdaMonthlyPdf({ monthKey, visits, org, generatedBy }) {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");

  const rowsMap = new Map();
  for (const v of visits || []) {
    const dk = v.dateKey || fmtDateKey(toJSDate(v.visitAt));
    if (!rowsMap.has(dk)) rowsMap.set(dk, []);
    rowsMap.get(dk).push(v);
  }
  const dayKeys = Array.from(rowsMap.keys()).sort();

  const totalUsda = (visits || []).reduce((s, v) => s + usdaUnitsOf(v), 0);
  const totalHH = (visits || []).reduce(
    (s, v) => s + Number(v.householdSize || 0),
    0
  );
  const avgPerDay = dayKeys.length
    ? Math.round((totalUsda / dayKeys.length) * 10) / 10
    : 0;

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
  page.drawLine({
    start: { x: 40, y },
    end: { x: pageWidth - 40, y },
    thickness: 1,
  });
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
      for (const c of columns)
        page.drawText(c.label, { x, y, size: 10, font: fontBold });
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
  const pdfBytes = await buildUsdaMonthlyPdf({
    monthKey,
    visits,
    org,
    generatedBy,
  });
  const csvRows = (visits || []).map((v) => ({
    dateKey: v.dateKey || fmtDateKey(toJSDate(v.visitAt)),
    monthKey: v.monthKey || monthKey,
    clientId: v.clientId || "",
    householdSize: v.householdSize ?? "",
    usdaFirstTimeThisMonth: v.usdaFirstTimeThisMonth ?? "",
    usdaCount: v.usdaCount ?? "",
  }));
  const csv = buildUsdaMonthlyCsv({ rows: csvRows });

  const pdfFile = new File([pdfBytes], `USDA_Monthly_${monthKey}.pdf`, {
    type: "application/pdf",
  });
  const csvFile = new File([csv], `USDA_Monthly_${monthKey}.csv`, {
    type: "text/csv;charset=utf-8",
  });

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
/* ---------- Month navigator (refined professional capsule w/ black outline) ---------- */
function ReportsMonthNav({ monthKey, setMonthKey, setSelectedDate }) {
  const [open, setOpen] = useState(false);
  const [yearView, setYearView] = useState(() => Number(monthKey.slice(0, 4)));
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

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      const pop = document.querySelector('[role="dialog"][aria-label="Select month and year"]');
      const trigger = e.target.closest?.('[aria-haspopup="dialog"]');
      if (pop && !pop.contains(e.target) && !trigger) setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);

  const commit = useCallback(
    (y, mIndex0) => {
      const d = new Date(y, mIndex0, 1);
      const mk = monthKeyFor(d);
      setMonthKey(mk);
      setSelectedDate(fmtDateKey(d));
      setYearView(y);
      setOpen(false);
    },
    [setMonthKey, setSelectedDate]
  );

const MonthCell = ({ mIndex0 }) => {
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const isCurrent =
    Number(monthKey.slice(0, 4)) === yearView &&
    Number(monthKey.slice(5, 7)) === mIndex0 + 1;

  return (
    <button
      onClick={() => commit(yearView, mIndex0)}
      className={
        "px-2.5 py-1.5 rounded-lg text-sm font-semibold transition " +
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 " +
        (isCurrent
          ? "bg-brand-700 text-white"
          : "bg-white text-brand-700 border border-brand-200 hover:bg-brand-50/60")
      }
    >
      {names[mIndex0]}
    </button>
  );
};


  const baseBtn =
    "inline-flex items-center justify-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-black/50";
  const size = "h-10 w-10 md:h-11 md:w-11";

  return (
    <div className="relative z-50">
      {/* unified capsule with black outline */}
      <div
        className="
          inline-flex items-center gap-0
          rounded-2xl bg-white
          border border-gray-300 ring-1 ring-gray-200
          shadow-[0_6px_16px_-6px_rgba(0,0,0,0.15)]
          px-1.5 py-1
        "
      >
        {/* Prev */}
        <button
          onClick={() => jump(-1)}
          className={`${baseBtn} ${size} rounded-xl hover:bg-gray-50 active:bg-gray-100 text-gray-900`}          aria-label="Previous month"
          title="Previous month"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" fill="none" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" strokeWidth="2" />
          </svg>
        </button>

        {/* divider */}
        <span className="mx-1 h-7 md:h-8 w-px bg-black/10" aria-hidden="true" />

        {/* Month button */}
        <div className="relative z-50">
          <button
            onClick={() => {
              setYearView(Number(monthKey.slice(0, 4)));
              setOpen((v) => !v);
            }}
            className="
              inline-flex items-center justify-center gap-2
              rounded-full px-4 md:px-5
              h-10 md:h-11
              text-gray-900 font-semibold tracking-tight              hover:bg-gray-50 active:bg-gray-100
              focus:outline-none focus-visible:ring-2 focus-visible:ring-black/50
            "
            aria-haspopup="dialog"
            aria-expanded={open}
            title="Jump to a specific month/year"
          >
            <span className="text-[15px] md:text-[16px]">{label}</span>
            <svg className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" stroke="currentColor" fill="none">
              <path d="M6 9l6 6 6-6" strokeWidth="2" />
            </svg>
          </button>

          {/* Popover */}
          {open && (
            <div
              className="
                absolute left-1/2 top-full z-[80] mt-2 w-[320px] -translate-x-1/2
                rounded-2xl border border-black/20 bg-white shadow-xl p-3
              "
              role="dialog"
              aria-label="Select month and year"
            >
              {/* Year header */}
              <div className="flex items-center justify-between mb-2">
                <button
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-black/20 bg-white hover:bg-gray-50"
                  onClick={() => setYearView((y) => y - 1)}
                  aria-label="Previous year"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" fill="none">
                    <path d="M15 6l-6 6 6 6" strokeWidth="2" />
                  </svg>
                </button>

                <div className="font-semibold">{yearView}</div>

                <button
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-black/20 bg-white hover:bg-gray-50"
                  onClick={() => setYearView((y) => y + 1)}
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

              {/* Native month input */}
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="month"
                  className="w-full rounded-lg border border-black/20 px-2 py-2 text-sm"
                  value={`${String(yearView)}-${String(Number(monthKey.slice(5,7))).padStart(2, "0")}`}
                  onChange={(e) => {
                    const [y, m] = e.target.value.split("-").map(Number);
                    if (!y || !m) return;
                    commit(y, m - 1);
                  }}
                  aria-label="Pick month and year"
                />
                <button
                  className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm hover:bg-gray-50"
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
          className={`${baseBtn} ${size} rounded-xl hover:bg-gray-50 active:bg-gray-100 text-gray-900`}          aria-label="Next month"
          title="Next month"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" fill="none" aria-hidden="true">
            <path d="M9 6l6 6-6 6" strokeWidth="2" />
          </svg>
        </button>

        {/* divider */}
        <span className="mx-1 h-7 md:h-8 w-px bg-black/10 hidden md:block" aria-hidden="true" />

        {/* Today (md+) */}
        <button
          onClick={goToday}
          className="hidden md:inline-flex items-center justify-center rounded-full px-3 h-10 md:h-11 text-gray-900 hover:bg-gray-50 active:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/50"
          title="Jump to current month (T)"
        >
          Today
        </button>
      </div>
    </div>
  );
}




/* =======================================================================================
   PAGE COMPONENT
   ======================================================================================= */
export default function Reports() {
  const routeLocation = useRouteLocation();
  const { loading: authLoading, org, orgSettings, location, isAdmin, email } =
  useAuth() || {};


  // UI/state
  const [exportingPdf, setExportingPdf] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedMonthKey, setSelectedMonthKey] = useState(monthKeyFor(new Date()));
  const [selectedDate, setSelectedDate] = useState(fmtDateKey(new Date()));
  const [visits, setVisits] = useState([]);
  const [clientsById, setClientsById] = useState(new Map());

  // live-ish status
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

  // UI state
  const dayListRef = useRef(null);
  const [dayFilter, setDayFilter] = useState("");
  const [term, setTerm] = useState("");
  const [usdaFilter, setUsdaFilter] = useState("all"); // all|yes|no
  const [sortKey, setSortKey] = useState("time"); // time|name|hh
  const [sortDir, setSortDir] = useState("desc"); // asc|desc

  // menu state (split-button + kebab)
  const [menuOpen, setMenuOpen] = useState(false);
  const [kebabOpen, setKebabOpen] = useState(false);
  const menuRef = useRef(null);
  const kebabRef = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
      if (kebabRef.current && !kebabRef.current.contains(e.target)) setKebabOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const toast = useToast();

  // Disable native scroll restoration while Reports is mounted
  useLayoutEffect(() => {
    if ("scrollRestoration" in window.history) {
      const prev = window.history.scrollRestoration;
      window.history.scrollRestoration = "manual";
      return () => {
        window.history.scrollRestoration = prev;
      };
    }
  }, []);

  // Force the page to the very top immediately on navigation to Reports
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;
  }, [routeLocation.pathname, routeLocation.search, routeLocation.hash]);

  // Jump from other screens with state.jumpToDate (YYYY-MM-DD)
  useEffect(() => {
    const jt = routeLocation.state && routeLocation.state.jumpToDate;
    if (!jt) return;
    const [y, m] = jt.split("-").map(Number);
    const mk = `${y}-${String(m).padStart(2, "0")}`;
    setSelectedMonthKey(mk);
    setSelectedDate(jt);
    window.history.replaceState({}, document.title);
  }, [routeLocation.state]);

  /* --------------------------------
     Scoped live query: visits for month (RANGE BY dateKey)
     -------------------------------- */
  useEffect(() => {
    if (authLoading) return;
    if (!org?.id) {
      setVisits([]);
      return;
    }

    setLoading(true);
    setError("");
    let off;

    // Compute month range on dateKey (YYYY-MM-DD)
    const d = dateFromMonthKey(selectedMonthKey);
    const startKey = fmtDateKey(new Date(d.getFullYear(), d.getMonth(), 1));
    const endKey = fmtDateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0)); // last day of month

    const filters = [where("orgId", "==", org.id)];
    const effectiveLocationId = location?.id || null;
    if (effectiveLocationId) filters.push(where("locationId", "==", effectiveLocationId));

    const qv = query(
      collection(db, "visits"),
      ...filters,
      orderBy("dateKey", "asc"),
      startAt(startKey),
      endAt(endKey)
    );

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
            } catch (err) {
              setError(extractIndexHelp(err) || "Failed to load visits for this month.");
            } finally {
              setLoading(false);
              setLastSyncedAt(new Date());
            }
          }
        );
      } catch (e) {
        console.error(e);
        setError(extractIndexHelp(e) || "Failed to load visits for this month.");
        setLoading(false);
      }
    })();

    return () => (off ? off() : undefined);
  }, [authLoading, org?.id, location?.id, selectedMonthKey, isAdmin]);

  /* --------------------------------
     Hydrate client docs in small batches (by id)
     -------------------------------- */
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

  /* --------------------------------
     Group visits by day (within month)
     -------------------------------- */
  const visitsByDay = useMemo(() => {
    const m = new Map();
    for (const v of visits) {
      const k = v.dateKey || fmtDateKey(toJSDate(v.visitAt));
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(v);
    }
    for (const arr of m.values())
      arr.sort((a, b) => toJSDate(b.visitAt) - toJSDate(a.visitAt));
    return m;
  }, [visits]);

  const sortedDayKeys = useMemo(
    () =>
      Array.from(visitsByDay.keys())
        .filter((k) => (dayFilter ? k.includes(dayFilter) : true))
        .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)),
    [visitsByDay, dayFilter]
  );

  /* --------------------------------
     Keep day selection valid & scroll-into-view
     -------------------------------- */
  useEffect(() => {
    if (!sortedDayKeys.length) return;
    const fallback = sortedDayKeys[0];
    if (!selectedDate || !visitsByDay.has(selectedDate)) setSelectedDate(fallback);

    const id = `day-${selectedDate || fallback}`;
    requestAnimationFrame(() => {
      const list = dayListRef.current;
      if (!list) return;
      const el = list.querySelector(`#${CSS.escape(id)}`);
      if (!el) return;
      const padding = 8;
      const elTop = el.offsetTop - list.offsetTop;
      list.scrollTo({ top: Math.max(0, elTop - padding), behavior: "auto" });
    });
  }, [sortedDayKeys, selectedDate, visitsByDay]);

  /* --------------------------------
     Rows for selected day
     -------------------------------- */
  const rowsForSelectedDay = useMemo(() => {
    const src = visitsByDay.get(selectedDate) || [];
    return src.map((v) => {
      const d = toJSDate(v.visitAt);
      const person = clientsById.get(v.clientId) || {};
      const labelName =
        `${person.firstName || v.clientFirstName || ""} ${person.lastName || v.clientLastName || ""}`.trim() ||
        v.clientId;

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

  /* --------------------------------
     Filters & sort
     -------------------------------- */
  const filteredSortedRows = useMemo(() => {
    let rows = rowsForSelectedDay;

    if (usdaFilter !== "all") {
      rows = rows.filter((r) =>
        usdaFilter === "yes"
          ? r.usdaFirstTimeThisMonth === true
          : r.usdaFirstTimeThisMonth === false
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

  /* --------------------------------
     Day totals
     -------------------------------- */
  const dayTotals = useMemo(() => {
    const count = filteredSortedRows.length;
    const hh = filteredSortedRows.reduce((s, r) => s + Number(r.visitHousehold || 0), 0);
    const usdaYes = filteredSortedRows.reduce((s, r) => s + (r.usdaFirstTimeThisMonth === true ? 1 : 0), 0);
    return { count, hh, usdaYes };
  }, [filteredSortedRows]);

  /* --------------------------------
     Month aggregates (KPI + charts)
     -------------------------------- */
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

  /* --------------------------------
     Actions
     -------------------------------- */
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
    [isAdmin, toast]
  );

  const exportOneDayCsv = useCallback(
    (dayKey) => {
      const src = visitsByDay.get(dayKey) || [];
      const rows = src.map((v) => {
        const d = toJSDate(v.visitAt);
        const p = clientsById.get(v.clientId) || {};
        const address =
          p.address || p.addr || p.street || p.street1 || p.line1 || p.address1 || "";
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
    [visitsByDay, clientsById, toast]
  );

 const buildEfapBytesForDay = useCallback(
  (dayKey) => {
    const src = visitsByDay.get(dayKey) || [];

    const rows = src.map((v) => {
      const p = clientsById.get(v.clientId) || {};

      // --- Name: match the table’s fallback behavior (NO clientId fallback) ---
      const first =
        p.firstName ??
        v.clientFirstName ??
        (typeof p.name === "string" ? p.name.split(" ")[0] : "") ??
        "";
      const last =
        p.lastName ??
        v.clientLastName ??
        (typeof p.name === "string" ? p.name.split(" ").slice(1).join(" ") : "") ??
        "";
      const name = `${first} ${last}`.trim() ||
        (typeof v.clientName === "string" ? v.clientName : ""); // final human fallback

      // --- Address / Zip fallbacks (unchanged, but include visit-level zip just in case) ---
      const address =
        p.address ||
        p.addr ||
        p.street ||
        p.street1 ||
        p.line1 ||
        p.address1 ||
        "";
      const zip = p.zip || v.clientZip || "";

      return {
        name,
        address,
        zip,
        householdSize: Number(v.householdSize || 0),
        firstTime:
          v.usdaFirstTimeThisMonth === true
            ? true
            : v.usdaFirstTimeThisMonth === false
            ? false
            : "",
      };
    });

    // Pass org branding so Food Bank Name fills correctly
    return buildEfapDailyPdf(rows, {
      dateStamp: dayKey,
      orgSettings,
      orgName: org?.name,
      org,
    });
  },
  [visitsByDay, clientsById, org, orgSettings]
);



  const exportEfapDailyPdfForDay = useCallback(
    async (dayKey) => {
      try {
        const pdfBytes = await buildEfapBytesForDay(dayKey);
        const site = (orgSettings?.brandText || org?.name || "ShepherdsTable").replace(/\s+/g, "_");
        const fileName = efapSuggestedFileName(dayKey, site);

        downloadBytes(pdfBytes, fileName, "application/pdf");
        toast.show("EFAP PDF downloaded.", "info");
      } catch (e) {
        console.error("EFAP build/download failed:", e);
        alert("Couldn’t build the EFAP PDF for that day.");
      }
    },
    [buildEfapBytesForDay, toast]
  );

  const shareEfapDailyPdfForDay = useCallback(
    async (dayKey) => {
      try {
        const pdfBytes = await buildEfapBytesForDay(dayKey);
        const site = (orgSettings?.brandText || org?.name || "ShepherdsTable").replace(/\s+/g, "_");
        const fileName = efapSuggestedFileName(dayKey, site);

        const file = new File([toUint8Array(pdfBytes)], fileName, {
          type: "application/pdf",
        });
        await shareFileFallback(file, file.name);
        toast.show("EFAP PDF ready to share.", "info");
      } catch (e) {
        console.error("EFAP share (day) failed:", e);
        alert("Couldn’t share the EFAP PDF for that day.");
      }
    },
    [buildEfapBytesForDay, toast]
  );

  /* ---------- Export USDA Monthly (dedicated builder) ---------- */
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

      await downloadEfapMonthlyPdf(
        {
          year,
          monthIndex0,
          byDayMap: agg.byDay,
          monthTotals: agg.monthTotals,
          unduplicated: agg.unduplicated,
          header: {
            agency: org?.name || "Your Organization",
            acct: "—",
            phone: "—",
            contact: email || "—",
            address: "—",
          },
        },
        `EFAP_Monthly_${monthLabelStr}.pdf`
      );
    } finally {
      setExportingPdf(false);
    }
  }, [selectedMonthKey, visits, org?.name, email]);

  /* =======================================================================================
     RENDER
     ======================================================================================= */

  // Scope chip
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
          <span className="text-gray-400">/</span>
          <span className="text-gray-700">{location.name}</span>
        </>
      ) : (
        <span className="text-gray-600">(all locations)</span>
      )}
    </span>
  );

  // Sync chip
  const syncChip = (
    <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200 px-2.5 py-1 text-[12px]">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Synced {syncAgo || "—"}
    </span>
  );

  // Accessible aria-sort helper for table headers
  const ariaSortFor = (key) => (sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none");

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-2 sm:pt-3 max-w-7xl mx-auto overflow-visible">
     {/* ===== THEMED TOOLBAR ===== */}
<div className="rounded-3xl overflow-visible shadow-sm ring-1 ring-black/5 relative">
  {/* Brand gradient header (pill sits on the seam) */}
  <div className="rounded-t-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 p-3 sm:p-4 relative pb-10 shadow-[inset_0_-1px_0_rgba(255,255,255,0.25)]">
    <div className="flex flex-wrap items-center justify-center md:justify-between gap-2">
      <h1 className="text-white text-xl sm:text-2xl font-semibold tracking-tight text-center md:text-left">
        Reports
      </h1>
      <div className="hidden md:flex items-center gap-2">{syncChip}</div>
    </div>
    <div className="mt-2 md:mt-3 flex flex-wrap items-center justify-center md:justify-start gap-2">
      {scopeChip}
    </div>

    {/* Month nav floats between header and controls */}
    <div className="absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 z-10">
      <ReportsMonthNav
        monthKey={selectedMonthKey}
        setMonthKey={setSelectedMonthKey}
        setSelectedDate={setSelectedDate}
      />
    </div>
  </div>

  {/* Controls surface – just reserves space under the pill */}
  <div className="rounded-b-3xl bg-white/95 backdrop-blur px-3 sm:px-5 pt-8 pb-3" />
</div>


      {/* ===== KPI Row (wording tightened) ===== */}
      <div className="mt-4">
        <div className="-mx-4 sm:mx-0">
          <div className="overflow-x-auto overflow-y-visible md:overflow-visible no-scrollbar px-4 py-1">
            <div
              className="
                grid grid-flow-col
                auto-cols-[85%] xs:auto-cols-[60%] sm:auto-cols-[minmax(0,1fr)]
                md:grid-flow-row md:grid-cols-4
                gap-3 sm:gap-4 md:gap-5
                snap-x md:snap-none
                pr-2
              "
            >
              <div className="snap-start md:snap-none flex-none">
                <KpiModern title="Total Visits (Month)" value={visits.length} />
              </div>
              <div className="snap-start md:snap-none flex-none">
                <KpiModern title="Households (Month)" value={monthAgg.households} />
              </div>
              <div className="snap-start md:snap-none flex-none">
                <KpiModern title="USDA First-Time (Month)" value={monthAgg.charts?.usdaPie?.[0]?.value ?? 0} />
              </div>
              <div className="snap-start md:snap-none flex-none">
                <KpiModern title="Active Service Days (Month)" value={Array.from(monthAgg.byDay.keys()).length} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 lg:mt-10" />

      {/* ===== Charts (titles tightened) ===== */}
      <div className="grid gap-4 sm:gap-5 lg:gap-6 md:grid-cols-3 mb-6 sm:mb-8">
        {/* Visits per Day */}
        <Card title="Visits per Day">
          <div className="h-[260px] flex items-center justify-center px-3 sm:px-4">
            <ResponsiveContainer width="98%" height="95%">
              <LineChart data={monthAgg.charts.visitsPerDay} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="lineGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#991b1b" stopOpacity={1} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0.4} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  axisLine={{ stroke: "#e5e7eb" }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  axisLine={{ stroke: "#e5e7eb" }}
                  tickLine={false}
                  width={30}
                />
                <Tooltip contentStyle={tooltipBoxStyle} cursor={{ stroke: "#ef4444", opacity: 0.25 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="monotone"
                  dataKey="visits"
                  stroke="url(#lineGradient)"
                  strokeWidth={3}
                  dot={false}
                  activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2, fill: "#991b1b" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* USDA Yes vs No */}
        <Card title="USDA Yes vs No">
          <div className="h-[260px] flex items-center justify-center px-3 sm:px-4">
            <ResponsiveContainer width="96%" height="96%">
              <PieChart margin={{ top: 0, bottom: 0 }}>
                <Pie
                  data={monthAgg.charts.usdaPie}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="55%"
                  outerRadius="78%"
                  paddingAngle={2}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {monthAgg.charts.usdaPie.map((_, i) => (
                    <Cell key={i} fill={i === 0 ? "#991b1b" : "#fecaca"} stroke="#fff" strokeWidth={1.5} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipBoxStyle} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* People Served per Day */}
        <Card title="People Served per Day">
          <div className="h-[260px] flex items-center justify-center px-3 sm:px-4">
            <ResponsiveContainer width="98%" height="95%">
              <BarChart data={monthAgg.charts.visitsPerDay} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={10}>
                <defs>
                  <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#991b1b" stopOpacity={1} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0.7} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  axisLine={{ stroke: "#e5e7eb" }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  axisLine={{ stroke: "#e5e7eb" }}
                  tickLine={false}
                  width={30}
                />
                <Tooltip cursor={false} contentStyle={tooltipBoxStyle} />
                <Bar dataKey="people" fill="url(#barGradient)" radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* ===== Layout: days list + table ===== */}
      <div className="mt-6 sm:mt-8 grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 print:block">
        {/* Days list */}
        <aside className="rounded-2xl border border-brand-200 ring-1 ring-brand-100 bg-white shadow-sm p-3 print:hidden lg:col-span-1">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <div className="font-semibold">Days in {monthLabel(selectedMonthKey)}</div>
            <input
              className="rounded-lg border px-2 py-1 text-sm w-[160px] sm:w-[170px]"
              placeholder="Filter (YYYY-MM-DD)"
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
                    className={`group cursor-pointer flex items-stretch gap-2 p-2 rounded-xl border transition ${
                      isSelected
                        ? "bg-brand-50 border-brand-200 shadow-sm"
                        : "bg-white border-gray-200 hover:bg-gray-50 shadow-sm"
                    }`}
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

                    {/* Quick action: tiny Share only (no heavy Download here) */}
                    <div className="ml-1 flex items-center gap-2 shrink-0">
                      <button
                        data-day-action
                        className={BTN.smallIcon}
                        onClick={() => shareEfapDailyPdfForDay(k)}
                        disabled={!k}
                        aria-label={`Share EFAP PDF for ${k}`}
                        title="Share EFAP PDF"
                      >
                        <ShareIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                );
              })}

              {!sortedDayKeys.length && (
                <li className="py-6 px-2 text-sm text-gray-600 text-center">
                  {loading ? "Loading…" : "No days found for this month."}
                </li>
              )}
            </ul>
          </div>
        </aside>

        {/* Table / details */}
        <section className="lg:col-span-2 rounded-2xl border border-brand-200 ring-1 ring-brand-100 bg-white shadow-sm p-3">
          {/* Header: date + actions (ONE primary + split menu) */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
            <div className="font-semibold text-base sm:text-lg">
              {selectedDate ? `Visits on ${selectedDate}` : "Select a day"}
            </div>

            {/* Button group: [ EFAP PDF ] [ ▼ menu ]  */}
            <div className="flex items-center gap-1.5">
              <button
                className={BTN.primary + " min-w-[110px] aria-[busy=true]:opacity-60"}
                onClick={() => exportEfapDailyPdfForDay(selectedDate)}
                disabled={!selectedDate}
                title="Download EFAP PDF for this day"
                aria-label="EFAP PDF"
                aria-busy={false}
              >
                <span>EFAP PDF</span>
              </button>

              {/* Split menu for Share + CSV (desktop) */}
              <div className="relative hidden sm:block" ref={menuRef}>
                <button
                  className={BTN.secondary + " px-2.5"}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label="Export options"
                  title="More options"
                  onClick={() => setMenuOpen((v) => !v)}
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                {menuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 z-20 mt-2 w-44 rounded-xl border border-gray-200 bg-white shadow-lg p-1"
                  >
                    <button
                      role="menuitem"
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 flex items-center gap-2"
                      onClick={() => {
                        setMenuOpen(false);
                        shareEfapDailyPdfForDay(selectedDate);
                      }}
                      disabled={!selectedDate}
                      aria-label="Share EFAP"
                    >
                      <ShareIcon className="h-4 w-4" />
                      <span>Share EFAP</span>
                    </button>
                    <button
                      role="menuitem"
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 flex items-center gap-2"
                      onClick={() => {
                        setMenuOpen(false);
                        exportOneDayCsv(selectedDate);
                      }}
                      disabled={!selectedDate}
                      aria-label="Export CSV"
                    >
                      <DownloadIcon className="h-4 w-4" />
                      <span>Export CSV</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Mobile: kebab opens Share + CSV, and Add Visit nearby */}
              <div className="relative sm:hidden" ref={kebabRef}>
                <button
                  className={BTN.icon}
                  aria-haspopup="menu"
                  aria-expanded={kebabOpen}
                  aria-label="More actions"
                  title="More actions"
                  onClick={() => setKebabOpen((v) => !v)}
                >
                  <KebabIcon className="h-5 w-5" />
                </button>
                {kebabOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 z-20 mt-2 w-44 rounded-xl border border-gray-200 bg-white shadow-lg p-1"
                  >
                    <button
                      role="menuitem"
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 flex items-center gap-2"
                      onClick={() => {
                        setKebabOpen(false);
                        shareEfapDailyPdfForDay(selectedDate);
                      }}
                      disabled={!selectedDate}
                      aria-label="Share EFAP"
                    >
                      <ShareIcon className="h-4 w-4" />
                      <span>Share EFAP</span>
                    </button>
                    <button
                      role="menuitem"
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 flex items-center gap-2"
                      onClick={() => {
                        setKebabOpen(false);
                        exportOneDayCsv(selectedDate);
                      }}
                      disabled={!selectedDate}
                      aria-label="Export CSV"
                    >
                      <DownloadIcon className="h-4 w-4" />
                      <span>Export CSV</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Add Visit next to EFAP on mobile as ghost/secondary */}
              {selectedDate && isAdmin && (
                <div className="sm:hidden">
                  <AddVisitButton
                    org={org}
                    location={location}
                    selectedDate={selectedDate}
                    onAdded={(newVisit) => setVisits((prev) => [newVisit, ...prev])}
                    className={BTN.secondary + " !h-10"}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Subheading separator above filters (visual polish) */}
          <div className="border-t border-gray-200 pt-3 mb-3">
            {/* Filters, compressed: search + two selects + single sort toggle */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[180px]">
                <div className="relative">
                  <input
                    id="table-search"
                    className="w-full rounded-lg border pl-9 pr-3 py-2 text-sm"
                    placeholder="Search…"
                    value={term}
                    onChange={(e) => setTerm(e.target.value)}
                    aria-label="Search"
                  />
                  <div className="absolute inset-y-0 left-2 flex items-center pointer-events-none">
                    <SearchIcon className="h-4 w-4 text-gray-500" />
                  </div>
                </div>
              </div>

              <select
                className="rounded-lg border px-2 py-2 text-sm bg-white"
                value={usdaFilter}
                onChange={(e) => setUsdaFilter(e.target.value)}
                aria-label="USDA filter"
              >
                <option value="all">USDA</option>
                <option value="yes">USDA Yes</option>
                <option value="no">USDA No</option>
              </select>

              <select
                className="rounded-lg border px-2 py-2 text-sm bg-white"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
                aria-label="Sort column"
              >
                <option value="time">Sort</option>
                <option value="time">Time</option>
                <option value="name">Name</option>
                <option value="hh">HH</option>
              </select>

              <button
                className={BTN.secondary + " px-2 py-2"}
                onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                title="Toggle sort direction"
                aria-label="Toggle sort direction"
              >
                {sortDir === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
              </button>

              {/* Desktop Add Visit sits with filters, mobile version is above */}
              {selectedDate && isAdmin && (
                <div className="hidden sm:block">
                  <AddVisitButton
                    org={org}
                    location={location}
                    selectedDate={selectedDate}
                    onAdded={(newVisit) => setVisits((prev) => [newVisit, ...prev])}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Summary stripe */}
          <div className="mb-2 text-sm text-gray-700 flex flex-wrap gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1">
              <strong>{dayTotals.count}</strong> visit{dayTotals.count === 1 ? "" : "s"}
            </span>
            <span className="inline-flex items-center gap-1">HH <strong className="tabular-nums">{dayTotals.hh}</strong></span>
            <span className="inline-flex items-center gap-1">
              USDA first-time <strong className="tabular-nums">{dayTotals.usdaYes}</strong>
            </span>
          </div>

          {/* DESKTOP TABLE */}
          <div className={`hidden md:block overflow-hidden rounded-xl border ${loading ? "opacity-60" : ""}`}>
            <table className="w-full table-auto text-sm">
              <colgroup>
                <col className="w-[22%]" />
                <col className="w-[34%]" />
                <col className="w-[9%]" />
                <col className="w-[7%]" />
                <col className="w-[13%]" />
                <col className="w-[7%]" />
                <col className="w-[8%]" />
              </colgroup>

              <thead className="bg-gray-100">
                <tr className="text-left">
                  <th className="px-4 py-2" aria-sort={ariaSortFor("name")}>Client</th>
                  <th className="px-4 py-2">Address</th>
                  <th className="px-4 py-2">Zip</th>
                  <th className="px-4 py-2">HH</th>
                  <th className="px-4 py-2">USDA First-Time</th>
                  <th className="px-4 py-2 text-right">Time</th>
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
                      {r.usdaFirstTimeThisMonth === "" ? (
                        ""
                      ) : (
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] ring-1 ${
                            r.usdaFirstTimeThisMonth
                              ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                              : "bg-gray-50 text-gray-700 ring-gray-200"
                          }`}
                        >
                          {r.usdaFirstTimeThisMonth ? "Yes" : "No"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-[13px] text-gray-700 text-right tabular-nums">
                      {r.localTime}
                    </td>
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
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      {loading ? (
                        <span className="inline-flex items-center gap-2">
                          <Spinner className="h-4 w-4" /> Loading…
                        </span>
                      ) : (
                        <div className="flex flex-col items-center gap-2">
                          <div className="text-2xl">🗓️</div>
                          <div>No visits on this day.</div>
                          {isAdmin && selectedDate ? (
                            <div className="mt-1">
                              <AddVisitButton
                                org={org}
                                location={location}
                                selectedDate={selectedDate}
                                onAdded={(newVisit) => setVisits((prev) => [newVisit, ...prev])}
                              />
                            </div>
                          ) : null}
                        </div>
                      )}
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
          <ul className={`md:hidden divide-y divide-gray-200 rounded-xl border overflow-hidden ${loading ? "opacity-60" : ""}`}>
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
                      className="px-2 py-0.5 rounded border border-gray-300 text-[11px] whitespace-nowrap bg-gray-100 text-gray-800 font-medium tabular-nums"
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
              <li className="p-6 text-center text-gray-500">
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner className="h-4 w-4" /> Loading…
                  </span>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <div className="text-2xl">🗓️</div>
                    <div>No visits on this day.</div>
                    {isAdmin && selectedDate ? (
                      <div className="mt-1">
                        <AddVisitButton
                          org={org}
                          location={location}
                          selectedDate={selectedDate}
                          onAdded={(newVisit) => setVisits((prev) => [newVisit, ...prev])}
                        />
                      </div>
                    ) : null}
                  </div>
                )}
              </li>
            )}
          </ul>
        </section>
      </div>

      {/* Error helper (index enable hint if present) */}
      {!!error && <div className="mt-4 p-3 rounded-xl bg-amber-50 text-amber-900 text-sm">{error}</div>}

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

      {/* Print & small helpers */}
      <style>{`
        @keyframes bounce-slow { 0%,100%{ transform: translateY(0) } 50%{ transform: translateY(2px) } }
        .animate-bounce-slow { animation: bounce-slow 1.6s infinite; }
      `}</style>

      <style>{`
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

const tooltipBoxStyle = {
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
  padding: "8px 12px",
};

// Unified button styles
const BTN = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-xl " +
    "bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 " +
    "px-3.5 py-2.5 text-white font-semibold shadow " +
    "hover:from-brand-800 hover:via-brand-700 hover:to-brand-600 " +
    "active:from-brand-900 active:via-brand-800 active:to-brand-700 " +
    "focus:outline-none focus:ring-2 focus:ring-brand-300 transition",

  secondary:
    "inline-flex items-center justify-center gap-2 rounded-xl border border-brand-200 " +
    "bg-white px-3.5 py-2.5 text-brand-900 shadow-sm " +
    "hover:bg-brand-50 active:bg-brand-100 " +
    "focus:outline-none focus:ring-2 focus:ring-brand-300 transition",

  icon:
    "inline-flex h-10 w-10 items-center justify-center rounded-xl border border-brand-200 " +
    "bg-white text-brand-900 hover:bg-brand-50 active:bg-brand-100 transition",

  smallIcon:
    "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-brand-200 " +
    "bg-white text-brand-900 hover:bg-brand-50 active:bg-brand-100 transition",
};

function Card({ title, children }) {
  return (
    <div className="rounded-2xl border border-brand-200 ring-1 ring-brand-100 bg-white shadow-sm p-3 sm:p-4">
      <div className="text-sm font-semibold mb-2">{title}</div>
      {children}
    </div>
  );
}

function KpiModern({ title, value, sub }) {
  return (
    <div className="rounded-2xl border border-rose-200 ring-1 ring-rose-100 bg-white shadow-sm p-4 sm:p-5">
      <div className="text-xs sm:text-sm text-gray-600 mb-2">{title}</div>
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
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
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
      aria-hidden="true"
    >
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
function SearchIcon({ className = "h-4 w-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}
function Spinner({ className = "h-4 w-4" }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity="0.2" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" fill="none" />
    </svg>
  );
}
function DownloadIcon({ className = "h-4 w-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}
function ChevronDown({ className = "h-4 w-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
function KebabIcon({ className = "h-5 w-5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}
function ArrowUp({ className = "h-4 w-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  );
}
function ArrowDown({ className = "h-4 w-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12l7 7 7-7" />
    </svg>
  );
}

/* ---------- helpers ---------- */
function extractIndexHelp(err) {
  const msg = String(err?.message || "");
  const urlMatch = msg.match(/https:\/\/console\.firebase\.google\.com\/[^\s)]+/i);
  if (err?.code === "failed-precondition" && urlMatch) {
    return `A Firestore index is required for this query. Click "Enable index" → ${urlMatch[0]}`;
  }
  return "";
}
