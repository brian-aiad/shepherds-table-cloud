// src/pages/Inventory.jsx
// Shepherd's Table Cloud — Inventory (multi-tenant, capability-aware, 2025)
//
// - Org/location scoped, real-time Firestore list
// - KPI row (items, low stock, total quantity, estimated value)
// - Search + filter (category, low-stock toggle, sort)
// - Add / Edit item sheet (bottom sheet on mobile, centered on desktop)
// - CSV export
// - Honors capability model via hasCapability + admin fallback

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import { MapPin } from "lucide-react";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../../lib/firebase";
import useAuth from "../../auth/useAuth";

// Basic UI tokens (mirror Dashboard / Reports)
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
  secondary:
    "inline-flex items-center justify-center gap-2 h-10 px-4 rounded-full text-sm font-semibold " +
    "text-[color:var(--brand-700)] bg-brand-50 hover:bg-brand-100 border border-brand-200",
  ghost:
    "inline-flex items-center justify-center gap-2 h-9 px-3 rounded-full text-xs font-medium " +
    "text-gray-700 bg-white hover:bg-gray-50 border border-gray-200",
  icon:
    "inline-flex items-center justify-center rounded-full h-9 w-9 border border-gray-200 bg-white hover:bg-gray-50",
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

const formatDate = (ts) => {
  if (!ts) return "—";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString();
  } catch {
    return "—";
  }
};

const tokensOf = (s = "") =>
  s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

function matchesSearch(row, tokens) {
  if (!tokens.length) return true;
  const hay = [
    row.name,
    row.category,
    row.sku,
    row.unit,
    row.locationName,
    row.notes,
  ]
    .map((x) => (x || "").toString().toLowerCase())
    .join(" | ");

  return tokens.every((t) => hay.includes(t));
}

export default function Inventory() {
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

  const canViewInventory =
    hasCapability?.("inventory") ?? isAdmin ?? false;
  const canManageInventory =
    hasCapability?.("manageInventory") ??
    hasCapability?.("inventoryManage") ??
    isAdmin ??
    false;

  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [term, setTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState("asc");

  const [sheet, setSheet] = useState({
    open: false,
    item: null,
  });

  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  // Tiny toast helper
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

  // Live inventory subscription
  useEffect(() => {
    setItems([]);
    setError("");

    if (loading) return;
    if (!orgId) return;

    if (!isAdmin && !locId) {
      setError("Choose a location to view inventory.");
      return;
    }

    const filters = [where("orgId", "==", orgId)];
    if (!isAll && locId) filters.push(where("locationId", "==", locId));

    const qInv = query(
      collection(db, "inventory"),
      ...filters,
      orderBy("name")
    );

    setBusy(true);

    const unsub = onSnapshot(
      qInv,
      (snap) => {
        const rows = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        setItems(rows);
        setBusy(false);
        setError("");
      },
      (e) => {
        console.error("inventory onSnapshot error:", e);
        setBusy(false);
        setError(
          "Couldn’t load inventory. Check scope and Firestore rules."
        );
      }
    );

    return () => unsub();
  }, [loading, orgId, locId, isAll, isAdmin]);

  const categories = useMemo(() => {
    const set = new Set();
    for (const it of items) {
      if (it.category) set.add(it.category);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const kpi = useMemo(() => {
    let totalItems = items.length;
    let lowStock = 0;
    let totalUnits = 0;
    let estValue = 0;

    for (const it of items) {
      const q = Number(it.quantity ?? 0);
      const min = Number(it.minQuantity ?? 0);
      if (Number.isFinite(q)) totalUnits += q;
      if (Number.isFinite(q) && Number.isFinite(min) && q <= min)
        lowStock += 1;
      const cost = Number(it.costPerUnit ?? 0);
      if (Number.isFinite(q) && Number.isFinite(cost))
        estValue += q * cost;
    }

    return {
      totalItems,
      lowStock,
      totalUnits,
      estValue,
    };
  }, [items]);

  const searchTokens = useMemo(() => tokensOf(term), [term]);

  const filteredSorted = useMemo(() => {
    let rows = items.filter((row) => matchesSearch(row, searchTokens));

    if (categoryFilter !== "all") {
      rows = rows.filter((r) => r.category === categoryFilter);
    }

    if (showLowStockOnly) {
      rows = rows.filter((r) => {
        const q = Number(r.quantity ?? 0);
        const min = Number(r.minQuantity ?? 0);
        return (
          Number.isFinite(q) &&
          Number.isFinite(min) &&
          q <= min
        );
      });
    }

    rows.sort((a, b) => {
      let dir = sortDir === "desc" ? -1 : 1;
      switch (sortKey) {
        case "category":
          return (
            (a.category || "").localeCompare(b.category || "") * dir
          );
        case "quantity":
          return (
            (Number(a.quantity ?? 0) - Number(b.quantity ?? 0)) * dir
          );
        case "updatedAt":
          return (
            ((a.updatedAt?.seconds || 0) -
              (b.updatedAt?.seconds || 0)) * dir
          );
        default:
          return (a.name || "").localeCompare(b.name || "") * dir;
      }
    });

    return rows;
  }, [
    items,
    searchTokens,
    categoryFilter,
    showLowStockOnly,
    sortKey,
    sortDir,
  ]);

  const ariaSortFor = (key) =>
    sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none";

  const toggleSort = (key) => {
    setSortKey((prevKey) => {
      if (prevKey !== key) {
        setSortDir("asc");
        return key;
      }
      setSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
      return key;
    });
  };

  const exportCsv = useCallback(() => {
    if (!filteredSorted.length) {
      showToast("No inventory to export.");
      return;
    }

    const header = [
      "Name",
      "Category",
      "SKU",
      "Quantity",
      "Min Qty",
      "Unit",
      "Estimated Value",
      "Location",
      "Last Updated",
    ];

    const rows = filteredSorted.map((it) => [
      (it.name || "").replace(/"/g, '""'),
      (it.category || "").replace(/"/g, '""'),
      (it.sku || "").replace(/"/g, '""'),
      Number(it.quantity ?? 0),
      Number(it.minQuantity ?? 0),
      (it.unit || "").replace(/"/g, '""'),
      (Number(it.quantity ?? 0) *
        Number(it.costPerUnit ?? 0)) || 0,
      (it.locationName || "").replace(/"/g, '""'),
      formatDate(it.updatedAt),
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
    a.download = `inventory-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    showToast("Inventory CSV downloaded.");
  }, [filteredSorted, showToast]);

  const openNewSheet = () =>
    setSheet({ open: true, item: null });

  const openEditSheet = (item) =>
    setSheet({ open: true, item });

  const closeSheet = () =>
    setSheet({ open: false, item: null });

  const handleSaveItem = async (payload) => {
    if (!orgId) {
      showToast("Missing org for this item.", "warn");
      return;
    }

    try {
      setBusy(true);
      const base = {
        ...payload,
        orgId,
        locationId: locId ?? null,
        locationName: location?.name ?? "",
        updatedAt: serverTimestamp(),
      };

      if (sheet.item?.id) {
        await updateDoc(
          doc(db, "inventory", sheet.item.id),
          base
        );
        showToast("Inventory item updated.");
      } else {
        await addDoc(collection(db, "inventory"), {
          ...base,
          createdAt: serverTimestamp(),
        });
        showToast("Inventory item added.");
      }
      closeSheet();
    } catch (e) {
      console.error("save inventory error", e);
      showToast("Couldn’t save inventory item.", "warn");
    } finally {
      setBusy(false);
    }
  };

  // Scope pill (icon variant matching Dashboard)
  const scopeChip = (
    <span className="inline-flex items-center gap-2 rounded-full bg-white text-brand-900 ring-1 ring-black/5 shadow-sm px-3 py-1 text-[13px]">
      <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-brand-50 text-[color:var(--brand-700)] ring-1 ring-brand-100 mr-1.5">
        <MapPin className="h-3 w-3" aria-hidden="true" />
      </span>
      <span className="font-semibold text-sm truncate">{location?.name ? `${org?.name || "—"} / ${location.name}` : org?.name || "—"}</span>
    </span>
  );

  if (!canViewInventory) {
    return (
      <div className={shellCls}>
        <div
          className={`${cardCls} p-6 mt-4 text-sm text-gray-700 bg-amber-50 border-amber-200`}
        >
          You don’t have permission to view inventory for this
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
        <div className="block rounded-3xl overflow-visible shadow-sm ring-1 ring-black/5 relative mb-4">
          <div className="rounded-t-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 p-3 sm:p-4 relative pb-6 shadow-[inset_0_-1px_0_rgba(255,255,255,0.25)]">
            <div className="flex flex-wrap items-center justify-center md:justify-between gap-2">
              <h1 className="text-white text-xl sm:text-2xl font-semibold tracking-tight text-center md:text-left">
                Inventory
              </h1>
              <div className="hidden md:flex items-center gap-2">
                {scopeChip}
              </div>
            </div>
            <div className="mt-2 md:mt-3 flex flex-wrap items-center justify-center md:justify-start gap-2">
              <div className="md:hidden">{scopeChip}</div>
            </div>
          </div>

          {/* Controls surface */}
          <div className="rounded-b-3xl bg-white/95 backdrop-blur px-3 sm:px-5 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border border-brand-100 ring-1 ring-brand-50 shadow-soft">
            {/* Search + filters */}
            <div className="flex-1 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px] max-w-md">
                <input
                  type="search"
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  placeholder="Search by name, category, SKU…"
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

              <div className="flex items-center gap-2 flex-wrap">
                <select
                  className="h-9 rounded-full border border-gray-200 bg-white px-3 text-xs sm:text-sm"
                  value={categoryFilter}
                  onChange={(e) =>
                    setCategoryFilter(e.target.value)
                  }
                >
                  <option value="all">All categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() =>
                    setShowLowStockOnly((v) => !v)
                  }
                  className={`${BTN.ghost} ${
                    showLowStockOnly
                      ? "bg-brand-50 text-brand-800 border-brand-300"
                      : ""
                  }`}
                >
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  <span>Low stock</span>
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 sm:justify-end">
              <button
                type="button"
                onClick={exportCsv}
                className={BTN.ghost}
                disabled={!filteredSorted.length}
              >
                <span className="hidden sm:inline">Export CSV</span>
                <span className="sm:hidden">CSV</span>
              </button>

              {canManageInventory && (
                <button
                  type="button"
                  onClick={openNewSheet}
                  className={BTN.primary}
                >
                  <span className="grid place-items-center h-7 w-7 rounded-full bg-white/20">
                    +
                  </span>
                  <span>Add Item</span>
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
                  title="Items"
                  value={kpi.totalItems}
                />
                <KpiCard
                  title="Total units"
                  value={kpi.totalUnits}
                />
                <KpiCard
                  title="Low-stock items"
                  value={kpi.lowStock}
                  tone={
                    kpi.lowStock > 0 ? "warn" : "default"
                  }
                />
                <KpiCard
                  title="Estimated value"
                  value={formatCurrency(kpi.estValue)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* MAIN TABLE */}
        <section
          className={`${cardCls} mt-5 p-0 overflow-hidden`}
        >
          <header className="px-4 py-3 border-b border-brand-100 bg-brand-50/70 backdrop-blur rounded-t-2xl flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-brand-900">
              Inventory items
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
                  <Th
                    label="Name"
                    colKey="name"
                    onSort={toggleSort}
                    ariaSort={ariaSortFor("name")}
                  />
                  <Th
                    label="Category"
                    colKey="category"
                    onSort={toggleSort}
                    ariaSort={ariaSortFor("category")}
                    className="hidden sm:table-cell"
                  />
                  <Th
                    label="SKU"
                    colKey="sku"
                    onSort={toggleSort}
                    ariaSort="none"
                    className="hidden md:table-cell"
                  />
                  <Th
                    label="Quantity"
                    colKey="quantity"
                    onSort={toggleSort}
                    ariaSort={ariaSortFor("quantity")}
                  />
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 hidden lg:table-cell">
                    Min
                  </th>
                  <Th
                    label="Unit"
                    colKey="unit"
                    onSort={toggleSort}
                    ariaSort="none"
                    className="hidden sm:table-cell"
                  />
                  <Th
                    label="Value"
                    colKey="value"
                    onSort={toggleSort}
                    ariaSort="none"
                    className="hidden md:table-cell"
                  />
                  <Th
                    label="Updated"
                    colKey="updatedAt"
                    onSort={toggleSort}
                    ariaSort={ariaSortFor("updatedAt")}
                    className="hidden lg:table-cell"
                  />
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredSorted.map((it) => {
                  const qty = Number(it.quantity ?? 0);
                  const min = Number(it.minQuantity ?? 0);
                  const low =
                    Number.isFinite(qty) &&
                    Number.isFinite(min) &&
                    qty <= min;

                  return (
                    <tr
                      key={it.id}
                      className="border-t border-gray-100 hover:bg-brand-50/50"
                    >
                      <td className="px-3 py-2 align-middle">
                        <div className="flex flex-col">
                          <span className="font-medium text-gray-900">
                            {it.name || "Untitled item"}
                          </span>
                          <span className="text-[11px] text-gray-500 sm:hidden">
                            {(it.category && `${it.category} • `) ||
                              ""}
                            {it.unit || "unit"}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 align-middle hidden sm:table-cell">
                        <span className="text-gray-800">
                          {it.category || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-middle hidden md:table-cell">
                        <span className="text-gray-700 tabular-nums">
                          {it.sku || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <div className="flex items-center gap-1.5">
                          <span className="tabular-nums">
                            {Number.isFinite(qty) ? qty : "—"}
                          </span>
                          {low && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-900 border border-amber-200 px-2 py-[2px] text-[11px]">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                              Low
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-middle hidden lg:table-cell">
                        <span className="tabular-nums text-gray-700">
                          {Number.isFinite(min) ? min : "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-middle hidden sm:table-cell">
                        <span className="text-gray-700">
                          {it.unit || "unit"}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-middle hidden md:table-cell">
                        <span className="tabular-nums text-gray-800">
                          {formatCurrency(
                            Number(it.quantity ?? 0) *
                              Number(it.costPerUnit ?? 0)
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-middle hidden lg:table-cell">
                        <span className="text-xs text-gray-500">
                          {formatDate(it.updatedAt)}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-middle text-right">
                        {canManageInventory ? (
                          <button
                            type="button"
                            onClick={() => openEditSheet(it)}
                            className="inline-flex items-center justify-center h-8 px-3 rounded-full text-xs font-medium border border-gray-200 text-gray-700 hover:bg-gray-50"
                          >
                            Edit
                          </button>
                        ) : (
                          <span className="text-[11px] text-gray-400">
                            View only
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {!filteredSorted.length && !busy && (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-6 text-center text-sm text-gray-500"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-2xl">
                          📦
                        </span>
                        <span>
                          No inventory items yet for this scope.
                        </span>
                        {canManageInventory && (
                          <button
                            type="button"
                            onClick={openNewSheet}
                            className={`${BTN.primary} mt-1`}
                          >
                            <span className="grid place-items-center h-7 w-7 rounded-full bg-white/20">
                              +
                            </span>
                            <span>Add your first item</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}

                {busy && (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-4 text-center text-sm text-gray-500"
                    >
                      Loading inventory…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Sheet */}
      {sheet.open && (
        <InventorySheet
          open={sheet.open}
          item={sheet.item}
          onClose={closeSheet}
          onSave={handleSaveItem}
        />
      )}
    </>
  );
}

/* ---------- tiny UI pieces ---------- */

function KpiCard({ title, value, tone = "default" }) {
  const toneCls =
    tone === "warn"
      ? "bg-amber-50 text-amber-900 border-amber-100"
      : "bg-white text-brand-900 border-brand-100";

  return (
    <div className="snap-start md:snap-none flex-none">
      <div
        className={`rounded-2xl border shadow-sm px-4 py-3 flex flex-col gap-1 ${toneCls}`}
      >
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

function Th({
  label,
  colKey,
  onSort,
  ariaSort,
  className = "",
}) {
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={`px-3 py-2 text-left text-xs font-semibold text-gray-600 ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(colKey)}
        className="inline-flex items-center gap-1 text-xs text-gray-700 hover:text-gray-900"
      >
        <span>{label}</span>
        <span aria-hidden="true" className="text-[10px]">
          ↕
        </span>
      </button>
    </th>
  );
}

/* ---------- Inventory sheet ---------- */

function InventorySheet({ open, item, onClose, onSave }) {
  const initial = useMemo(
    () => ({
      name: item?.name || "",
      category: item?.category || "",
      sku: item?.sku || "",
      quantity: item?.quantity ?? "",
      minQuantity: item?.minQuantity ?? "",
      unit: item?.unit || "",
      costPerUnit: item?.costPerUnit ?? "",
      notes: item?.notes || "",
    }),
    [item]
  );

  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(initial);
  }, [initial]);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;

    setSaving(true);
    await onSave({
      name: form.name.trim(),
      category: form.category.trim(),
      sku: form.sku.trim(),
      quantity: Number(form.quantity) || 0,
      minQuantity: Number(form.minQuantity) || 0,
      unit: form.unit.trim() || "unit",
      costPerUnit: Number(form.costPerUnit) || 0,
      notes: form.notes.trim(),
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
              📦
            </div>
            <div className="flex flex-col leading-tight">
              <div className="text-sm font-semibold">
                {item ? "Edit inventory item" : "Add inventory item"}
              </div>
              <div className="text-[11px] text-gray-500">
                Keep your pantry inventory up to date.
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field
              label="Name"
              required
              value={form.name}
              onChange={(v) => handleChange("name", v)}
              autoFocus
            />
            <Field
              label="Category"
              value={form.category}
              onChange={(v) => handleChange("category", v)}
              placeholder="Dry goods, produce…"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field
              label="SKU / code"
              value={form.sku}
              onChange={(v) => handleChange("sku", v)}
            />
            <Field
              label="Quantity"
              type="number"
              value={form.quantity}
              onChange={(v) => handleChange("quantity", v)}
            />
            <Field
              label="Min quantity"
              type="number"
              value={form.minQuantity}
              onChange={(v) => handleChange("minQuantity", v)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field
              label="Unit"
              value={form.unit}
              onChange={(v) => handleChange("unit", v)}
              placeholder="cases, lbs, items…"
            />
            <Field
              label="Cost per unit"
              type="number"
              step="0.01"
              value={form.costPerUnit}
              onChange={(v) => handleChange("costPerUnit", v)}
            />
            <div className="hidden sm:block" />
          </div>

          <Field
            label="Notes"
            value={form.notes}
            onChange={(v) => handleChange("notes", v)}
            textarea
            placeholder="Expiration details, storage info, donor notes…"
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
              disabled={saving || !form.name.trim()}
            >
              {saving
                ? "Saving…"
                : item
                ? "Save changes"
                : "Add item"}
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
  required,
  autoFocus,
  placeholder,
}) {
  const common =
    "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-300";

  return (
    <label className="flex flex-col gap-1 text-xs text-gray-700">
      <span className="font-medium">
        {label}
        {required && <span className="text-amber-600"> *</span>}
      </span>
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
          required={required}
          autoFocus={autoFocus}
          placeholder={placeholder}
          step={type === "number" ? "any" : undefined}
        />
      )}
    </label>
  );
}
