// src/pages/Reports.jsx
import {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  useLayoutEffect,
} from "react";
import { MapPin } from "lucide-react";
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
  getDoc,
  writeBatch,
  updateDoc,
} from "firebase/firestore";




// 🔐 project paths
import { db } from "../../lib/firebase";
// NOTE: useAuth is a DEFAULT export in your app
import useAuth from "../../auth/useAuth";
import AddVisitButton from "../../components/AddVisitButton";

// EFAP / USDA builders (fixed names)
// EFAP / USDA builders are large; dynamically import them where needed to keep
// the initial Reports chunk smaller. We'll load these utilities only when the
// user triggers an export or PDF build.

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
  ReferenceLine,
  LabelList,
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
const toISO = (d) =>
  d instanceof Date ? d.toISOString() : new Date(d).toISOString();

const chunk = (arr, size = 10) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const todayKey = fmtDateKey(new Date());

/* ---------- manual empty day helpers (persisted per org/location/month) ---------- */
const monthRangeFor = (monthKey) => {
  const d = dateFromMonthKey(monthKey);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return {
    start,
    end,
    startKey: fmtDateKey(start),
    endKey: fmtDateKey(end),
  };
};

const mdStorageKey = (orgId, locId, monthKey) =>
  `stc.manualDays:${orgId || "-"}/${locId || "-"}/${monthKey}`;

const loadManualDays = (key) => {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
};

const saveManualDays = (key, set) => {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(set || [])));
  } catch {}
};

const isDateKeyInMonth = (dateKey, monthKey) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
  const { startKey, endKey } = monthRangeFor(monthKey);
  return dateKey >= startKey && dateKey <= endKey;
};



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
    const vals = header.map((k) =>
      String(r?.[k] ?? "").replaceAll('"', '""')
    );
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
  const undPP = Array.from(firsts.values()).reduce((s, x) => s + x.persons, 0);

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
      const pop = document.querySelector(
        '[role="dialog"][aria-label="Select month and year"]'
      );
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
    const names = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const isCurrent =
      Number(monthKey.slice(0, 4)) === yearView &&
      Number(monthKey.slice(5, 7)) === mIndex0 + 1;

    return (
      <button
        onClick={() => commit(yearView, mIndex0)}
        className={
          "px-2.5 py-1.5 rounded-xl text-sm font-medium transition " +
          (isCurrent
            ? "bg-brand-700 text-white shadow-sm"
            : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50")
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
      {/* unified capsule with brand outline */}
      <div
        className="
          inline-flex items-center gap-0
          rounded-2xl bg-white
          border border-brand-200 ring-1 ring-brand-50
          shadow-[0_6px_16px_-6px_rgba(153,27,27,0.06)] shadow-md
          px-1.5 py-1
        "
      >
        {/* Prev */}
        <button
          onClick={() => jump(-1)}
          className={`${baseBtn} ${size} rounded-xl hover:bg-gray-50 active:bg-gray-100 text-gray-900`}
          aria-label="Previous month"
          title="Previous month"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
            aria-hidden="true"
          >
            <path d="M15 6l-6 6 6 6" strokeWidth="2" />
          </svg>
        </button>

        {/* divider */}
        <span
          className="mx-1 h-7 md:h-8 w-px bg-black/10"
          aria-hidden="true"
        />

        {/* Month button */}
        <div className="relative z-50">
          <button
            onClick={() => {
              setYearView(Number(monthKey.slice(0, 4)));
              setOpen((v) => !v);
            }}
            className={
              "inline-flex items-center justify-center gap-2 rounded-full " +
              "px-5 md:px-6 h-11 md:h-12 text-[16px] md:text-[17px] font-semibold tracking-tight " +
              "hover:bg-gray-50 active:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/50"
            }
            aria-haspopup="dialog"
            aria-expanded={open}
            title="Jump to a specific month/year"
          >
            <span className="text-[16px] md:text-[17px]">{label}</span>
            <svg
              className={`h-4 w-4 transition-transform ${
                open ? "rotate-180" : ""
              }`}
              viewBox="0 0 24 24"
              stroke="currentColor"
              fill="none"
            >
              <path d="M6 9l6 6 6-6" strokeWidth="2" />
            </svg>
          </button>

          {/* Popover */}
          {open && (
            <div
  className="
    absolute left-1/2 top-full z-[80]
    mt-2 w-[300px] -translate-x-1/2
    rounded-2xl
    border border-gray-200
    bg-white
    shadow-[0_8px_24px_rgba(0,0,0,0.08)]
    p-4
  "
  role="dialog"
>

              {/* Year header */}
              <div className="flex items-center justify-between mb-2">
                <button
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-black/20 bg-white hover:bg-gray-50"
                  onClick={() => setYearView((y) => y - 1)}
                  aria-label="Previous year"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    fill="none"
                  >
                    <path d="M15 6l-6 6 6 6" strokeWidth="2" />
                  </svg>
                </button>

                <div className="font-semibold">{yearView}</div>

                <button
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-black/20 bg-white hover:bg-gray-50"
                  onClick={() => setYearView((y) => y + 1)}
                  aria-label="Next year"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    fill="none"
                  >
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
                  value={`${String(yearView)}-${String(
                    Number(monthKey.slice(5, 7))
                  ).padStart(2, "0")}`}
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
        <span
          className="mx-1 h-7 md:h-8 w-px bg-black/10"
          aria-hidden="true"
        />

        {/* Next */}
        <button
          onClick={() => jump(1)}
          className={`${baseBtn} ${size} rounded-xl hover:bg-gray-50 active:bg-gray-100 text-gray-900`}
          aria-label="Next month"
          title="Next month"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
            aria-hidden="true"
          >
            <path d="M9 6l6 6-6 6" strokeWidth="2" />
          </svg>
        </button>

        {/* divider */}
        <span
          className="mx-1 h-7 md:h-8 w-px bg-black/10 hidden md:block"
          aria-hidden="true"
        />

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
  const {
    loading: authLoading,
    org,
    orgSettings,
    location,
    locations = [],
    canPickAllLocations = false,
    // legacy flag may still exist:
    isAdmin,
    // NEW capability API from AuthProvider.tsx:
    hasCapability,
    email,
    setActiveLocation,
  } = useAuth() || {};

  // Capability-derived booleans (fallback to legacy isAdmin when needed)
  const canDeleteVisits = useMemo(
    () => (typeof hasCapability === "function" ? hasCapability("deleteVisits") : !!isAdmin),
    [hasCapability, isAdmin]
  );
  const canLogVisits = useMemo(
    () => (typeof hasCapability === "function" ? hasCapability("logVisits") : !!isAdmin),
    [hasCapability, isAdmin]
  );
  const canViewReports = useMemo(
    () => (typeof hasCapability === "function" ? hasCapability("viewReports") : !!isAdmin),
    [hasCapability, isAdmin]
  );

  // UI/state
  const [exportingPdf, setExportingPdf] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedMonthKey, setSelectedMonthKey] = useState(
    monthKeyFor(new Date())
  );
  const [selectedDate, setSelectedDate] = useState(fmtDateKey(new Date()));
  // Manual "empty" days (unioned with visit days)
  const [manualDays, setManualDays] = useState(new Set());
  // Input control for adding a day
  const [addDayInput, setAddDayInput] = useState("");

  const [visits, setVisits] = useState([]);
  const [clientsById, setClientsById] = useState(new Map());
  const [clientsHydrated, setClientsHydrated] = useState(false);

  // 🔁 Per-org client cache so changing days/months is instant & future-proof
  const clientCacheRef = useRef(new Map());
  const lastOrgIdRef = useRef(null);

  // live-ish status
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [syncAgo, setSyncAgo] = useState("");

  const dayListRef = useRef(null);
  const [dayFilter, setDayFilter] = useState("");
  const [term, setTerm] = useState("");
  const [usdaFilter, setUsdaFilter] = useState("all"); // all|yes|no
  const [sortKey, setSortKey] = useState("time"); // time|name|hh
  const [sortDir, setSortDir] = useState("desc"); // asc|desc

  const [menuOpen, setMenuOpen] = useState(false);
  const [kebabOpen, setKebabOpen] = useState(false);
  const menuRef = useRef(null);
  const kebabRef = useRef(null);

  const [rowMenuOpen, setRowMenuOpen] = useState(null);
  const [editVisit, setEditVisit] = useState(null);



  // Load when org/location/month changes
  useEffect(() => {
    const key = mdStorageKey(org?.id, location?.id, selectedMonthKey);
    setManualDays(loadManualDays(key));
    setAddDayInput("");
  }, [org?.id, location?.id, selectedMonthKey]);


  // 🔁 Per-org client cache so changing days/months is instant & future-proof

  // Reset client cache when org changes (multi-org ready)
  useEffect(() => {
    if (!org?.id || lastOrgIdRef.current !== org.id) {
      clientCacheRef.current = new Map();
      lastOrgIdRef.current = org?.id || null;
      setClientsById(new Map());
      setClientsHydrated(false);
    }
  }, [org?.id]);

  // live-ish status

  useEffect(() => {
    const tick = () => {
      if (!lastSyncedAt) return setSyncAgo("");
      const secs = Math.max(
        0,
        Math.floor((Date.now() - lastSyncedAt.getTime()) / 1000)
      );
      if (secs < 60) setSyncAgo(`${secs}s ago`);
      else setSyncAgo(`${Math.floor(secs / 60)}m ago`);
    };
    const id = setInterval(tick, 1000);
    tick();
    return () => clearInterval(id);
  }, [lastSyncedAt]);



  useEffect(() => {
    const onDocClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
      if (kebabRef.current && !kebabRef.current.contains(e.target))
        setKebabOpen(false);
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

    // If the user is NOT allowed org-wide scope, they must have a location selected.
    if (!canPickAllLocations && !location?.id) {
      // Try auto-selecting their first permitted location if we have it
      if (locations.length && typeof setActiveLocation === "function") {
        setActiveLocation(locations[0].id);
      } else {
        setVisits([]);
        setError("You don’t have an active location. Ask an admin to assign one.");
      }
      return; // don’t run an org-wide query
    }

    setLoading(true);
    setError("");
    let off;

    // Compute month range on dateKey (YYYY-MM-DD)
    const d = dateFromMonthKey(selectedMonthKey);
    const startKey = fmtDateKey(new Date(d.getFullYear(), d.getMonth(), 1));
    const endKey = fmtDateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0)); // last day of month

    const filters = [where("orgId", "==", org.id)];
    // If a location is selected, always scope to it.
    // If no location is selected, ONLY allow org-wide when canPickAllLocations === true.
    if (location?.id) {
      filters.push(where("locationId", "==", location.id));
    } else if (!canPickAllLocations) {
      setLoading(false);
      return; // safety: never fall through to org-wide when not permitted
    }

    // Add the month range as range filters on the same field you order by
    filters.push(where("dateKey", ">=", startKey));
    filters.push(where("dateKey", "<=", endKey));

    const qv = query(
      collection(db, "visits"),
      ...filters,
      orderBy("dateKey", "asc")
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
              setError(
                extractIndexHelp(err) ||
                  "Failed to load visits for this month."
              );
            } finally {
              setLoading(false);
              setLastSyncedAt(new Date());
            }
          }
        );
      } catch (e) {
        console.error(e);
        setError(
          extractIndexHelp(e) || "Failed to load visits for this month."
        );
        setLoading(false);
      }
    })();

    return () => (off ? off() : undefined);
  }, [
    authLoading,
    org?.id,
    location?.id,
    selectedMonthKey,
    canPickAllLocations,
    locations.length,
    setActiveLocation,
  ]);

  /* --------------------------------
     Hydrate client docs in small batches (with cache, non-blocking UI)
     -------------------------------- */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setClientsHydrated(false);

        const allIds = Array.from(
          new Set(visits.map((v) => v.clientId).filter(Boolean))
        );

        if (!allIds.length) {
          if (!cancelled) {
            setClientsById(new Map());
            setClientsHydrated(true);
          }
          return;
        }

        const cache = clientCacheRef.current;
        const missing = allIds.filter((id) => !cache.has(id));

        // nothing new to fetch, just reuse cache
        if (!missing.length) {
          if (!cancelled) {
            setClientsById(new Map(cache));
            setClientsHydrated(true);
          }
          return;
        }

        const merged = new Map(cache);
        for (const part of chunk(missing, 10)) {
          const qs = await getDocs(
            query(collection(db, "clients"), where("__name__", "in", part))
          );
          for (const d of qs.docs) merged.set(d.id, { id: d.id, ...d.data() });
        }

        if (!cancelled) {
          clientCacheRef.current = merged;
          setClientsById(new Map(merged));
          setClientsHydrated(true);
        }
      } catch (e) {
        console.warn("Client lookup error", e);
        if (!cancelled) {
          // still let UI render immediately
          setClientsById(new Map(clientCacheRef.current));
          setClientsHydrated(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visits]);

  // ⚡ Only the Firestore visit query controls "busy" now
  const isBusy = loading;

  // Group visits by day (Map<dateKey, Visit[]>)
  const visitsByDay = useMemo(() => {
    const m = new Map();
    for (const v of visits || []) {
      const dk =
        typeof v.dateKey === "string" && v.dateKey.length >= 10
          ? v.dateKey.slice(0, 10)
          : fmtDateKey(toJSDate(v.visitAt));
      if (!m.has(dk)) m.set(dk, []);
      m.get(dk).push(v);
    }
    return m;
  }, [visits]);

  // All day keys (from visits + manual days), filtered by month + dayFilter, sorted desc
  const sortedDayKeys = useMemo(() => {
    const allKeys = new Set([
      ...Array.from(visitsByDay.keys()),
      ...Array.from(manualDays || []),
    ]);

    const keys = Array.from(allKeys).filter((k) => {
      if (!isDateKeyInMonth(k, selectedMonthKey)) return false;
      if (!dayFilter) return true;
      return k.includes(dayFilter.trim());
    });

    // newest first (YYYY-MM-DD string sort works)
    keys.sort((a, b) => b.localeCompare(a));
    return keys;
  }, [visitsByDay, manualDays, selectedMonthKey, dayFilter]);

  // Month level aggregation for KPIs + charts
  const monthAgg = useMemo(() => {
    const byDay = new Map();
    let totalHH = 0;
    let totalUsdaYes = 0;
    let totalUsdaNo = 0;

    for (const v of visits || []) {
      const dk =
        typeof v.dateKey === "string" && v.dateKey.length >= 10
          ? v.dateKey.slice(0, 10)
          : fmtDateKey(toJSDate(v.visitAt));

      const persons = Number(v.householdSize || 0) || 0;
      const isYes = v.usdaFirstTimeThisMonth === true;

      if (!byDay.has(dk)) {
        byDay.set(dk, { visits: 0, people: 0, usdaYes: 0 });
      }
      const entry = byDay.get(dk);
      entry.visits += 1;
      entry.people += persons;
      if (isYes) entry.usdaYes += 1;

      totalHH += persons;
      if (isYes) totalUsdaYes += 1;
      else totalUsdaNo += 1;
    }

    const dayKeys = Array.from(byDay.keys()).sort();
    const visitsPerDay = dayKeys.map((dk) => {
      const entry = byDay.get(dk) || { visits: 0, people: 0 };
      return {
        date: dk.slice(5), // show MM-DD or DD depending on your preference
        visits: entry.visits,
        people: entry.people,
      };
    });

    return {
      households: totalHH,
      byDay,
      charts: {
        visitsPerDay,
        usdaPie: [
          { name: "USDA Yes", value: totalUsdaYes },
          { name: "USDA No", value: totalUsdaNo },
        ],
      },
    };
  }, [visits]);

  // Day totals (unfiltered) for summary stripe
  const dayTotals = useMemo(() => {
    const dayVisits = visitsByDay.get(selectedDate) || [];
    let count = dayVisits.length;
    let hh = 0;
    let usdaYes = 0;

    for (const v of dayVisits) {
      hh += Number(v.householdSize || 0) || 0;
      if (v.usdaFirstTimeThisMonth === true) usdaYes += 1;
    }

    return { count, hh, usdaYes };
  }, [visitsByDay, selectedDate]);

   // Base row model for the table (one day, before filters/sort)
  const baseRows = useMemo(() => {
    const dayVisits = visitsByDay.get(selectedDate) || [];

    return dayVisits.map((v) => {
      const p = clientsById.get(v.clientId) || {};

      // build display name from client doc + visit snapshot fields
      const first =
        p.firstName ??
        v.clientFirstName ??
        (typeof p.name === "string" ? p.name.split(" ")[0] : "") ??
        "";
      const last =
        p.lastName ??
        v.clientLastName ??
        (typeof p.name === "string"
          ? p.name.split(" ").slice(1).join(" ")
          : "") ??
        "";

      const labelName =
        `${first} ${last}`.trim() ||
        (typeof v.clientName === "string" ? v.clientName : "") ||
        "—";

      const visitDate = v.visitAt ? toJSDate(v.visitAt) : null;
      const visitTs = visitDate ? visitDate.getTime() : 0;
      const localTime = visitDate
        ? visitDate.toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })
        : "";

      // Prefer historical snapshot on the visit, then fall back to legacy fields / client doc
      const county = v.clientCounty || p.county || "";
      const zip = v.clientZip || v.zip || p.zip || "";

      const visitHousehold = Number(v.householdSize || 0) || 0;

      // use addedAt when present, otherwise createdAt, otherwise visitAt
      const addedSource = v.addedAt || v.createdAt || v.visitAt;
      let addedLocalTime = "";
      let addedLocalDate = "";
      let addedTs = 0;

      if (addedSource) {
        const ad = toJSDate(addedSource);
        addedTs = ad.getTime();

        addedLocalTime = ad.toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        });

        addedLocalDate = ad.toLocaleDateString([], {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
      }

      const displayDateTime = visitDate
        ? `${selectedDate ||
            visitDate.toLocaleDateString([], {
              month: "short",
              day: "numeric",
              year: "numeric",
            })} • ${localTime || ""}`.trim()
        : "";

      return {
        visitId: v.id,
        clientId: v.clientId || "",
        visitHousehold,
        usdaFirstTimeThisMonth:
          v.usdaFirstTimeThisMonth === true
            ? true
            : v.usdaFirstTimeThisMonth === false
            ? false
            : "",
        county,
        zip,
        localTime,
        visitTs,
        addedTs, // when this visit was added
        labelName,
        labelNameLower: labelName.toLowerCase(),
        addedByReports: !!v.addedByReports,
        addedLocalTime,
        addedLocalDate,
        displayDateTime,
      };
    });
  }, [visitsByDay, selectedDate, clientsById]);


  // Apply USDA filter, search term, and sorting
  const filteredSortedRows = useMemo(() => {
    let rows = [...baseRows];

    // USDA yes/no filter
    if (usdaFilter === "yes") {
      rows = rows.filter((r) => r.usdaFirstTimeThisMonth === true);
    } else if (usdaFilter === "no") {
      rows = rows.filter((r) => r.usdaFirstTimeThisMonth === false);
    }

    // Search
    const q = term.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => {
        const inName = r.labelNameLower.includes(q);
        const inCounty = (r.county || "").toLowerCase().includes(q);
        const inZip = String(r.zip || "").includes(q);
        return inName || inCounty || inZip;
      });
    }

    // Sort
        rows.sort((a, b) => {
      let cmp = 0;

      if (sortKey === "name") {
        cmp = a.labelNameLower.localeCompare(b.labelNameLower);
      } else if (sortKey === "hh") {
        cmp = (a.visitHousehold || 0) - (b.visitHousehold || 0);
      } else {
        // time = when it was added (fallback to visitTs if needed)
        const atA = a.addedTs ?? a.visitTs ?? 0;
        const atB = b.addedTs ?? b.visitTs ?? 0;
        cmp = atA - atB;
      }

      return sortDir === "asc" ? cmp : -cmp;
    });


    return rows;
  }, [baseRows, usdaFilter, term, sortKey, sortDir]);

  /* --------------------------------
     Actions
     -------------------------------- */
    const removeVisit = useCallback(
    async (row) => {
      if (!row?.visitId) return;

      if (!canDeleteVisits) {
        toast.show("You don’t have permission to delete.", "warn");
        return;
      }

      const ok = confirm("Delete this visit from the database?");
      if (!ok) return;

      const { visitId, clientId, monthKey, dateKey, usdaFirstTimeThisMonth } = row;

      try {
        // 1) Delete the visit itself
        await deleteDoc(doc(db, "visits", visitId));

        // 2) If this visit was marked USDA first-time for the month,
        //    also clear the usda_first marker for that client+month.
        if (usdaFirstTimeThisMonth && org?.id && clientId) {
          const mk =
            monthKey ||
            (typeof dateKey === "string" && dateKey.length >= 7
              ? dateKey.slice(0, 7)
              : "");

          if (mk) {
            const usdaSnap = await getDocs(
              query(
                collection(db, "usda_first"),
                where("orgId", "==", org.id),
                where("clientId", "==", clientId),
                where("monthKey", "==", mk)
              )
            );

            // there should normally be at most one, but just in case…
            await Promise.all(usdaSnap.docs.map((d) => deleteDoc(d.ref)));
          }
        }

        // 3) Update local state
        setVisits((prev) => prev.filter((v) => v.id !== visitId));
        toast.show("Visit deleted.", "info");
      } catch (e) {
        console.error(e);
        alert("Failed to delete visit. Please try again.");
      }
    },
    [canDeleteVisits, toast, org?.id]
  );


  



  const addManualDay = useCallback(() => {
  const raw = (addDayInput || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    toast.show("Enter a date in YYYY-MM-DD.", "warn");
    return;
  }
  if (!isDateKeyInMonth(raw, selectedMonthKey)) {
    toast.show("Date is outside this month.", "warn");
    return;
  }

  // If it already exists from visits or manual, just select it
  if (visitsByDay.has(raw) || manualDays.has(raw)) {
    setSelectedDate(raw);
    return;
  }

  const next = new Set(manualDays);
  next.add(raw);
  setManualDays(next);

  const key = mdStorageKey(org?.id, location?.id, selectedMonthKey);
  saveManualDays(key, next);

  setSelectedDate(raw);
  setAddDayInput("");
  toast.show("Day added to month.", "info");
}, [
  addDayInput,
  selectedMonthKey,
  visitsByDay,
  manualDays,
  org?.id,
  location?.id,
  toast,
  setSelectedDate,
]);


// ⬇️ REPLACE the old removeManualDay with this
const removeDay = useCallback(
  async (dateKey) => {
    if (!dateKey) return;

    // Permission check
    if (!canDeleteVisits) {
      toast.show("You don’t have permission to delete.", "warn");
      return;
    }

    // Build the same scope you use for month query (org + location or org-wide if allowed)
    if (!org?.id) {
      toast.show("Missing org context.", "warn");
      return;
    }
    if (!canPickAllLocations && !location?.id) {
      toast.show("Select a location first.", "warn");
      return;
    }

    // Query all visits for that exact day (in current scope)
    const filters = [where("orgId", "==", org.id), where("dateKey", "==", dateKey)];
    if (location?.id) filters.push(where("locationId", "==", location.id));

    const qDay = query(collection(db, "visits"), ...filters, orderBy("dateKey", "asc"));
    const snap = await getDocs(qDay);
    const count = snap.size;

    const ok = confirm(
    count > 0
      ? `⚠️  Confirm Deletion\n\n` +
        `You are about to permanently delete ${count} visit${count === 1 ? "" : "s"} on ${dateKey}.\n\n` +
        `This will remove every visit record for that entire day${
          location?.name ? ` at ${location.name}` : ""
        } in ${org?.name || "this organization"}.\n\n` +
        `This action cannot be undone. Press “Cancel” to keep your data.`
      : `Remove ${dateKey} from this month?\n\nThis will only remove the blank day placeholder.`
  );

    if (!ok) return;

    try {
      // Delete all visits in Firestore
      if (count > 0) {
        const ids = snap.docs.map((d) => d.id);
        // small concurrency batches to be safe
        const BATCH = 20;
        for (let i = 0; i < ids.length; i += BATCH) {
          const chunkIds = ids.slice(i, i + BATCH);
          await Promise.all(chunkIds.map((id) => deleteDoc(doc(db, "visits", id))));
        }
      }

      // Remove from local manual-days if present
      if (manualDays.has(dateKey)) {
        const next = new Set(manualDays);
        next.delete(dateKey);
        setManualDays(next);
        const key = mdStorageKey(org?.id, location?.id, selectedMonthKey);
        saveManualDays(key, next);
      }

      // Prune from local state list so UI updates immediately
      setVisits((prev) => prev.filter((v) => (v.dateKey || fmtDateKey(toJSDate(v.visitAt))) !== dateKey));

      // If we deleted the currently selected day, select the next newest
      if (selectedDate === dateKey) {
        const nextKey =
          sortedDayKeys.find((k) => k !== dateKey) || "";
        setSelectedDate(nextKey);
      }

      toast.show(count > 0 ? "Day and visits deleted." : "Day removed.", "info");
    } catch (e) {
      console.error(e);
      alert("Failed to delete this day. Please try again.");
    }
  },
  [
    db,
    org?.id,
    location?.id,
    canPickAllLocations,
    canDeleteVisits,
    manualDays,
    selectedMonthKey,
    selectedDate,
    sortedDayKeys,
    toast,
  ]
);



  const exportOneDayCsv = useCallback(
    (dayKey) => {
      const src = visitsByDay.get(dayKey) || [];
      const rows = src.map((v) => {
  const d = toJSDate(v.visitAt);
  const p = clientsById.get(v.clientId) || {};
  const address =
    p.address ||
    p.addr ||
    p.street ||
    p.street1 ||
    p.line1 ||
    p.address1 ||
    v.clientAddress ||
    v.clientStreet ||
    v.clientLine1 ||
    "";
  const zip = v.clientZip || v.zip || p.zip || "";

  return {
    dateKey: v.dateKey || fmtDateKey(d),
    monthKey: v.monthKey || "",
    visitId: v.id,
    visitAtISO: toISO(d),
    clientId: v.clientId || "",
    firstName: p.firstName || "",
    lastName: p.lastName || "",
    address,
    zip,
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
  async (dayKey) => {
    let srcRows;

    // If we're exporting for the currently selected day,
    // use the exact same rows as the table.
    if (dayKey === selectedDate) {
      srcRows = filteredSortedRows.map((r) => ({
        name: r.labelName,
        county: r.county || "",
        zip: r.zip || "",
        householdSize: Number(r.visitHousehold || 0),
        firstTime:
          r.usdaFirstTimeThisMonth === true
            ? true
            : r.usdaFirstTimeThisMonth === false
            ? false
            : "",
      }));
    } else {
      // Fallback: build from raw visits for that day (used by sidebar quick actions)
      const src = visitsByDay.get(dayKey) || [];

      srcRows = src.map((v) => {
        const p = clientsById.get(v.clientId) || {};

        const first =
          p.firstName ??
          v.clientFirstName ??
          (typeof p.name === "string" ? p.name.split(" ")[0] : "") ??
          "";
        const last =
          p.lastName ??
          v.clientLastName ??
          (typeof p.name === "string"
            ? p.name.split(" ").slice(1).join(" ")
            : "") ??
          "";
        const name =
          `${first} ${last}`.trim() ||
          (typeof v.clientName === "string" ? v.clientName : "");

        const county = v.clientCounty || p.county || "";
        const zip = p.zip || v.clientZip || "";

        return {
          name,
          county,
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
    }

    const mod = await import("../../utils/buildEfapDailyPdf");
    return await mod.buildEfapDailyPdf(srcRows, {
      dateStamp: dayKey,
      orgSettings,
      orgName: org?.name,
      org,
    });
  },
  [
    selectedDate,
    filteredSortedRows,
    visitsByDay,
    clientsById,
    org,
    orgSettings,
  ]
);




  const exportEfapDailyPdfForDay = useCallback(
    async (dayKey) => {
      try {
          const pdfBytes = await buildEfapBytesForDay(dayKey);
          const site = (orgSettings?.brandText || org?.name || "ShepherdsTable")
            .replace(/\s+/g, "_");
          const mod = await import("../../utils/buildEfapDailyPdf");
          const fileName = mod.efapSuggestedFileName(dayKey, site);

        downloadBytes(pdfBytes, fileName, "application/pdf");
        toast.show("EFAP PDF downloaded.", "info");
      } catch (e) {
        console.error("EFAP build/download failed:", e);
        alert("Couldn’t build the EFAP PDF for that day.");
      }
    },
    [buildEfapBytesForDay, toast, orgSettings?.brandText, org?.name]
  );

  const shareEfapDailyPdfForDay = useCallback(
    async (dayKey) => {
      try {
        const pdfBytes = await buildEfapBytesForDay(dayKey);
        const site = (orgSettings?.brandText || org?.name || "ShepherdsTable")
          .replace(/\s+/g, "_");
        const mod = await import("../../utils/buildEfapDailyPdf");
        const fileName = mod.efapSuggestedFileName(dayKey, site);

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
    [buildEfapBytesForDay, toast, orgSettings?.brandText, org?.name]
  );

  /* ---------- Export USDA Monthly (dedicated builder) ---------- */
  const handleExportUsdaPdf = useCallback(async () => {
    try {
      setExportingPdf(true);

      const [y, m] = selectedMonthKey.split("-").map(Number);
      const year = y;
      const monthIndex0 = m - 1;

      const agg = aggregateMonthForPdf(visits);

      const monthLabelStr = new Date(year, monthIndex0, 1).toLocaleString(
        undefined,
        {
          month: "long",
          year: "numeric",
        }
      );

      const mod = await import("../../utils/buildEfapMonthlyPdf");
      await mod.downloadEfapMonthlyPdf(
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

  // If a user landed here without the right capability (defense in depth)
  if (!canViewReports) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="text-lg font-semibold mb-1">Restricted</div>
          <p className="text-sm text-gray-600">
            You don’t have access to Reports. If you think this is a mistake,
            ask an admin to update your permissions.
          </p>
        </div>
      </div>
    );
  }

  // Scope chip (icon variant for desktop header)
  const scopeChip = (
    <span className="inline-flex items-center gap-1 rounded-full bg-white text-brand-900 ring-1 ring-black/5 shadow-sm px-2 py-0.5 text-[12px]">
      <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-brand-50 text-[color:var(--brand-700)] ring-1 ring-brand-100 mr-1">
        <MapPin className="h-3 w-3" aria-hidden="true" />
      </span>
      <span className="font-semibold text-xs truncate">{location?.name ? `${org?.name || "—"} / ${location.name}` : org?.name || "—"}</span>
    </span>
  );

  // Accessible aria-sort helper for table headers
  const ariaSortFor = (key) =>
    sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none";

  
    const handleHeaderSort = useCallback(
    (key) => {
      setSortKey((prevKey) => {
        if (prevKey === key) {
          // same column -> just flip direction
          setSortDir((d) => (d === "asc" ? "desc" : "asc"));
          return prevKey;
        }
        // new column -> sensible defaults
        setSortDir(key === "name" ? "asc" : "desc");
        return key;
      });
    },
    []
  );

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-2 sm:pt-3 max-w-7xl mx-auto overflow-visible">
      {/* ===== THEMED TOOLBAR ===== */}
      <div className="block rounded-3xl overflow-visible shadow-sm ring-1 ring-black/5 relative mb-4">
        {/* Brand gradient header (pill sits on the seam) */}
        <div className="rounded-t-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 p-3 sm:p-4 relative pb-6 shadow-[inset_0_-1px_0_rgba(255,255,255,0.25)]">
          <div className="flex flex-wrap items-center justify-center md:justify-between gap-2">
            <h1 className="text-white text-lg sm:text-2xl font-semibold tracking-tight text-center md:text-left">
              Reports
            </h1>
            <div className="hidden md:flex items-center gap-2">{scopeChip}</div>
          </div>
          <div className="mt-2 md:mt-3 flex flex-wrap items-center justify-center md:justify-start gap-2">
            {/* keep scope visible in the lower row on smaller screens */}
            <div className="md:hidden">{scopeChip}</div>
          </div>

          {/* Month nav: flow under header on small screens, float on md+ */}
          <div className="absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 z-10 w-full md:w-auto flex justify-center px-4 md:px-0">
            <ReportsMonthNav
              monthKey={selectedMonthKey}
              setMonthKey={setSelectedMonthKey}
              setSelectedDate={setSelectedDate}
            />
          </div>
        </div>

        {/* Controls surface – reserve under the pill; slightly smaller on narrow screens */}
        <div className="rounded-b-3xl bg-white/95 backdrop-blur px-3 sm:px-5 py-4 sm:py-6 min-h-[56px] sm:min-h-[64px] border border-brand-100 ring-1 ring-brand-50 shadow-soft" />
      </div>

      {/* ===== KPI Row (wording tightened) ===== */}
      <div className="mt-4">
        <div className="-mx-4 sm:mx-0">
          <div className="overflow-x-auto overflow-y-visible md:overflow-visible no-scrollbar px-4 py-1">
            <div
              className="
                grid grid-flow-col
                auto-cols-[85%] xs:auto-cols-[60%] sm:auto-cols-[minmax(0,1fr)]
                md:grid-flow-row md:grid-cols-2 lg:grid-cols-4
                gap-3 sm:gap-4 md:gap-6
                snap-x md:snap-none
                pr-2
              "
            >
              <div className="snap-start md:snap-none w-full">
                <KpiModern title="Total Visits (Month)" value={visits.length} />
              </div>
              <div className="snap-start md:snap-none w-full">
                <KpiModern title="Households (Month)" value={monthAgg.households} />
              </div>
              <div className="snap-start md:snap-none w-full">
                <KpiModern
                  title="USDA First-Time (Month)"
                  value={monthAgg.charts?.usdaPie?.[0]?.value ?? 0}
                />
              </div>
              <div className="snap-start md:snap-none w-full">
                <KpiModern
                  title="Active Service Days (Month)"
                  value={Array.from(monthAgg.byDay.keys()).length}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 lg:mt-10" />

      {/* ===== Charts (titles tightened) ===== */}
<div className="grid gap-6 sm:gap-7 lg:gap-8 md:grid-cols-2 lg:grid-cols-3 mb-6 sm:mb-8">
        {/* Visits per Day */}
        <Card title="Visits per Day">
  <div className="h-[220px] md:h-[240px] px-2 sm:px-3 pt-2 -mb-2 sm:-mb-3">
    <ResponsiveContainer width="100%" height="100%">

              <LineChart
                data={monthAgg.charts.visitsPerDay}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="lineGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#991b1b" stopOpacity={1} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0.4} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#f1f5f9"
                  vertical={false}
                />
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
                <Tooltip
                  contentStyle={tooltipBoxStyle}
                  cursor={{ stroke: "#ef4444", opacity: 0.25 }}
                />
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
                    fill: "#991b1b",
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* USDA Yes vs No — clipping-proof donut (no outside labels, center metric, legend below) */}
<Card title="USDA Yes vs No">
  <div className="h-[220px] md:h-[240px] px-3 sm:px-4 grid place-items-center -mb-2 sm:-mb-3">
    <ResponsiveContainer width="100%" height="100%">

      <PieChart margin={{ top: 6, right: 6, bottom: 6, left: 6 }}>
        <defs>
          <linearGradient id="usdaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#991b1b" stopOpacity="1" />
            <stop offset="100%" stopColor="#ef4444" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        <Pie
          data={monthAgg.charts.usdaPie}
          dataKey="value"
          nameKey="name"
          innerRadius="62%"
          outerRadius="80%"
          paddingAngle={2}
          label={false}
          labelLine={false}
          isAnimationActive={false}
        >
          {monthAgg.charts.usdaPie.map((d, i) => (
            <Cell
              key={i}
              fill={/yes/i.test(d?.name) ? "url(#usdaGradient)" : "#fecaca"}
              stroke="#fff"
              strokeWidth={1.25}
            />
          ))}

          {/* Center metric — never clips */}
          <text
            x="50%"
            y="50%"
            textAnchor="middle"
            dominantBaseline="central"
            style={{ fontWeight: 800, fontSize: 18, fill: "#991b1b" }}
          >
            {(() => {
              const yes = (monthAgg.charts.usdaPie || []).find(d => /yes/i.test(d?.name))?.value ?? 0;
              const no  = (monthAgg.charts.usdaPie || []).find(d => /no/i.test(d?.name))?.value ?? 0;
              const total = Math.max(yes + no, 1);
              return `${Math.round((yes / total) * 100)}%`;
            })()}
          </text>
          <text
            x="50%"
            y="50%"
            dy="16"
            textAnchor="middle"
            dominantBaseline="central"
            style={{ fontWeight: 600, fontSize: 11, fill: "#991b1b" }}
          >
            USDA Yes
          </text>
        </Pie>

        <Tooltip contentStyle={tooltipBoxStyle} />
      </PieChart>
    </ResponsiveContainer>
  </div>

  {/* Clean legend below (no overlap/clipping) */}
  <div className="mt-2 flex items-center justify-center gap-4 text-[12px]">
    {(() => {
      const yes = (monthAgg.charts.usdaPie || []).find(d => /yes/i.test(d?.name))?.value ?? 0;
      const no  = (monthAgg.charts.usdaPie || []).find(d => /no/i.test(d?.name))?.value ?? 0;
      return (
        <>
          <span className="inline-flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm" style={{ background: "linear-gradient(180deg,#991b1b,#ef4444)" }} />
            <span className="text-gray-700">USDA Yes</span>
            <span className="text-gray-400">·</span>
            <span className="font-semibold text-gray-900">{yes}</span>
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm" style={{ background: "#fecaca" }} />
            <span className="text-gray-700">USDA No</span>
            <span className="text-gray-400">·</span>
            <span className="font-semibold text-gray-900">{no}</span>
          </span>
        </>
      );
    })()}
  </div>
</Card>


        {/* People Served per Day (avg line, tidy axis, labels, wider gap) */}
<Card title="People Served per Day">
  <div className="h-[220px] md:h-[240px] px-2 sm:px-3 pt-2 -mb-2 sm:-mb-3">
    <ResponsiveContainer width="100%" height="100%">

      <BarChart
        data={monthAgg.charts.visitsPerDay}
        margin={{ top: 12, right: 10, left: 0, bottom: 8 }}
        barCategoryGap={14}
      >
        <defs>
          <linearGradient id="peopleBars" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#991b1b" stopOpacity="1" />
            <stop offset="100%" stopColor="#ef4444" stopOpacity="0.78" />
          </linearGradient>
        </defs>

        <CartesianGrid strokeDasharray="2 4" stroke="#eef2f7" vertical={false} />

        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: "#6b7280" }}
          tickMargin={6}
          axisLine={{ stroke: "#e5e7eb" }}
          tickLine={false}
          interval="preserveStartEnd"
          minTickGap={16}
        />

        {(() => {
          const rows = monthAgg.charts.visitsPerDay || [];
          const max = Math.max(0, ...rows.map(r => r.people || 0));
          const nice = max ? Math.ceil(max / 50) * 50 : 0; // round to neat 50s
          return (
            <YAxis
              allowDecimals={false}
              domain={[0, nice || "auto"]}
              tick={{ fontSize: 11, fill: "#6b7280" }}
              axisLine={{ stroke: "#e5e7eb" }}
              tickLine={false}
              width={34}
            />
          );
        })()}

        <Tooltip
          cursor={{ fill: "rgba(153,27,27,0.06)" }}
          formatter={(v) => [v, "People"]}
          labelFormatter={(l) => `Date: ${l}`}
          contentStyle={tooltipBoxStyle}
        />

        {(() => {
          const rows = monthAgg.charts.visitsPerDay || [];
          const total = rows.reduce((s, r) => s + (r.people || 0), 0);
          const avg = rows.length ? Math.round(total / rows.length) : 0;
          return (
            <ReferenceLine
              y={avg}
              stroke="#cbd5e1"
              strokeDasharray="3 3"
              ifOverflow="extendDomain"
              label={{
                value: `Avg ${avg}`,
                position: "right",
                fill: "#64748b",
                fontSize: 11,
                offset: 8,
              }}
            />
          );
        })()}

        <Bar
          dataKey="people"
          fill="url(#peopleBars)"
          radius={[9, 9, 0, 0]}
          minPointSize={2}
          isAnimationActive={false}
        >
          <LabelList
            dataKey="people"
            position="top"
            style={{ fontSize: 11, fill: "#374151", fontWeight: 600, pointerEvents: "none" }}
            formatter={(v) => (v == null ? "" : v)}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  </div>
</Card>

      </div>

      {/* ===== Layout: days list + table ===== */}
      <div className="mt-6 sm:mt-8 grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 print:block">
        {/* Days list */}
        <aside className={
          "group relative rounded-2xl border border-brand-200 ring-1 ring-brand-100 bg-white shadow-sm p-3 print:hidden lg:col-span-1 " +
          "hover:shadow-[0_12px_28px_-12px_rgba(0,0,0,0.18)] hover:ring-brand-200 hover:border-brand-300 transition will-change-transform hover:scale-[1.01] active:scale-[.995]"
        }>
          <div className="mb-3 sm:mb-4">
            <div className="-mx-3 -mt-3 mb-3 rounded-t-2xl overflow-hidden">
              <div className="bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 px-4 py-3 flex items-center justify-between gap-3">
                <div className="text-white font-semibold">Days in {monthLabel(selectedMonthKey)}</div>
                <input
                  className="rounded-full bg-white px-3 py-2 text-sm w-[160px] sm:w-[170px] border border-white/30 shadow-sm placeholder-gray-400"
                  placeholder="Filter (YYYY-MM-DD)"
                  value={dayFilter}
                  onChange={(e) => setDayFilter(e.target.value)}
                  aria-label="Filter days"
                />
              </div>
            </div>

            {/* Add Day row */}
            <div className="grid grid-cols-[1fr_auto_auto] gap-2">
              <input
                type="date"
                value={addDayInput}
                onChange={(e) => setAddDayInput(e.target.value)}
                aria-label="Pick a day to add"
                className="rounded-lg border px-2 py-2 text-sm"
                min={monthRangeFor(selectedMonthKey).startKey}
                max={monthRangeFor(selectedMonthKey).endKey}
                placeholder="YYYY-MM-DD"
              />
              <button
                onClick={addManualDay}
                className="inline-flex items-center justify-center rounded-xl px-3.5 py-2 text-sm font-semibold shadow bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 text-white hover:from-brand-800 hover:via-brand-700 hover:to-brand-600 active:from-brand-900 active:via-brand-800 active:to-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-300 transition"
                title="Add a blank day to this month"
                aria-label="Add day"
              >
                Add Day
              </button>
              
            </div>
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
                const dayHH = items.reduce(
                  (s, v) => s + Number(v.householdSize || 0),
                  0
                );
                const dayUsda = items.reduce(
                  (s, v) => s + (v.usdaFirstTimeThisMonth === true ? 1 : 0),
                  0
                );
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
                    className={`group cursor-pointer flex items-center gap-2 p-2 rounded-xl border transition ${
                      isSelected
                        ? "bg-brand-50 border-brand-200 shadow-sm"
                        : "bg-white border-gray-200 hover:bg-gray-50 shadow-sm"
                    }`}
                  >
                    <div className="flex-1 px-2 py-1">
                                          
                    <div className="font-medium flex items-center gap-2">
                      {k}
                      {isToday && (
                        <span className="inline-flex ml-2 items-center text-[10px] leading-none tracking-wide font-semibold rounded px-1.5 py-0.5 bg-brand-700 text-white">
                          TODAY
                        </span>
                      )}
                      {!visitsByDay.has(k) ? (
                        <span className="text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 bg-gray-100 text-gray-700 ring-1 ring-gray-200">
                          Added
                        </span>
                      ) : null}
                    </div>
                      <div className="text-xs text-gray-500">
                        {items.length} visit{items.length === 1 ? "" : "s"} • HH{" "}
                        {dayHH} • USDA {dayUsda}
                      </div>
                    </div>

                    {/* Day actions menu */}
                    <div className="relative ml-1 shrink-0" data-day-action>
                      <button
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-brand-200 bg-white text-brand-900 hover:bg-brand-50 transition"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRowMenuOpen((prev) => (prev === `day-${k}` ? null : `day-${k}`));
                        }}
                        aria-label="Day actions"
                        title="More actions"
                      >
                        <KebabIcon className="h-4 w-4" />
                      </button>

                      {rowMenuOpen === `day-${k}` && (
                        <div className="absolute right-0 mt-2 w-44 bg-white rounded-xl border border-gray-200 shadow-lg z-20 p-1">
                          
                          {/* Share EFAP PDF */}
                          <button
                            className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 flex items-center gap-2 text-sm"
                            onClick={() => {
                              setRowMenuOpen(null);
                              shareEfapDailyPdfForDay(k);
                            }}
                          >
                            <ShareIcon className="h-4 w-4" />
                            <span>Share EFAP</span>
                          </button>

                          {/* Export CSV */}
                          <button
                            className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 flex items-center gap-2 text-sm"
                            onClick={() => {
                              setRowMenuOpen(null);
                              exportOneDayCsv(k);
                            }}
                          >
                            <DownloadIcon className="h-4 w-4" />
                            <span>Export CSV</span>
                          </button>

                          {/* Delete day (if allowed) */}
                          {canDeleteVisits && (
                            <button
                              className="w-full text-left px-3 py-2 rounded-lg text-red-700 hover:bg-red-50 flex items-center gap-2 text-sm"
                              onClick={(e) => {
                                setRowMenuOpen(null);
                                removeDay(k);
                              }}
                            >
                              <TrashIcon className="h-4 w-4" />
                              <span>Delete day</span>
                            </button>
                          )}
                        </div>
                      )}
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
          <div aria-hidden className="absolute left-0 right-0 bottom-0 h-1 rounded-b-2xl bg-gradient-to-r from-brand-500 via-brand-400 to-brand-300 opacity-0 group-hover:opacity-[0.06] transition-opacity pointer-events-none" />
        </aside>

        {/* Table / details */}
<section
  className={
    "lg:col-span-2 group relative rounded-3xl border border-brand-200 ring-1 ring-brand-100 bg-white shadow-sm overflow-hidden " +
    "hover:shadow-[0_12px_28px_-12px_rgba(0,0,0,0.18)] hover:ring-brand-200 hover:border-brand-300 transition"
  }
>
  {/* Header: date + actions (branded gradient header, flush rounded top) */}
  <div className="bg-gradient-to-r from-brand-800 via-brand-700 to-brand-500 px-3 sm:px-4 py-2.5 sm:py-3 text-white">
    <div className="flex items-center justify-between gap-3">
      {/* Title / date */}
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-[0.16em] font-semibold text-white">
          Daily visits
        </p>
        <h2 className="mt-0.5 text-sm sm:text-lg font-semibold leading-snug truncate">
          {selectedDate ? `Visits on ${selectedDate}` : "Select a day"}
        </h2>
      </div>

      {/* Desktop actions (white pills) */}
      <div className="hidden sm:flex items-center gap-2" ref={menuRef}>
        {/* EFAP = solid white pill */}
        <button
          type="button"
          className="inline-flex h-9 items-center gap-2 rounded-full bg-white text-brand-900 px-4 text-[13px] font-semibold border border-gray-200 shadow-sm transition transform hover:scale-[1.03] hover:shadow-lg hover:border-brand-200 active:scale-[0.995] hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-700 focus-visible:ring-brand-200"
          onClick={() => exportEfapDailyPdfForDay(selectedDate)}
          disabled={!selectedDate}
          title="Download EFAP PDF for this day"
          aria-label="EFAP PDF"
        >
          EFAP PDF
        </button>

        {/* Add Visit = white pill */}
        {selectedDate && canLogVisits && (
          <AddVisitButton
            org={org}
            location={location}
            selectedDate={selectedDate}
            onAdded={(v) => setVisits((prev) => [v, ...prev])}
            className={
              "inline-flex h-9 items-center gap-2 rounded-full bg-white text-brand-900 px-4 text-[13px] font-semibold min-w-[110px] " +
              "border border-gray-200 shadow-sm transition transform hover:scale-[1.03] hover:shadow-lg hover:border-brand-200 active:scale-[0.995] hover:bg-brand-50/60 " +
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-700 focus-visible:ring-brand-200"
            }
          />
        )}

        {/* Kebab = white circular icon */}
        <div className="relative">
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-brand-900 border border-gray-200 shadow-sm transition transform hover:scale-[1.03] hover:shadow-lg hover:border-brand-200 active:scale-[0.995] hover:bg-brand-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="More actions"
            title="More actions"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <KebabIcon className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-30 mt-2 w-44 rounded-xl border border-gray-200 bg-white shadow-lg p-1"
            >
              <button
                type="button"
                role="menuitem"
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 flex items-center gap-2 text-sm text-gray-700"
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
                type="button"
                role="menuitem"
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 flex items-center gap-2 text-sm text-gray-700"
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
      </div>
    </div>
  </div>

  {/* Mobile actions: clean stacked layout under the bar */}
  <div className="sm:hidden bg-white/95 px-3 pt-3 pb-2 border-t border-brand-100/70" ref={kebabRef}>
    <div className="grid grid-cols-[1.4fr,1.4fr,0.7fr] gap-2 items-stretch">
      {/* EFAP button */}
      <button
        type="button"
        className={
          "inline-flex items-center justify-center rounded-full border border-gray-200 bg-white text-brand-900 text-[13px] font-semibold shadow-sm h-10 w-full " +
          "transition transform hover:scale-[1.03] hover:shadow-lg hover:border-brand-200 active:scale-[0.995] disabled:opacity-60 disabled:cursor-not-allowed"
        }
        onClick={() => exportEfapDailyPdfForDay(selectedDate)}
        disabled={!selectedDate}
        aria-label="EFAP PDF"
        title="Download EFAP PDF"
      >
        EFAP PDF
      </button>

      {/* Add Visit button */}
      {canLogVisits ? (
        <AddVisitButton
          org={org}
          location={location}
          selectedDate={selectedDate}
          onAdded={(v) => setVisits((prev) => [v, ...prev])}
          className={
            "inline-flex items-center justify-center gap-2 rounded-full min-w-[110px] h-10 " +
            "bg-white text-brand-900 border border-gray-200 px-4 text-[13px] font-semibold shadow-sm " +
            "transition transform hover:scale-[1.03] hover:shadow-lg hover:border-brand-200 active:scale-[0.995] hover:bg-white"
          }
        />
      ) : (
        <div />
      )}

      {/* Kebab button */}
      <div className="relative">
        <button
          type="button"
          className={
            "inline-flex items-center justify-center rounded-full border border-gray-200 bg-white text-brand-900 shadow-sm h-10 w-full " +
            "transition transform hover:scale-[1.03] hover:shadow-lg hover:border-brand-200 active:scale-[0.995] hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
          }
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
            className="absolute right-0 z-30 mt-2 w-44 rounded-xl border border-gray-200 bg-white shadow-lg p-1"
          >
            <button
              type="button"
              role="menuitem"
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 flex items-center gap-2 text-sm text-gray-700"
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
              type="button"
              role="menuitem"
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 flex items-center gap-2 text-sm text-gray-700"
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
    </div>
  </div>



                 {/* Body: filters + summary + table/list with inner padding */}
          <div className="px-3 sm:px-4 md:px-5 pt-4 pb-4 md:pb-5 space-y-3 md:space-y-4">
            {/* Subheading separator above filters (visual polish) */}
            <div className="border-t border-gray-200 pt-4 md:pt-5">
              {/* Filters, compressed: search + two selects + single sort toggle */}
              <div className="flex flex-wrap items-center gap-2 md:gap-3">
                <div className="flex-1 min-w-[190px]">
                  <div className="relative">
                    <input
                      id="table-search"
                      className="w-full rounded-xl border border-gray-300 bg-white pl-10 pr-4 py-2.5 md:py-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                      placeholder="Search…"
                      value={term}
                      onChange={(e) => setTerm(e.target.value)}
                      aria-label="Search"
                    />
                    <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                      <SearchIcon className="h-4 w-4 text-gray-500" />
                    </div>
                  </div>
                </div>

                <select
                  className="rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                  value={usdaFilter}
                  onChange={(e) => setUsdaFilter(e.target.value)}
                  aria-label="USDA filter"
                >
                  <option value="all">USDA</option>
                  <option value="yes">USDA Yes</option>
                  <option value="no">USDA No</option>
                </select>

                <select
                  className="rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
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
                  className={
                    BTN.secondary +
                    " h-10 w-10 md:h-9 md:w-9 px-0 py-0 flex items-center justify-center"
                  }
                  onClick={() =>
                    setSortDir((d) => (d === "asc" ? "desc" : "asc"))
                  }
                  title="Toggle sort direction"
                  aria-label="Toggle sort direction"
                >
                  {sortDir === "asc" ? (
                    <ArrowUp className="h-4 w-4" />
                  ) : (
                    <ArrowDown className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Summary stripe */}
            <div className="mt-1 mb-1 text-sm text-gray-700 flex flex-wrap gap-x-4 gap-y-1">
              <span className="inline-flex items-center gap-1">
                <strong className="tabular-nums">{dayTotals.count}</strong> visit
                {dayTotals.count === 1 ? "" : "s"}
              </span>
              <span className="inline-flex items-center gap-1">
                HH <strong className="tabular-nums">{dayTotals.hh}</strong>
              </span>
              <span className="inline-flex items-center gap-1">
                USDA first-time{" "}
                <strong className="tabular-nums">{dayTotals.usdaYes}</strong>
              </span>
            </div>

            {/* DESKTOP TABLE */}
            <div
              className={`hidden md:block rounded-2xl border border-gray-200 overflow-hidden bg-white shadow-sm ${
                isBusy ? "opacity-60" : ""
              }`}
            >
              <div className="overflow-x-auto">
                <div
                  className="overflow-y-auto desktop-scrollbar"
                  style={{
                    maxHeight: filteredSortedRows.length > 25 ? "780px" : "auto",
                  }}
                >
                  <table className="w-full table-fixed text-sm">
                    {/* column widths tuned for actual content */}
                    <colgroup>
                      <col className="w-[24%]" /> {/* Client */}
                      <col className="w-[26%]" /> {/* County */}
                      <col className="w-[7%]" /> {/* Zip */}
                      <col className="w-[6%]" /> {/* HH */}
                      <col className="w-[7%]" /> {/* USDA */}
                      <col className="w-[18%]" /> {/* Time */}
                      <col className="w-[12%]" /> {/* Actions */}
                    </colgroup>

                    <thead className="bg-gray-100">
                      <tr className="text-left text-[13px]">
                        <th
                          className="px-4 py-2.5 cursor-pointer select-none"
                          aria-sort={ariaSortFor("name")}
                          onClick={() => handleHeaderSort("name")}
                        >
                          Client
                        </th>
                        <th className="px-4 py-2.5">County</th>
                        <th className="px-3.5 py-2.5 text-center">Zip</th>
                        <th
                          className="px-3 py-2.5 text-center cursor-pointer select-none"
                          aria-sort={ariaSortFor("hh")}
                          onClick={() => handleHeaderSort("hh")}
                        >
                          HH
                        </th>
                        <th className="px-3 py-2.5 text-center">USDA</th>
                        <th
                          className="px-4 py-2.5 text-right cursor-pointer select-none"
                          aria-sort={ariaSortFor("time")}
                          onClick={() => handleHeaderSort("time")}
                        >
                          Time
                        </th>
                        <th className="px-3 py-2.5 text-center">Actions</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-gray-200 align-top">
                      {filteredSortedRows.map((r) => (
                        <tr
                          key={r.visitId}
                          className="odd:bg-white even:bg-gray-50 hover:bg-gray-100"
                        >
                          {/* Client */}
                          <td className="px-4 py-3 align-middle">
                            <div className="min-w-0">
                              <div
                                className="font-medium truncate max-w-[210px]"
                                title={r.labelName}
                              >
                                {r.labelName}
                              </div>

                              {r.addedByReports && (
                                <div className="text-[11px] text-gray-400 flex items-center gap-1 mt-0.5">
                                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
                                  <span>Added through Reports</span>
                                </div>
                              )}
                            </div>
                          </td>

                          {/* County */}
                          <td className="px-4 py-3 align-middle">
                            <span
                              className="block truncate max-w-[230px]"
                              title={r.county}
                            >
                              {r.county}
                            </span>
                          </td>

                          {/* Zip */}
                          <td className="px-3.5 py-3 text-center align-middle tabular-nums">
                            {r.zip}
                          </td>

                          {/* HH */}
                          <td className="px-3 py-3 tabular-nums text-center align-middle">
                            {r.visitHousehold}
                          </td>

                          {/* USDA pill */}
                          <td className="px-3 py-3 text-center align-middle">
                            {r.usdaFirstTimeThisMonth === "" ? (
                              ""
                            ) : (
                              <span
                                className={`inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-[11px] leading-none ring-1 ${
                                  r.usdaFirstTimeThisMonth
                                    ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                                    : "bg-gray-50 text-gray-700 ring-gray-200"
                                }`}
                              >
                                {r.usdaFirstTimeThisMonth ? "Yes" : "No"}
                              </span>
                            )}
                          </td>

                          {/* Time + added date */}
                          <td className="px-4 py-3 text-right align-middle">
                            <div className="flex flex-col items-end leading-tight">
                              <span className="text-[12px] font-medium tabular-nums">
                                {r.localTime}
                              </span>

                              {r.addedLocalDate && (
                                <span className="text-[10px] text-gray-500 mt-0.5">
                                  {r.addedLocalDate}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Row actions */}
                          <td className="px-3 py-3 text-center align-middle relative">
                            <div className="relative inline-flex justify-end w-full">
                              <button
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-700 hover:bg-gray-100 transition"
                                onClick={() =>
                                  setRowMenuOpen((prev) =>
                                    prev === r.visitId ? null : r.visitId
                                  )
                                }
                                aria-label="Row menu"
                              >
                                <KebabIcon className="h-5 w-5" />
                              </button>

                              {rowMenuOpen === r.visitId && (
                                <div className="absolute right-0 mt-2 w-40 bg-white rounded-lg border border-gray-200 shadow-lg z-20 p-1">
                                  <button
                                    className="w-full text-left px-3 py-2 rounded-md hover:bg-gray-50 text-sm"
                                    onClick={() => {
                                      setRowMenuOpen(null);
                                      setEditVisit(r);
                                    }}
                                  >
                                    Edit Visit
                                  </button>

                                  {canDeleteVisits && (
                                    <button
                                      className="w-full text-left px-3 py-2 rounded-md text-red-700 hover:bg-red-50 text-sm"
                                      onClick={() => {
                                        setRowMenuOpen(null);
                                        removeVisit(r);
                                      }}
                                    >
                                      Delete Visit
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}

                      {filteredSortedRows.length === 0 && (
                        <tr>
                          <td
                            colSpan={7}
                            className="px-4 py-8 text-center text-gray-500"
                          >
                            {isBusy ? (
                              <span className="inline-flex items-center gap-2">
                                <Spinner className="h-4 w-4" /> Loading…
                              </span>
                            ) : (
                              <div className="flex flex-col items-center gap-2">
                                <div className="text-2xl">🗓️</div>
                                <div>No visits on this day.</div>
                                {canLogVisits && selectedDate ? (
                                  <div className="mt-1">
                                    <AddVisitButton
                                      org={org}
                                      location={location}
                                      selectedDate={selectedDate}
                                      onAdded={(newVisit) =>
                                        setVisits((prev) => [
                                          newVisit,
                                          ...prev,
                                        ])
                                      }
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
                        <td className="px-4 py-2.5">Totals</td>
                        <td />
                        <td />
                        <td className="px-3 py-2.5 text-center tabular-nums">
                          {dayTotals.hh}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {dayTotals.usdaYes} Yes
                        </td>
                        <td />
                        <td className="px-3 py-2.5 text-center tabular-nums">
                          {filteredSortedRows.length} rows
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>

            {/* MOBILE LIST */}
            <ul
              className={`md:hidden rounded-2xl border border-gray-200 overflow-hidden divide-y divide-gray-200 bg-white ${
                isBusy ? "opacity-60" : ""
              }`}
            >
              {filteredSortedRows.map((r, i) => (
                <li
                  key={r.visitId}
                  className="p-3.5 bg-white odd:bg-gray-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {r.labelName}
                      </div>
                      {r.county || r.zip ? (
                        <div className="text-xs text-gray-700 truncate">
                          {r.county || ""}
                          {r.zip ? (r.county ? `, ${r.zip}` : r.zip) : ""}
                        </div>
                      ) : null}

                      <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-gray-700">
                        <span className="px-1.5 py-0.5 rounded border bg-white">
                          HH {r.visitHousehold || 0}
                        </span>
                        {r.usdaFirstTimeThisMonth !== "" && (
                          <span className="px-1.5 py-0.5 rounded border bg-white">
                            {r.usdaFirstTimeThisMonth
                              ? "USDA Yes"
                              : "USDA No"}
                          </span>
                        )}
                      </div>

                      {r.addedByReports && (
                        <div className="mt-0.5 text-[11px] text-gray-400 flex items-center gap-1">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
                          <span>Logged from Reports</span>
                        </div>
                      )}
                    </div>

                    <div className="shrink-0 flex flex-col items-end gap-1 relative">
                      <div className="text-right text-[11px] leading-tight">
                        {r.addedLocalDate && (
                          <div className="font-medium">
                            {r.addedLocalDate}
                          </div>
                        )}
                        <div className="mt-0.5 px-3 py-0.5 rounded border border-gray-300 bg-gray-100 text-gray-800 font-medium tabular-nums">
                          {r.localTime}
                        </div>
                      </div>

                      {/* Mobile row actions – same kebab menu as desktop */}
                      <div className="mt-1 relative">
                        <button
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-700 hover:bg-gray-100"
                          onClick={() =>
                            setRowMenuOpen((prev) =>
                              prev === r.visitId ? null : r.visitId
                            )
                          }
                          aria-label="Row menu"
                          title="More actions"
                        >
                          <KebabIcon className="h-4 w-4" />
                        </button>

                        {rowMenuOpen === r.visitId && (
                          <div className="absolute right-0 mt-2 w-40 bg-white rounded-lg border border-gray-200 shadow-lg z-20 p-1">
                            <button
                              className="w-full text-left px-3 py-2 rounded-md hover:bg-gray-50 text-sm"
                              onClick={() => {
                                setRowMenuOpen(null);
                                setEditVisit(r);
                              }}
                            >
                              Edit Visit
                            </button>

                            {canDeleteVisits && (
                              <button
                                className="w-full text-left px-3 py-2 rounded-md text-red-700 hover:bg-red-50 text-sm"
                                onClick={() => {
                                  setRowMenuOpen(null);
                                  removeVisit(r);
                                }}
                              >
                                Delete Visit
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              ))}

              {filteredSortedRows.length === 0 && (
                <li className="p-6 text-center text-gray-500">
                  {isBusy ? (
                    <span className="inline-flex items-center gap-2">
                      <Spinner className="h-4 w-4" /> Loading…
                    </span>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <div className="text-2xl">🗓️</div>
                      <div>No visits on this day.</div>
                      {canLogVisits && selectedDate ? (
                        <div className="mt-1">
                          <AddVisitButton
                            org={org}
                            location={location}
                            selectedDate={selectedDate}
                            onAdded={(newVisit) =>
                              setVisits((prev) => [newVisit, ...prev])
                            }
                          />
                        </div>
                      ) : null}
                    </div>
                  )}
                </li>
              )}
            </ul>
          </div>



          {/* MOBILE LIST */}
          <ul
            className={`md:hidden divide-y divide-gray-200 rounded-xl border overflow-hidden ${
              isBusy ? "opacity-60" : ""
            }`}
          >

            {filteredSortedRows.map((r, i) => (
              <li
                key={r.visitId}
                className={`p-3 ${i % 2 === 0 ? "bg-gray-50" : "bg-white"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{r.labelName}</div>
                    {r.county || r.zip ? (
                      <div className="text-xs text-gray-700 truncate">
                        {r.county || ""}
                        {r.zip ? (r.county ? `, ${r.zip}` : r.zip) : ""}
                      </div>
                    ) : null}

                    <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-gray-700">
                      <span className="px-1.5 py-0.5 rounded border bg-white">
                        HH {r.visitHousehold || 0}
                      </span>
                      {r.usdaFirstTimeThisMonth !== "" && (
                        <span className="px-1.5 py-0.5 rounded border bg-white">
                          {r.usdaFirstTimeThisMonth ? "USDA Yes" : "USDA No"}
                        </span>
                      )}
                    </div>

                    {r.addedByReports && (
                    <div className="mt-0.5 text-[11px] text-gray-400 flex items-center gap-1">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
                      <span>Logged from Reports</span>
                    </div>
                  )}


                  </div>

                                    <div className="shrink-0 flex flex-col items-end gap-1 relative">
                    <div className="text-right text-[11px] leading-tight">
                      {r.addedLocalDate && (
                        <div className="font-medium">{r.addedLocalDate}</div>
                      )}
                                        <div className="px-3 py-0.5 rounded border border-gray-300 bg-gray-100 text-gray-800 font-medium tabular-nums">
                        {r.localTime}
                      </div>
                    </div>

                    {/* Mobile row actions – same kebab menu as desktop */}
                    <div className="mt-1 relative">
                      <button
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-700 hover:bg-gray-100"
                        onClick={() =>
                          setRowMenuOpen((prev) =>
                            prev === r.visitId ? null : r.visitId
                          )
                        }
                        aria-label="Row menu"
                        title="More actions"
                      >
                        <KebabIcon className="h-4 w-4" />
                      </button>

                      {rowMenuOpen === r.visitId && (
                        <div className="absolute right-0 mt-2 w-40 bg-white rounded-lg border border-gray-200 shadow-lg z-20 p-1">
                          <button
                            className="w-full text-left px-3 py-2 rounded-md hover:bg-gray-50 text-sm"
                            onClick={() => {
                              setRowMenuOpen(null);
                              setEditVisit(r);
                            }}
                          >
                            Edit Visit
                          </button>

                          {canDeleteVisits && (
                            <button
                              className="w-full text-left px-3 py-2 rounded-md text-red-700 hover:bg-red-50 text-sm"
                              onClick={() => {
                                setRowMenuOpen(null);
                                removeVisit(r);
                              }}
                            >
                              Delete Visit
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                </div>
              </li>
            ))}

            {filteredSortedRows.length === 0 && (
              <li className="p-6 text-center text-gray-500">
                                {isBusy ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner className="h-4 w-4" /> Loading…
                  </span>
                ) : (

                  <div className="flex flex-col items-center gap-2">
                    <div className="text-2xl">🗓️</div>
                    <div>No visits on this day.</div>
                    {canLogVisits && selectedDate ? (
                      <div className="mt-1">
                        <AddVisitButton
                          org={org}
                          location={location}
                          selectedDate={selectedDate}
                          onAdded={(newVisit) =>
                            setVisits((prev) => [newVisit, ...prev])
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                )}
              </li>
            )}
          </ul>
          <div aria-hidden className="absolute left-0 right-0 bottom-0 h-1 rounded-b-2xl bg-gradient-to-r from-brand-500 via-brand-400 to-brand-300 opacity-0 group-hover:opacity-[0.06] transition-opacity pointer-events-none" />
        </section>
      </div>

      {/* Error helper (index enable hint if present) */}
      {!!error && (
        <div className="mt-4 p-3 rounded-xl bg-amber-50 text-amber-900 text-sm">
          {error}
        </div>
      )}

      {/* Edit Visit Modal */}
      {editVisit && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setEditVisit(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-4">Edit Visit</h2>

            <div className="space-y-4">
              {/* Household size */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  Household Size
                </label>
                <input
                  type="number"
                  min="0"
                  className="w-full rounded-lg border px-4 py-2.5 text-sm"
                  value={editVisit.visitHousehold}
                  onChange={(e) =>
                    setEditVisit((prev) => ({
                      ...prev,
                      visitHousehold: Number(e.target.value || 0),
                    }))
                  }
                />
              </div>

              {/* County (visit-level only) */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  County (this visit only)
                </label>
                <input
                  type="text"
                  className="w-full rounded-lg border px-4 py-2.5 text-sm"
                  value={editVisit.county || ""}
                  onChange={(e) =>
                    setEditVisit((prev) => ({
                      ...prev,
                      county: e.target.value,
                    }))
                  }
                  placeholder="e.g., Los Angeles County"
                />
              </div>

              {/* Zip (visit-level only) */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  Zip (this visit only)
                </label>
                <input
                  type="text"
                  className="w-full rounded-lg border px-4 py-2.5 text-sm"
                  value={editVisit.zip || ""}
                  onChange={(e) =>
                    setEditVisit((prev) => ({
                      ...prev,
                      zip: e.target.value,
                    }))
                  }
                  placeholder="e.g., 90813"
                />
              </div>

              {/* USDA flag */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  USDA First Time This Month
                </label>
                <select
                  className="w-full rounded-lg border px-4 py-2.5 text-sm bg-white"
                  value={
                    editVisit.usdaFirstTimeThisMonth === true
                      ? "yes"
                      : editVisit.usdaFirstTimeThisMonth === false
                      ? "no"
                      : ""
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    setEditVisit((prev) => ({
                      ...prev,
                      usdaFirstTimeThisMonth:
                        val === "yes" ? true : val === "no" ? false : "",
                    }));
                  }}
                >
                  <option value="">—</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-800 hover:bg-gray-200"
                onClick={() => setEditVisit(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm rounded-lg bg-brand-700 text-white hover:bg-brand-800"
                onClick={async () => {
                  try {
                    // write ONLY to visits collection (snapshot fields)
                    await updateDoc(doc(db, "visits", editVisit.visitId), {
                      householdSize: editVisit.visitHousehold,
                      usdaFirstTimeThisMonth: editVisit.usdaFirstTimeThisMonth,
                      clientCounty: editVisit.county || "",
                      clientZip: editVisit.zip || "",
                    });

                    // keep local state in sync
                    setVisits((prev) =>
                      prev.map((v) =>
                        v.id === editVisit.visitId
                          ? {
                              ...v,
                              householdSize: editVisit.visitHousehold,
                              usdaFirstTimeThisMonth:
                                editVisit.usdaFirstTimeThisMonth,
                              clientCounty: editVisit.county || "",
                              clientZip: editVisit.zip || "",
                            }
                          : v
                      )
                    );

                    toast.show("Visit updated.", "info");
                    setEditVisit(null);
                  } catch (e) {
                    console.error(e);
                    alert("Failed to update visit. Please try again.");
                  }
                }}
              >
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}


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
        @keyframes fadeInOut { 
          0% { opacity: .55; transform: scale(.98); } 
          30% { opacity: 1; transform: scale(1); } 
          100% { opacity: .9; transform: scale(1); } 
        }
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
    "transition transform hover:scale-[1.01] hover:shadow-md hover:border-brand-300 active:scale-[0.995] " +
    "hover:bg-brand-50 active:bg-brand-100 focus:outline-none focus:ring-2 focus:ring-brand-300",

  icon:
    "inline-flex h-10 w-10 items-center justify-center rounded-xl border border-brand-200 " +
    "bg-white text-brand-900 transition transform hover:scale-[1.01] hover:shadow-md hover:border-brand-300 active:scale-[0.995] " +
    "hover:bg-brand-50 active:bg-brand-100",

  smallIcon:
    "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-brand-200 " +
    "bg-white text-brand-900 transition transform hover:scale-[1.01] hover:shadow-md hover:border-brand-300 active:scale-[0.995] " +
    "hover:bg-brand-50 active:bg-brand-100",
};

function Card({ title, children }) {
  return (
    <div
      className={
        "group relative rounded-2xl border border-brand-200 ring-1 ring-brand-100 bg-white shadow-sm p-3 sm:p-4 " +
        "hover:shadow-[0_12px_28px_-12px_rgba(0,0,0,0.18)] hover:ring-brand-200 hover:border-brand-300 " +
        "transition will-change-transform hover:scale-[1.01] active:scale-[.995]"
      }
    >
      {title ? (
        <div className="-mx-4 sm:-mx-4 -mt-4 mb-2 rounded-t-2xl overflow-hidden">
          <div className="bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 px-4 sm:px-5 py-2 text-white text-sm font-semibold flex items-center gap-3 border-b border-white/20 shadow-inner">
            <span className="h-2.5 w-2.5 rounded-full bg-white/30 ring-1 ring-white/20" aria-hidden />
            <span className="truncate">{title}</span>
          </div>
        </div>
      ) : null}

      {children}

      {/* subtle gradient highlight bar that appears at the bottom on hover */}
      <div
        aria-hidden
        className="absolute left-0 right-0 bottom-0 h-1 rounded-b-2xl bg-gradient-to-r from-brand-500 via-brand-400 to-brand-300 opacity-0 group-hover:opacity-[0.06] transition-opacity pointer-events-none"
      />
    </div>
  );
}

function KpiModern({ title, value, sub }) {
  return (
    <div
      className="
        rounded-2xl border ring-1 bg-white shadow-soft p-4 sm:p-5
        border-brand-200 ring-brand-100
        hover:shadow-[0_12px_28px_-12px_rgba(0,0,0,0.18)]
        hover:ring-brand-200
        hover:border-brand-300
        transition will-change-transform
        hover:scale-[1.01] active:scale-[.995]
      "
      role="status"
      aria-live="polite"
    >
      <div className="text-xs sm:text-sm text-gray-600 mb-2">{title}</div>
      <div className="flex items-end gap-2">
        <div className="text-2xl sm:text-3xl font-semibold tabular-nums tracking-tight">
          {value ?? "—"}
        </div>
        {sub ? (
          <div className="text-[11px] sm:text-xs text-gray-500 mb-0.5">
            {sub}
          </div>
        ) : null}
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
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
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
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}
function ChevronDown({ className = "h-4 w-4" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
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
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  );
}
function ArrowDown({ className = "h-4 w-4" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12l7 7 7-7" />
    </svg>
  );
}

/* ---------- helpers ---------- */
function extractIndexHelp(err) {
  const msg = String(err?.message || "");
  const urlMatch = msg.match(
    /https:\/\/console\.firebase\.google\.com\/[^\s)]+/i
  );
  if (err?.code === "failed-precondition" && urlMatch) {
    return `A Firestore index is required for this query. Click "Enable index" → ${urlMatch[0]}`;
  }
  return "";
}
