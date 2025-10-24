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
  runTransaction,
  serverTimestamp,
  limit as qLimit,
  startAt,
  endAt,
} from "firebase/firestore";

// 🔐 project paths
import { db, auth } from "../lib/firebase";
// NOTE: useAuth is a DEFAULT export in your app
import useAuth from "../auth/useAuth";

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

/* ---------- Lightweight Monthly PDF using pdf-lib (kept for share action) ---------- */
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

/* ---------- Month navigator (centered pill) ---------- */
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
    <div className="inline-flex items-center gap-2 sm:gap-3 rounded-2xl ring-1 ring-brand-200 bg-white shadow-sm px-2.5 sm:px-3 py-1.5 sm:py-2">
      <button
        onClick={() => jump(-1)}
        className={iconBtn}
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

      <div className="min-w-[150px] text-center">
        <span className="text-base sm:text-lg font-semibold tracking-tight">
          {label}
        </span>
      </div>

      <button
        onClick={() => jump(1)}
        className={iconBtn}
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
   PAGE COMPONENT
   ======================================================================================= */
export default function Reports() {
  const routeLocation = useRouteLocation();
  const { loading: authLoading, org, location, isAdmin, email } =
    useAuth() || {};

  // UI/state
  const [exportingPdf, setExportingPdf] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedMonthKey, setSelectedMonthKey] = useState(
    monthKeyFor(new Date())
  );
  const [selectedDate, setSelectedDate] = useState(fmtDateKey(new Date()));
  const [visits, setVisits] = useState([]);
  const [clientsById, setClientsById] = useState(new Map());

  // live-ish status
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [syncAgo, setSyncAgo] = useState("");
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

  // UI state
  const dayListRef = useRef(null);
  const [dayFilter, setDayFilter] = useState("");
  const [term, setTerm] = useState("");
  const [usdaFilter, setUsdaFilter] = useState("all"); // all|yes|no
  const [sortKey, setSortKey] = useState("time"); // time|name|hh
  const [sortDir, setSortDir] = useState("desc"); // asc|desc

  // add visit modal
  const [addOpen, setAddOpen] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  theAddCandidatesFix();
  const [addCandidates, setAddCandidates] = useState([]);
  const [addHH, setAddHH] = useState(1);
  const [addUSDA, setAddUSDA] = useState(true);
  const [addBusy, setAddBusy] = useState(false);

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
     Index-friendly with existing composites:
       - visits: (orgId, locationId, dateKey ASC)
       - visits: (orgId, dateKey ASC)
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
    // Volunteers are scoped to active location; admins may see all
    const effectiveLocationId = location?.id && !isAdmin ? location.id : null;
    if (effectiveLocationId) filters.push(where("locationId", "==", effectiveLocationId));

    // Use dateKey range
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
        const ids = Array.from(
          new Set(visits.map((v) => v.clientId).filter(Boolean))
        );
        if (!ids.length) {
          setClientsById(new Map());
          return;
        }
        const m = new Map();
        for (const part of chunk(ids, 10)) {
          const qs = await getDocs(
            query(collection(db, "clients"), where("__name__", "in", part))
          );
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
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ block: "nearest" });
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
      else if (sortKey === "name")
        d = (a.labelName || "").localeCompare(b.labelName || "");
      else if (sortKey === "hh")
        d =
          Number(a.visitHousehold || 0) - Number(b.visitHousehold || 0);
      return sortDir === "asc" ? d : -d;
    };
    return [...rows].sort(cmp);
  }, [rowsForSelectedDay, term, usdaFilter, sortKey, sortDir]);

  /* --------------------------------
     Day totals
     -------------------------------- */
  const dayTotals = useMemo(() => {
    const count = filteredSortedRows.length;
    const hh = filteredSortedRows.reduce(
      (s, r) => s + Number(r.visitHousehold || 0),
      0
    );
    const usdaYes = filteredSortedRows.reduce(
      (s, r) => s + (r.usdaFirstTimeThisMonth === true ? 1 : 0),
      0
    );
    return { count, hh, usdaYes };
  }, [filteredSortedRows]);

  /* --------------------------------
     Month aggregates (KPI + charts)
     -------------------------------- */
  const monthAgg = useMemo(() => {
    const totalHH = visits.reduce(
      (s, v) => s + Number(v.householdSize || 0),
      0
    );
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
        people: arr.reduce(
          (s, v) => s + Number(v.householdSize || 0),
          0
        ),
        usdaYes: arr.reduce(
          (s, v) => s + (v.usdaFirstTimeThisMonth === true ? 1 : 0),
          0
        ),
      }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    const usdaYesTotal = visits.filter(
      (v) => v.usdaFirstTimeThisMonth === true
    ).length;
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
     Actions (scoped + admin guarding)
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
          p.address ||
          p.addr ||
          p.street ||
          p.street1 ||
          p.line1 ||
          p.address1 ||
          "";
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

  const exportEfapDailyPdfForDay = useCallback(
    async (dayKey) => {
      try {
        const src = visitsByDay.get(dayKey) || [];
        const rows = src.map((v) => {
          const p = clientsById.get(v.clientId) || {};
          const name =
            `${p.firstName || ""} ${p.lastName || ""}`.trim() ||
            v.clientId ||
            "";
          const address =
            p.address ||
            p.addr ||
            p.street ||
            p.street1 ||
            p.line1 ||
            p.address1 ||
            "";
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
        const pdfBytes = await buildEfapDailyPdf(rows, { dateStamp: dayKey });
        const fileName = efapSuggestedFileName(dayKey);
        downloadBytes(pdfBytes, fileName, "application/pdf");
        toast.show("EFAP PDF downloaded.", "info");
      } catch (e) {
        console.error("EFAP build/download failed:", e);
        alert("Couldn’t build the EFAP PDF for that day.");
      }
    },
    [visitsByDay, clientsById, toast]
  );

  const shareEfapDailyPdfForDay = useCallback(
    async (dayKey) => {
      try {
        const src = visitsByDay.get(dayKey) || [];
        const rows = src.map((v) => {
          const p = clientsById.get(v.clientId) || {};
          const name =
            `${p.firstName || ""} ${p.lastName || ""}`.trim() ||
            v.clientId ||
            "";
          const address =
            p.address ||
            p.addr ||
            p.street ||
            p.street1 ||
            p.line1 ||
            p.address1 ||
            "";
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
        const pdfBytes = await buildEfapDailyPdf(rows, { dateStamp: dayKey });
        const fileName = efapSuggestedFileName(dayKey);
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
    [visitsByDay, clientsById, toast]
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
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto overflow-visible">
      {/* ===== Toolbar ===== */}
      <div className="border-b border-brand-100 bg-white">
        <div className="px-3 sm:px-0 py-3 sm:py-4">
          <div className="grid items-center gap-3 lg:grid-cols-[1fr,auto,1fr]">
            {/* Left: Title + scope */}
            <div className="flex items-center gap-3">
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">
                Reports
              </h1>
              <span
                className="hidden sm:inline h-5 w-px bg-brand-200"
                aria-hidden="true"
              />
              <span className="hidden sm:inline text-xs text-gray-600">
                <strong className="font-semibold">
                  {org?.name || "—"}
                </strong>
                {location?.name ? (
                  <>
                    <span className="opacity-60"> / </span>
                    <strong className="font-semibold">
                      {location.name}
                    </strong>
                  </>
                ) : (
                  <span className="opacity-70"> (all locations)</span>
                )}
              </span>
            </div>

            {/* Center: month nav */}
            <div className="justify-self-center">
              <ReportsMonthNav
                monthKey={selectedMonthKey}
                setMonthKey={setSelectedMonthKey}
                setSelectedDate={setSelectedDate}
              />
            </div>

            {/* Right: export monthly */}
            <div className="justify-self-end">
              <div className="flex items-center gap-2">
                

                <span className="hidden md:inline text-xs text-gray-500">
                  Synced {syncAgo || "—"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ===== KPI Row ===== */}
      <div className="mt-4">
        <div className="-mx-4 sm:mx-0">
          <div className="overflow-x-auto overflow-y-visible md:overflow-visible no-scrollbar scroll-px-4 py-1">
            <div
              className="
                px-4 md:px-0
                grid grid-flow-col
                auto-cols-[85%] xs:auto-cols-[60%] sm:auto-cols-[minmax(0,1fr)]
                md:grid-flow-row md:grid-cols-4
                gap-3 sm:gap-4 md:gap-5
                snap-x md:snap-none
              "
            >
              <div className="snap-start md:snap-none flex-none">
                <KpiModern title="Total Visits (Month)" value={visits.length} />
              </div>

              <div className="snap-start md:snap-none flex-none">
                <KpiModern
                  title="Households Totals (Month)"
                  value={monthAgg.households}
                />
              </div>

              <div className="snap-start md:snap-none flex-none">
                <KpiModern
                  title="USDA Yes First-Time (Month)"
                  value={monthAgg.charts?.usdaPie?.[0]?.value ?? 0}
                />
              </div>

              <div className="snap-start md:snap-none flex-none">
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

      {/* ===== Charts ===== */}
      <div className="grid gap-4 sm:gap-5 lg:gap-6 md:grid-cols-3 mb-6 sm:mb-8">
        {/* Visits per Day */}
        <Card title="Visits per Day">
          <div className="h-[260px] flex items-center justify-center px-3 sm:px-4">
            <ResponsiveContainer width="98%" height="95%">
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
                  label={({ name, percent }) =>
                    `${name} ${(percent * 100).toFixed(0)}%`
                  }
                  labelLine={false}
                >
                  {monthAgg.charts.usdaPie.map((_, i) => (
                    <Cell
                      key={i}
                      fill={i === 0 ? "#991b1b" : "#fecaca"}
                      stroke="#fff"
                      strokeWidth={1.5}
                    />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipBoxStyle} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* People Served by Day */}
        <Card title="Household # Served by Day">
          <div className="h-[260px] flex items-center justify-center px-3 sm:px-4">
            <ResponsiveContainer width="98%" height="95%">
              <BarChart
                data={monthAgg.charts.visitsPerDay}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                barCategoryGap={10}
              >
                <defs>
                  <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#991b1b" stopOpacity={1} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0.7} />
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
                <Tooltip cursor={false} contentStyle={tooltipBoxStyle} />
                <Bar
                  dataKey="people"
                  fill="url(#barGradient)"
                  radius={[10, 10, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* ===== Layout: days list + table ===== */}
      <div className="mt-6 sm:mt-8 grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 print:block">
        {/* Days list */}
        <aside className="rounded-2xl ring-1 ring-brand-200 bg-white shadow-sm p-3 print:hidden lg:col-span-1">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <div className="font-semibold">
              Days in {monthLabel(selectedMonthKey)}
            </div>
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
                        {items.length} visit{items.length === 1 ? "" : "s"} •
                        HH {dayHH} • USDA {dayUsda}
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
                        title="Download EFAP PDF"
                        aria-label={`Download EFAP PDF for ${k}`}
                      >
                        EFAP
                      </button>
                    </div>
                  </li>
                );
              })}

              {!sortedDayKeys.length && (
                <li className="py-3 px-2 text-sm text-gray-600">
                  No days found for this month.
                </li>
              )}
            </ul>
          </div>
        </aside>

        {/* Table / details */}
        <section className="lg:col-span-2 rounded-2xl ring-1 ring-brand-200 bg-white shadow-sm p-3">
          {/* Header: date + actions */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
            <div className="font-semibold text-base sm:text-lg">
              {selectedDate ? `Visits on ${selectedDate}` : "Select a day"}
            </div>

            <div className="flex flex-wrap items-center gap-2">
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

              {selectedDate && isAdmin && (
                <button
                  onClick={async () => {
                    setAddOpen(true);
                    setAddBusy(true);
                    try {
                      // Tenant-scoped client list
                      const filters = [where("orgId", "==", org.id)];
                      if (location?.id)
                        filters.push(where("locationId", "==", location.id));
                      // Order by firstName to match existing client indexes
                      const snap = await getDocs(
                        query(
                          collection(db, "clients"),
                          ...filters,
                          orderBy("firstName"),
                          qLimit(200)
                        )
                      );
                      const rows = snap.docs.map((d) => ({
                        id: d.id,
                        ...d.data(),
                      }));
                      setAddCandidates(rows);
                      setAddHH(1);
                      setAddUSDA(true);
                      setAddSearch("");
                    } catch (e) {
                      console.error(e);
                      alert("Couldn’t load clients to add.");
                      setAddOpen(false);
                    } finally {
                      setAddBusy(false);
                    }
                  }}
                  title="Add a visit to this day"
                  className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold bg-brand-700 text-white shadow-sm hover:bg-brand-800 active:bg-brand-900 active:scale-[.98] border border-brand-800/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  aria-label="Add visit"
                >
                  <PlusIcon className="h-4 w-4 shrink-0" />
                  Add Visit
                </button>
              )}
            </div>
          </div>

          {/* Filters */}
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
                onClick={() =>
                  setSortDir((d) => (d === "asc" ? "desc" : "asc"))
                }
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
              <strong>{dayTotals.count}</strong> visit
              {dayTotals.count === 1 ? "" : "s"}
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
                  <tr
                    key={r.visitId}
                    className="odd:bg-white even:bg-gray-50 hover:bg-gray-100"
                  >
                    <td className="px-4 py-3 break-words">
                      <div className="font-medium">{r.labelName}</div>
                      {r.addedByReports && r.addedLocalTime ? (
                        <div className="mt-0.5 text-xs text-gray-500">
                          added {r.addedLocalTime}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 break-words">{r.address}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{r.zip}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {r.visitHousehold}
                    </td>
                    <td className="px-4 py-3">
                      {r.usdaFirstTimeThisMonth === ""
                        ? ""
                        : r.usdaFirstTimeThisMonth
                        ? "Yes"
                        : "No"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-[13px] text-gray-700">
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
                        <span className="text-[11px] text-gray-500">
                          view-only
                        </span>
                      )}
                    </td>
                  </tr>
                ))}

                {filteredSortedRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-6 text-center text-gray-500"
                    >
                      {loading ? "Loading…" : "No visits on this day."}
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
                  <td className="px-4 py-2">
                    {filteredSortedRows.length} rows
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* MOBILE LIST */}
          <ul className="md:hidden divide-y divide-gray-200 rounded-xl border overflow-hidden">
            {filteredSortedRows.map((r, i) => (
              <li
                key={r.visitId}
                className={`p-3 ${i % 2 === 0 ? "bg-gray-50" : "bg-white"}`}
              >
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
                      <span className="px-1.5 py-0.5 rounded border bg-white">
                        HH {r.visitHousehold || 0}
                      </span>
                      {r.usdaFirstTimeThisMonth !== "" && (
                        <span className="px-1.5 py-0.5 rounded border bg-white">
                          {r.usdaFirstTimeThisMonth ? "USDA Yes" : "USDA No"}
                        </span>
                      )}
                    </div>

                    {r.addedByReports && r.addedLocalTime ? (
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        Added {r.addedLocalTime}
                      </div>
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
              <li className="p-6 text-center text-gray-500">
                {loading ? "Loading…" : "No visits on this day."}
              </li>
            )}
          </ul>
        </section>
      </div>

      {/* Add Visit Modal — bottom sheet (TENANT-SCOPED & CONCURRENCY-SAFE) */}
      {addOpen && (
        <div className="fixed inset-0 z-50">
          <button
            className="absolute inset-0 bg-black/45"
            onClick={() => setAddOpen(false)}
            aria-label="Close add modal"
          />
          <div
            role="dialog"
            aria-modal="true"
            className="absolute left-1/2 -translate-x-1/2 w-full sm:w-[min(640px,94vw)] bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden bottom-0 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 rounded-t-2xl sm:rounded-2xl h-[88svh] sm:h-auto max-h-[100svh] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] flex flex-col"
          >
            <div className="sm:hidden flex justify-center pt-2">
              <div className="h-1.5 w-10 rounded-full bg-gray-300" />
            </div>

            <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b">
              <div className="min-w-0">
                <h2 className="text-base sm:text-lg font-semibold truncate">
                  Add visit
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  to <span className="font-medium">{selectedDate}</span>
                </p>
              </div>
              <button
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl hover:bg-gray-100 active:scale-[.98] transition"
                onClick={() => setAddOpen(false)}
                aria-label="Close"
                title="Close"
              >
                ✕
              </button>
            </div>

            <div className="px-4 sm:px-5 py-3 border-b">
              <div className="grid gap-3 sm:grid-cols-3 items-center">
                <label className="sm:col-span-2 block">
                  <span className="text-[11px] font-medium text-gray-700">
                    Find client
                  </span>
                  <div className="mt-1 relative">
                    <input
                      className="w-full rounded-2xl border px-4 pl-11 py-3 h-12 text-[15px] focus:outline-none focus:ring-2 focus:ring-brand-400"
                      placeholder="Search name or address…"
                      value={addSearch}
                      onChange={(e) => setAddSearch(e.target.value)}
                      autoFocus
                    />
                    <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                  </div>
                </label>

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3 sm:gap-4">
                  <div className="flex items-center gap-3">
                    <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
                      Household size:
                    </label>
                    <div className="inline-flex items-center rounded-full border bg-white overflow-hidden shadow-sm">
                      <button
                        className="h-10 w-10 text-lg font-semibold hover:bg-gray-100 active:scale-[.98]"
                        onClick={() => setAddHH((n) => Math.max(1, Number(n) - 1))}
                        aria-label="Decrease household size"
                      >
                        –
                      </button>
                      <div className="px-3 text-sm font-semibold tabular-nums min-w-[2ch] text-center select-none">
                        {addHH}
                      </div>
                      <button
                        className="h-10 w-10 text-lg font-semibold hover:bg-gray-100 active:scale-[.98]"
                        onClick={() => setAddHH((n) => Math.min(20, Number(n) + 1))}
                        aria-label="Increase household size"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
                    <input
                      type="checkbox"
                      checked={addUSDA}
                      onChange={(e) => setAddUSDA(e.target.checked)}
                      className="h-4 w-4 accent-brand-700 rounded focus:ring-2 focus:ring-brand-400"
                    />
                    <span className="select-none">First time this month</span>
                  </label>
                </div>
              </div>
            </div>

            <div
              className="flex-1 overflow-auto"
              style={{ WebkitOverflowScrolling: "touch" }}
            >
              {addBusy ? (
                <div className="p-6 text-sm text-gray-600 flex items-center gap-2">
                  <Spinner className="h-5 w-5" /> Loading…
                </div>
              ) : (
                <ul className="divide-y">
                  {addCandidates
                    .filter((c) => {
                      const q = addSearch.trim().toLowerCase();
                      if (!q) return true;
                      const full = `${c.firstName || ""} ${
                        c.lastName || ""
                      }`.toLowerCase();
                      const addr = (c.address || "").toLowerCase();
                      return (
                        full.includes(q) ||
                        addr.includes(q) ||
                        (c.zip || "").includes(q)
                      );
                    })
                    .slice(0, 120)
                    .map((c) => {
                      const initials = `${(c.firstName || "").slice(
                        0,
                        1
                      )}${(c.lastName || "").slice(0, 1)}`.toUpperCase();
                      return (
                        <li key={c.id} className="p-3 sm:p-4 hover:bg-gray-50">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="h-10 w-10 rounded-full bg-brand-100 text-brand-900 flex items-center justify-center text-sm font-semibold shrink-0">
                                {initials || "?"}
                              </div>
                              <div className="min-w-0">
                                <div className="font-medium truncate text-[15px]">
                                  {(c.firstName || "") +
                                    " " +
                                    (c.lastName || "")}
                                </div>
                                <div className="text-xs text-gray-700 truncate">
                                  {(c.address || "")}{" "}
                                  {c.zip ? `• ${c.zip}` : ""}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 shrink-0">
                              <span className="text-xs text-gray-500 hidden sm:inline">
                                HH {addHH} • {addUSDA ? "USDA" : "Non-USDA"}
                              </span>
                              <button
                                className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold bg-brand-700 text-white shadow-sm hover:bg-brand-800 active:bg-brand-900 active:scale-[.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                                onClick={async () => {
                                  if (!c || !selectedDate || !org?.id) return;
                                  setAddBusy(true);
                                  try {
                                    const mk = selectedMonthKey;
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
                                    const latestHH = Math.max(
                                      1,
                                      Math.min(20, Number(addHH || 1))
                                    );
                                    const isFirst = !!addUSDA;
                                    const currentUser =
                                      auth.currentUser?.uid || null;
                                    const locId = location?.id || null;

                                    // BULLETPROOF CONCURRENCY:
                                    await runTransaction(db, async (tx) => {
                                      // unique sentinel for "first this month": usda_first/{clientId_monthKey}
                                      const sentinelId = `${c.id}_${mk}`;
                                      const usdaFirstRef = doc(
                                        db,
                                        "usda_first",
                                        sentinelId
                                      );
                                      const usdaFirstSnap = await tx.get(
                                        usdaFirstRef
                                      );

                                      // visit doc
                                      const visitRef = doc(collection(db, "visits"));
                                      tx.set(visitRef, {
                                        clientId: c.id,
                                        clientFirstName: c.firstName || "",
                                        clientLastName: c.lastName || "",
                                        orgId: org.id,
                                        locationId: locId,
                                        createdBy: currentUser,
                                        visitAt: when,
                                        dateKey: selectedDate,
                                        monthKey: mk,
                                        householdSize: latestHH,
                                        usdaFirstTimeThisMonth: isFirst,
                                        addedByReports: true,
                                        addedAt: serverTimestamp(),
                                      });

                                      // idempotent-usda-first marker
                                      if (isFirst && !usdaFirstSnap.exists()) {
                                        tx.set(usdaFirstRef, {
                                          clientId: c.id,
                                          orgId: org.id,
                                          monthKey: mk,
                                          locationId: locId || null,
                                          createdAt: serverTimestamp(),
                                          createdByUserId: currentUser || null,
                                        });
                                      }

                                      // partial client refresh (keep tenant scope stable)
                                      const clientRef = doc(db, "clients", c.id);
                                      tx.set(
                                        clientRef,
                                        {
                                          orgId: c.orgId ?? org.id,
                                          locationId: c.locationId ?? locId,
                                          householdSize: latestHH,
                                          usdaLastSeenMonth: mk,
                                          lastVisitAt: serverTimestamp(),
                                          updatedAt: serverTimestamp(),
                                        },
                                        { merge: true }
                                      );
                                    });

                                    // Optimistic UI
                                    setVisits((prev) => [
                                      {
                                        id: crypto.randomUUID(),
                                        clientId: c.id,
                                        clientFirstName: c.firstName || "",
                                        clientLastName: c.lastName || "",
                                        orgId: org.id,
                                        locationId: locId,
                                        visitAt: when,
                                        dateKey: selectedDate,
                                        monthKey: mk,
                                        householdSize: Number(latestHH),
                                        usdaFirstTimeThisMonth: isFirst,
                                        addedByReports: true,
                                        addedAt: new Date(),
                                      },
                                      ...prev,
                                    ]);
                                    setAddOpen(false);
                                    toast.show("Visit added.", "info");
                                  } catch (e) {
                                    console.error(e);
                                    alert(
                                      "Failed to add visit. Please try again."
                                    );
                                  } finally {
                                    setAddBusy(false);
                                  }
                                }}
                                disabled={addBusy}
                                title="Add this client"
                              >
                                <CheckIcon className="h-4 w-4" />
                                Add
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  {addCandidates.length === 0 && (
                    <li className="p-6 text-sm text-gray-600">
                      No clients found.
                    </li>
                  )}
                </ul>
              )}
            </div>

            <div className="px-4 sm:px-5 py-3 border-t bg-white">
              <div className="flex items-center justify-end gap-2">
                <button
                  className="h-11 px-5 rounded-xl border hover:bg-gray-50 active:scale-[.98] transition"
                  onClick={() => setAddOpen(false)}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error helper (index enable hint if present) */}
      {!!error && (
        <div className="mt-4 p-3 rounded-xl bg-amber-50 text-amber-900 text-sm">
          {error}
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

const tooltipBoxStyle = {
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
  padding: "8px 12px",
};

function Card({ title, children }) {
  return (
    <div className="rounded-2xl ring-1 ring-brand-200 bg-white shadow-sm p-3 sm:p-4">
      <div className="text-sm font-semibold mb-2">{title}</div>
      {children}
    </div>
  );
}

function KpiModern({ title, value, sub }) {
  return (
    <div className="rounded-2xl ring-1 ring-rose-200 bg-white shadow-sm p-4 sm:p-5">
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

function PlusIcon({ className = "h-4 w-4" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
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
      strokeLinecap="round"
      strokeLinejoin="round"
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

function CheckIcon({ className = "h-4 w-4" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6L9 17l-5-5" />
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

/* ---------- helpers ---------- */
function extractIndexHelp(err) {
  // Firestore throws a 'failed-precondition' with an "create index" URL.
  const msg = String(err?.message || "");
  const urlMatch = msg.match(/https:\/\/console\.firebase\.google\.com\/[^\s)]+/i);
  if (err?.code === "failed-precondition" && urlMatch) {
    return `A Firestore index is required for this query. Click "Enable index" → ${urlMatch[0]}`;
  }
  return "";
}

// tiny no-op used to clearly mark we applied the "addCandidates orderBy fix"
function theAddCandidatesFix() {}
