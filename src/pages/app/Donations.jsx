// src/pages/Donations.jsx
// Shepherd's Table Cloud — Donations (cash + in-kind, 2025)
//
// - Org/location scoped view into "donations" collection
// - KPIs: total gifts, cash this month, in-kind value, distinct donors
// - Search + filters (type, date range shortcut)
// - CSV export
// - Simple "Log donation" sheet (cash / in-kind) with donor + notes
// - Capability-aware: uses hasCapability("donations") / "manageDonations"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../../lib/firebase";
import useAuth from "../../auth/useAuth";

const shellCls =
  "px-4 sm:px-6 lg:px-8 pt-2 sm:pt-3 max-w-7xl mx-auto overflow-visible";

const cardCls =
  "rounded-2xl border border-brand-200 ring-1 ring-brand-100 bg-white shadow-soft shadow-[0_18px_40px_rgba(148,27,21,0.06)]";

const BTN = {
  primary:
    "inline-flex items-center justify-center gap-2 h-10 px-4 rounded-full text-sm font-semibold text-white " +
    "bg-gradient-to-r from-[color:var(--brand-700)] to-[color:var(--brand-600)] " +
    "hover:from-[color:var(--brand-800)] hover:to-[color:var(--brand-700)] " +
    "active:from-[color:var(--brand-900)] active:to-[color:var(--brand-800)] " +
    "shadow-[0_12px_24px_rgba(199,58,49,0.40)] border border-brand-800/10 transition-all active:scale-[0.97]",
  ghost:
    "inline-flex items-center justify-center gap-2 h-9 px-3 rounded-full text-xs font-medium " +
    "text-gray-700 bg-white hover:bg-gray-50 border border-gray-200",
};

const formatCurrency = (v) => {
  if (!Number.isFinite(Number(v))) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(Number(v));
  } catch {
    return `$${Number(v).toFixed(0)}`;
  }
};

const formatDateTime = (ts) => {
  if (!ts) return "—";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString();
  } catch {
    return "—";
  }
};

const tokensOf = (s = "") =>
  s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

export default function Donations() {
  const {
    loading,
    org,
    location,
    isAdmin,
    hasCapability,
    canPickAllLocations = false,
  } = useAuth() || {};

  const orgId = org?.id ?? null;
  const locId = location?.id ?? null;
  const isAll = isAdmin && locId === "";

  const canViewDonations =
    hasCapability?.("donations") ?? isAdmin ?? false;
  const canManageDonations =
    hasCapability?.("manageDonations") ?? isAdmin ?? false;

  const [donations, setDonations] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [typeFilter, setTypeFilter] = useState("all"); // all | cash | inkind
  const [term, setTerm] = useState("");
  const [range, setRange] = useState("month"); // month | all

  const [sheet, setSheet] = useState({
    open: false,
  });

  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const showToast = useCallback((msg, kind = "info") => {
    window.clearTimeout(toastTimer.current);
    setToast({ msg, kind });
    toastTimer.current = window.setTimeout(
      () => setToast(null),
      2600
    );
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(toastTimer.current);
    },
    []
  );

  // Live donation feed
  useEffect(() => {
    setDonations([]);
    setError("");

    if (loading) return;
    if (!orgId) return;

    if (!isAdmin && !locId) {
      setError("Choose a location to view donations.");
      return;
    }

    const filters = [where("orgId", "==", orgId)];
    if (!isAll && locId) filters.push(where("locationId", "==", locId));

    const qDon = query(
      collection(db, "donations"),
      ...filters,
      orderBy("receivedAt", "desc")
    );

    setBusy(true);

    const unsub = onSnapshot(
      qDon,
      (snap) => {
        const rows = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        setDonations(rows);
        setBusy(false);
        setError("");
      },
      (e) => {
        console.error("donations onSnapshot error:", e);
        setBusy(false);
        setError(
          "Couldn’t load donations. Check scope and Firestore rules."
        );
      }
    );

    return () => unsub();
  }, [loading, orgId, locId, isAll, isAdmin]);

  // KPI calculations
  const now = new Date();
  const startOfMonth = new Date(
    now.getFullYear(),
    now.getMonth(),
    1
  );

  const stats = useMemo(() => {
    let totalGifts = donations.length;
    let cashThisMonth = 0;
    let inkindThisMonth = 0;
    const donors = new Set();

    for (const d of donations) {
      if (d.donorName) donors.add(d.donorName);

      const amount = Number(d.amount ?? 0);
      const estValue = Number(d.estimatedValue ?? 0);
      const type = d.type || "other";

      let date = d.receivedAt?.toDate
        ? d.receivedAt.toDate()
        : d.receivedAt
        ? new Date(d.receivedAt)
        : null;

      if (!date || isNaN(date.getTime())) continue;
      if (date < startOfMonth) continue;

      if (type === "cash") {
        cashThisMonth += amount;
      } else {
        inkindThisMonth += estValue || amount;
      }
    }

    return {
      totalGifts,
      donors: donors.size,
      cashThisMonth,
      inkindThisMonth,
    };
  }, [donations, startOfMonth]);

  const searchTokens = useMemo(() => tokensOf(term), [term]);

  const filtered = useMemo(() => {
    let rows = donations.slice();

    if (typeFilter !== "all") {
      rows = rows.filter((d) => d.type === typeFilter);
    }

    if (range === "month") {
      rows = rows.filter((d) => {
        const dt = d.receivedAt?.toDate
          ? d.receivedAt.toDate()
          : d.receivedAt
          ? new Date(d.receivedAt)
          : null;
        if (!dt || isNaN(dt.getTime())) return false;
        return dt >= startOfMonth;
      });
    }

    if (searchTokens.length) {
      rows = rows.filter((d) => {
        const hay = [
          d.donorName,
          d.donorEmail,
          d.donorType,
          d.notes,
          d.receiptNumber,
        ]
          .map((x) => (x || "").toString().toLowerCase())
          .join(" | ");

        return searchTokens.every((t) => hay.includes(t));
      });
    }

    return rows;
  }, [
    donations,
    typeFilter,
    range,
    searchTokens,
    startOfMonth,
  ]);

  const exportCsv = useCallback(() => {
    if (!filtered.length) {
      showToast("No donations to export.");
      return;
    }

    const header = [
      "Received at",
      "Type",
      "Amount",
      "Estimated value",
      "Donor",
      "Donor type",
      "Receipt #",
      "Restricted?",
      "Notes",
    ];

    const rows = filtered.map((d) => [
      formatDateTime(d.receivedAt),
      d.type || "",
      Number(d.amount ?? 0),
      Number(d.estimatedValue ?? 0),
      (d.donorName || "").replace(/"/g, '""'),
      (d.donorType || "").replace(/"/g, '""'),
      (d.receiptNumber || "").replace(/"/g, '""'),
      d.restricted ? "Yes" : "No",
      (d.notes || "").replace(/"/g, '""'),
    ]);

    const csvLines = [
      header.join(","),
      ...rows.map((r) =>
        r
          .map((cell) =>
            typeof cell === "string" && /[",]/.test(cell)
              ? `"${cell}"`
              : cell
          )
          .join(",")
      ),
    ];

    const blob = new Blob([csvLines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `donations-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    showToast("Donations CSV downloaded.");
  }, [filtered, showToast]);

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
      ) : canPickAllLocations ? (
        <span className="text-gray-600">(all locations)</span>
      ) : (
        <span className="text-gray-600">(select location)</span>
      )}
    </span>
  );

  const openSheet = () => setSheet({ open: true });
  const closeSheet = () => setSheet({ open: false });

  const handleSaveDonation = async (payload) => {
    if (!orgId) {
      showToast("Missing org for this donation.", "warn");
      return;
    }

    try {
      setBusy(true);
      await addDoc(collection(db, "donations"), {
        ...payload,
        orgId,
        locationId: locId ?? null,
        locationName: location?.name ?? "",
        receivedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      showToast("Donation logged.");
      closeSheet();
    } catch (e) {
      console.error("log donation error", e);
      showToast("Couldn’t log donation.", "warn");
    } finally {
      setBusy(false);
    }
  };

  if (!canViewDonations) {
    return (
      <div className={shellCls}>
        <div
          className={`${cardCls} p-6 mt-4 text-sm text-gray-700 bg-amber-50 border-amber-200`}
        >
          You don’t have permission to view donations for this
          organization.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={shellCls}>
        {/* Toast */}
        {toast && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40">
            <div
              className={`px-4 py-2 rounded-xl shadow-lg text-sm text-white ${
                toast.kind === "warn" ? "bg-amber-700" : "bg-gray-900"
              }`}
              role="status"
            >
              {toast.msg}
            </div>
          </div>
        )}

        {/* THEMED TOOLBAR */}
        <div className="rounded-3xl overflow-visible shadow-sm ring-1 ring-black/5 relative">
          <div className="rounded-t-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 p-3 sm:p-4 relative pb-4 shadow-[inset_0_-1px_0_rgba(255,255,255,0.25)]">
            <div className="flex flex-wrap items-center justify-center md:justify-between gap-2">
              <h1 className="text-white text-xl sm:text-2xl font-semibold tracking-tight text-center md:text-left">
                Donations
              </h1>
              <div className="hidden md:flex items-center gap-2">
                {scopeChip}
              </div>
            </div>
            <div className="mt-2 flex md:hidden justify-center">
              {scopeChip}
            </div>
          </div>

          {/* Controls surface */}
          <div className="rounded-b-3xl bg-white/95 backdrop-blur px-3 sm:px-5 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px] max-w-md">
                <input
                  type="search"
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  placeholder="Search by donor, notes, receipt #…"
                  className="w-full h-10 rounded-full border border-gray-200 bg-white px-9 pr-9 text-sm outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-300"
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                  <svg
                    viewBox="0 0 20 20"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <circle cx="9" cy="9" r="5" />
                    <path d="M13.5 13.5L16 16" />
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

              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="h-9 rounded-full border border-gray-200 bg-white px-3 text-xs sm:text-sm"
                  value={typeFilter}
                  onChange={(e) =>
                    setTypeFilter(e.target.value)
                  }
                >
                  <option value="all">All types</option>
                  <option value="cash">Cash</option>
                  <option value="inkind">In-kind</option>
                </select>

                <select
                  className="h-9 rounded-full border border-gray-200 bg-white px-3 text-xs sm:text-sm"
                  value={range}
                  onChange={(e) =>
                    setRange(e.target.value)
                  }
                >
                  <option value="month">
                    This month
                  </option>
                  <option value="all">All time</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:justify-end">
              <button
                type="button"
                onClick={exportCsv}
                className={BTN.ghost}
                disabled={!filtered.length}
              >
                <span className="hidden sm:inline">Export CSV</span>
                <span className="sm:hidden">CSV</span>
              </button>

              {canManageDonations && (
                <button
                  type="button"
                  onClick={openSheet}
                  className={BTN.primary}
                >
                  <span className="grid place-items-center h-7 w-7 rounded-full bg-white/20">
                    +
                  </span>
                  <span>Log donation</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* KPI ROW */}
        <div className="mt-4">
          <div className="-mx-4 sm:mx-0">
            <div className="overflow-x-auto no-scrollbar px-4 py-1">
              <div
                className="
                  grid grid-flow-col
                  auto-cols-[75%] xs:auto-cols-[55%] sm:auto-cols-[minmax(0,1fr)]
                  md:grid-flow-row md:grid-cols-4
                  gap-3 sm:gap-4 md:gap-6
                  snap-x md:snap-none
                  pr-2
                "
              >
                <KpiCard
                  title="Total gifts (all)"
                  value={stats.totalGifts}
                />
                <KpiCard
                  title="Cash this month"
                  value={formatCurrency(
                    stats.cashThisMonth
                  )}
                />
                <KpiCard
                  title="In-kind value (month)"
                  value={formatCurrency(
                    stats.inkindThisMonth
                  )}
                />
                <KpiCard
                  title="Distinct donors"
                  value={stats.donors}
                />
              </div>
            </div>
          </div>
        </div>

        {/* MAIN LIST */}
        <section
          className={`${cardCls} mt-5 p-0 overflow-hidden`}
        >
          <header className="px-4 py-3 border-b border-brand-100 bg-brand-50/70 backdrop-blur rounded-t-2xl flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-brand-900">
              Donations ({filtered.length})
            </div>
            {busy && (
              <div className="text-xs text-gray-500 flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Syncing…
              </div>
            )}
          </header>

          {error && (
            <div className="px-4 py-3 text-sm text-amber-800 bg-amber-50 border-b border-amber-200">
              {error}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-700">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold">
                    Received
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold">
                    Type
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold">
                    Amount / value
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold">
                    Donor
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold hidden md:table-cell">
                    Receipt #
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold hidden lg:table-cell">
                    Restricted
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold hidden md:table-cell">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => {
                  const amount = Number(d.amount ?? 0);
                  const estValue = Number(d.estimatedValue ?? 0);
                  const isCash = d.type === "cash";

                  return (
                    <tr
                      key={d.id}
                      className="border-t border-gray-100 hover:bg-brand-50/50"
                    >
                      <td className="px-3 py-2 align-middle text-xs text-gray-600 whitespace-nowrap">
                        {formatDateTime(d.receivedAt)}
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[11px]">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              isCash
                                ? "bg-emerald-500"
                                : "bg-indigo-500"
                            }`}
                          />
                          {isCash ? "Cash" : "In-kind"}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <div className="flex flex-col">
                          <span className="font-medium text-gray-900">
                            {isCash
                              ? formatCurrency(amount)
                              : formatCurrency(
                                  estValue || amount
                                )}
                          </span>
                          {!isCash && (
                            <span className="text-[11px] text-gray-500">
                              Reported value
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <div className="flex flex-col">
                          <span className="font-medium text-gray-900">
                            {d.donorName || "Anonymous"}
                          </span>
                          {d.donorType && (
                            <span className="text-[11px] text-gray-500">
                              {d.donorType}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-middle hidden md:table-cell">
                        <span className="text-xs text-gray-700">
                          {d.receiptNumber || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-middle hidden lg:table-cell">
                        {d.restricted ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-900 border border-amber-200 px-2 py-[2px] text-[11px]">
                            Restricted
                          </span>
                        ) : (
                          <span className="text-xs text-gray-500">
                            No
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-middle hidden md:table-cell max-w-xs">
                        <span className="text-xs text-gray-700 line-clamp-2">
                          {d.notes || "—"}
                        </span>
                      </td>
                    </tr>
                  );
                })}

                {!filtered.length && !busy && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-6 text-center text-sm text-gray-500"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-2xl">
                          🤝
                        </span>
                        <span>
                          No donations logged yet for this scope.
                        </span>
                        {canManageDonations && (
                          <button
                            type="button"
                            onClick={openSheet}
                            className={`${BTN.primary} mt-1`}
                          >
                            <span className="grid place-items-center h-7 w-7 rounded-full bg-white/20">
                              +
                            </span>
                            <span>Log your first donation</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}

                {busy && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-4 text-center text-sm text-gray-500"
                    >
                      Loading donations…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {sheet.open && canManageDonations && (
        <DonationSheet
          open={sheet.open}
          onClose={closeSheet}
          onSave={handleSaveDonation}
        />
      )}
    </>
  );
}

/* ---------- small components ---------- */

function KpiCard({ title, value }) {
  return (
    <div className="snap-start md:snap-none flex-none">
      <div className="rounded-2xl border border-brand-100 bg-white px-4 py-3 shadow-sm flex flex-col gap-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
          {title}
        </div>
        <div className="text-lg sm:text-xl font-semibold tabular-nums">
          {value}
        </div>
      </div>
    </div>
  );
}

/* ---------- donation sheet ---------- */

function DonationSheet({ open, onClose, onSave }) {
  const [type, setType] = useState("cash");
  const [donorName, setDonorName] = useState("");
  const [donorType, setDonorType] = useState("individual");
  const [amount, setAmount] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [receiptNumber, setReceiptNumber] = useState("");
  const [restricted, setRestricted] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;

    setSaving(true);
    await onSave({
      type,
      donorName: donorName.trim(),
      donorType,
      amount: Number(amount) || 0,
      estimatedValue:
        type === "cash"
          ? 0
          : Number(estimatedValue || amount) || 0,
      receiptNumber: receiptNumber.trim(),
      restricted,
      notes: notes.trim(),
    });
    setSaving(false);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/30 backdrop-blur-sm"
      aria-modal="true"
      role="dialog"
    >
      <div className="w-full md:max-w-lg max-h-[90vh] rounded-t-3xl md:rounded-2xl bg-white shadow-xl border border-gray-200 overflow-hidden">
        <header className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-brand-50 text-[color:var(--brand-700)] grid place-items-center border border-brand-100">
              🤝
            </div>
            <div className="flex flex-col leading-tight">
              <div className="text-sm font-semibold">
                Log donation
              </div>
              <div className="text-[11px] text-gray-500">
                Track cash and in-kind support in one place.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 grid place-items-center rounded-full hover:bg-gray-100"
          >
            ×
          </button>
        </header>

        <form
          onSubmit={submit}
          className="px-4 pt-3 pb-4 space-y-3 overflow-auto"
        >
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700">
              <input
                type="radio"
                className="h-3.5 w-3.5"
                checked={type === "cash"}
                onChange={() => setType("cash")}
              />
              Cash
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700">
              <input
                type="radio"
                className="h-3.5 w-3.5"
                checked={type === "inkind"}
                onChange={() => setType("inkind")}
              />
              In-kind
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field
              label="Donor name"
              value={donorName}
              onChange={setDonorName}
              placeholder="Optional"
            />
            <label className="flex flex-col gap-1 text-xs text-gray-700">
              <span className="font-medium">Donor type</span>
              <select
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-300"
                value={donorType}
                onChange={(e) =>
                  setDonorType(e.target.value)
                }
              >
                <option value="individual">Individual</option>
                <option value="organization">Organization</option>
                <option value="church">Church</option>
                <option value="business">Business</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field
              label={
                type === "cash"
                  ? "Cash amount"
                  : "In-kind amount"
              }
              type="number"
              value={amount}
              onChange={setAmount}
            />
            {type === "inkind" && (
              <Field
                label="Estimated value"
                type="number"
                value={estimatedValue}
                onChange={setEstimatedValue}
              />
            )}
            <Field
              label="Receipt #"
              value={receiptNumber}
              onChange={setReceiptNumber}
            />
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              className="h-3.5 w-3.5"
              checked={restricted}
              onChange={(e) =>
                setRestricted(e.target.checked)
              }
            />
            <span>Restricted funds (earmarked use)</span>
          </label>

          <Field
            label="Notes"
            textarea
            value={notes}
            onChange={setNotes}
            placeholder="Designations, grant reference, item details…"
          />

          <div className="pt-2 flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 mt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-3 rounded-full text-xs font-medium text-gray-700 border border-gray-200 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`${BTN.primary} h-9 px-4 text-sm`}
              disabled={saving || !amount}
            >
              {saving ? "Saving…" : "Log donation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  textarea = false,
  placeholder,
}) {
  const common =
    "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-300";

  return (
    <label className="flex flex-col gap-1 text-xs text-gray-700">
      <span className="font-medium">{label}</span>
      {textarea ? (
        <textarea
          rows={3}
          className={common}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <input
          type={type}
          className={common}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          step={type === "number" ? "any" : undefined}
        />
      )}
    </label>
  );
}
