// src/components/EditForm.jsx
// Shepherds Table Cloud — Edit Client (Oct/Nov 2025 UI, capability-ready)
// - Mobile: slide-up bottom sheet (mirrors NewClientForm). Desktop: centered card.
// - Sticky header/footer; pretty-scroll body; avatar initials chip.
// - Emoji-safe, lucide icons on labels; Mapbox autocomplete matches NewClientForm.
// - Admin-only deactivate/reactivate now gated by capability 'deleteClients'.
// - Enter key = next field navigation.

import { useEffect, useMemo, useRef, useState } from "react";
import { db, auth } from "../lib/firebase";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { useAuth } from "../auth/useAuth";
import {
  User as UserIcon,
  IdCard,
  Calendar,
  Phone as PhoneIcon,
  MapPin,
  Tag,
  Landmark,
  Users,
  ShieldAlert,
  RotateCcw,
  X,
} from "lucide-react";

/* =========================
   Mapbox (env based)
========================= */
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || "";
const GEOCODE_URL = "https://api.mapbox.com/geocoding/v5/mapbox.places";
const LB_PROX = "-118.1937,33.7701";

/* =========================
   Helpers (parity w/ NewClientForm)
========================= */
const onlyDigits = (s = "") => s.replace(/\D/g, "");
const tcase = (s = "") =>
  s
    .toLowerCase()
    .replace(/[\p{L}]+('[\p{L}]+)?/gu, (w) => w[0].toUpperCase() + w.slice(1))
    .replace(/([- ][\p{L}])/gu, (m) => m[0] + m[1].toUpperCase());

const safeNum = (v) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const isYmd = (s = "") => /^\d{4}-\d{2}-\d{2}$/.test(s);

function formatPhone(value) {
  const digits = onlyDigits(value).slice(0, 10);
  const len = digits.length;
  if (len <= 3) return digits;
  if (len <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

// tiny stable hash for dedupe/search keys
function hashDJB2(str = "") {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i);
  return `h${(h >>> 0).toString(16)}`;
}

// Parse out clean address, ZIP, County from a Mapbox feature
function parseFeatureAddressParts(feature) {
  const street = feature.place_type?.includes("address")
    ? `${feature.address ?? ""} ${feature.text ?? ""}`.trim()
    : feature.text || "";
  let city = ""; let county = ""; let zip = "";
  if (Array.isArray(feature.context)) {
    for (const c of feature.context) {
      const id = c.id || "";
      if (!city && (id.startsWith("locality") || id.startsWith("place"))) city = c.text || city;
      if (!county && id.startsWith("district")) county = c.text || county;
      if (!zip && id.startsWith("postcode")) zip = (c.text || "").replace(/\D/g, "");
    }
  }
  if (!city && (feature.place_type?.includes("place") || feature.place_type?.includes("locality"))) {
    city = feature.text || city;
  }
  const displayAddress = street && city ? `${street}, ${city}` : feature.place_name?.split(",")[0] || "";
  return { displayAddress, zip, county };
}

// Enter moves to the next input (like NewClientForm)
function handleFormKeyDown(e) {
  if (e.key !== "Enter") return;
  const el = e.target;
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute("type") || "").toLowerCase();
  const safe =
    tag === "textarea" || tag === "select" || tag === "button" || type === "submit" || type === "button";
  if (safe) return;
  e.preventDefault();
  const form = e.currentTarget;
  const focusables = Array.from(form.querySelectorAll("input, select, textarea"))
    .filter((n) => !n.disabled && n.type !== "hidden" && n.tabIndex !== -1);
  const idx = focusables.indexOf(el);
  if (idx > -1 && idx < focusables.length - 1) focusables[idx + 1].focus();
  else el.blur();
}

const ICONS = {
  firstName: <UserIcon size={16} className="text-brand-600 inline mr-1" />,
  lastName: <IdCard size={16} className="text-brand-600 inline mr-1" />,
  dob: <Calendar size={16} className="text-brand-600 inline mr-1" />,
  phone: <PhoneIcon size={16} className="text-brand-600 inline mr-1" />,
  address: <MapPin size={16} className="text-brand-600 inline mr-1" />,
  zip: <Tag size={16} className="text-brand-600 inline mr-1" />,
  county: <Landmark size={16} className="text-brand-600 inline mr-1" />,
  hh: <Users size={16} className="text-brand-600 inline mr-1" />,
};

/* ---------- tiny presentational helper (parity with NewClient/LogVisit) ---------- */
function SectionHeader({ icon, label }) {
  return (
    <div className="-mx-3 sm:-mx-4 -mt-3 sm:-mt-4 mb-3">
      <div className="flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-t-2xl bg-gradient-to-r from-brand-700 via-brand-600 to-brand-500 shadow-[0_4px_10px_rgba(148,27,21,0.3)]">
        {icon && (
          <span className="flex items-center text-white">
            {icon}
          </span>
        )}
        <div className="flex-1 text-xs sm:text-sm font-semibold leading-tight text-white">
          {label}
        </div>
      </div>
    </div>
  );
}

/* =========================
   Component
========================= */
export default function EditForm({ open, client, onClose, onSaved }) {
  // 🔐 capability-based auth
  const { uid, org, location, hasCapability } = useAuth() || {};
  const canEditClients = !!hasCapability?.("editClients");
  const canDeleteClients = !!hasCapability?.("deleteClients");

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    address: "",
    phone: "",
    zip: "",
    county: "",
    dob: "",
    householdSize: "",
    inactive: false,
  });

  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const [error, setError] = useState("");

  // Address autocomplete state (matches NewClientForm)
  const addrEnabled = Boolean(MAPBOX_TOKEN);
  const [addrQ, setAddrQ] = useState("");
  const [addrLoading, setAddrLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [addrLocked, setAddrLocked] = useState(false);
  const [lastPicked, setLastPicked] = useState("");

  // Refs
  const firstRef = useRef(null);
  const addrBoxRef = useRef(null);
  const dropdownRef = useRef(null);

  // Body scroll lock + autofocus
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => firstRef.current?.focus(), 140);
    return () => { document.body.style.overflow = prev; clearTimeout(t); };
  }, [open]);

  // Prefill
  useEffect(() => {
    if (!client || !open) return;
    setError("");
    setForm({
      firstName: client.firstName || "",
      lastName: client.lastName || "",
      address: client.address || "",
      phone: client.phone || "",
      zip: onlyDigits(client.zip || ""),
      county: client.county || "",
      dob: client.dob || "",
      householdSize:
        client.householdSize !== undefined && client.householdSize !== null
          ? String(client.householdSize)
          : "",
      inactive: !!client.inactive,
    });
  }, [client, open]);

  // keep addrQ synced
  useEffect(() => setAddrQ(form.address), [form.address]);

  // Address search (debounced)
  useEffect(() => {
    if (!open) return;
    if (!addrEnabled) { setSuggestions([]); setShowDropdown(false); return; }
    const q = (addrQ || "").trim();
    if (q.length < 3 || addrLocked) { setSuggestions([]); setShowDropdown(false); return; }

    let alive = true;
    const id = setTimeout(async () => {
      setAddrLoading(true);
      try {
        const url = new URL(`${GEOCODE_URL}/${encodeURIComponent(q)}.json`);
        url.searchParams.set("access_token", MAPBOX_TOKEN);
        url.searchParams.set("autocomplete", "true");
        url.searchParams.set("proximity", LB_PROX);
        url.searchParams.set("country", "US");
        url.searchParams.set("limit", "7");
        url.searchParams.set("types", "address,locality,place");
        const res = await fetch(url.toString());
        const data = await res.json();
        const feats = Array.isArray(data.features) ? data.features : [];
        const cleaned = feats.map((f) => ({
          id: f.id, place_name: f.place_name, text: f.text,
          address: f.address, place_type: f.place_type || [],
          context: f.context || [], _raw: f,
        }));
        if (alive) { setSuggestions(cleaned); setShowDropdown(true); }
      } catch {
        if (alive) { setSuggestions([]); setShowDropdown(true); }
      } finally { if (alive) setAddrLoading(false); }
    }, 220);

    return () => { clearTimeout(id); alive = false; };
  }, [addrQ, addrLocked, open, addrEnabled]);

  // click outside hides dropdown
  useEffect(() => {
    if (!showDropdown) return;
    const onDocClick = (e) => {
      if (!addrBoxRef.current?.contains(e.target) && !dropdownRef.current?.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [showDropdown]);

  function onPickSuggestion(feat) {
    const { displayAddress, zip, county } = parseFeatureAddressParts(feat._raw || feat);
    setForm((f) => ({
      ...f,
      address: displayAddress,
      zip: zip || f.zip,
      county: county || f.county,
    }));
    setSuggestions([]);
    setShowDropdown(false);
    setAddrLocked(true);
    setLastPicked(displayAddress);
  }
  function onAddressInputChange(e) {
    const v = e.target.value;
    setForm((f) => ({ ...f, address: v }));
    if (addrLocked && v !== lastPicked) setAddrLocked(false);
  }

  /* ---------- normalized payload ---------- */
  const normalized = useMemo(() => {
    const firstName = tcase((form.firstName || "").trim());
    const lastName = tcase((form.lastName || "").trim());
    const address = (form.address || "").trim();
    const phoneDigits = onlyDigits(form.phone || "");
    const phone = formatPhone(form.phone || "");
    const zip = onlyDigits(form.zip || "");
    const county = (form.county || "").trim();
    const dob = (form.dob || "").trim();
    const householdSize =
      form.householdSize === "" ? "" : String(onlyDigits(form.householdSize || ""));
    const fullNameLower = `${firstName} ${lastName}`.trim().toLowerCase();
    const nameDobHash = hashDJB2(`${fullNameLower}|${dob || ""}`);
    return {
      firstName,
      lastName,
      address,
      phoneDigits,
      phone,
      zip,
      county,
      dob,
      householdSize,
      fullNameLower,
      nameDobHash,
      inactive: !!form.inactive,
    };
  }, [form]);

  const hasChanges = useMemo(() => {
    if (!client) return false;
    const cmp = (a, b) => (a ?? "") === (b ?? "");
    return !(
      cmp(tcase(client.firstName || ""), normalized.firstName) &&
      cmp(tcase(client.lastName || ""), normalized.lastName) &&
      cmp(client.address || "", normalized.address) &&
      cmp(onlyDigits(client.phoneDigits || client.phone || ""), normalized.phoneDigits) &&
      cmp(onlyDigits(client.zip || ""), normalized.zip) &&
      cmp((client.county || "").trim(), normalized.county) &&
      cmp(client.dob || "", normalized.dob) &&
      (safeNum(client.householdSize) ?? null) === (safeNum(normalized.householdSize) ?? null) &&
      (!!client.inactive === normalized.inactive)
    );
  }, [client, normalized]);

  const formValid = useMemo(() => {
    if (!normalized.firstName || !normalized.lastName) return false;
    if (normalized.dob && !isYmd(normalized.dob)) return false;
    if (normalized.phoneDigits && normalized.phoneDigits.length < 7) return false;
    if (normalized.zip && normalized.zip.length !== 5) return false;
    if (normalized.householdSize !== "" && safeNum(normalized.householdSize) === null) return false;
    return true;
  }, [normalized]);

  // Initials avatar (like NewClientForm)
  const initials = useMemo(() => {
    const name = `${form.firstName || ""} ${form.lastName || ""}`.trim();
    if (!name) return "👤";
    return name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("");
  }, [form.firstName, form.lastName]);

  /* ---------- handlers ---------- */
  const onChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((f) => ({ ...f, [name]: type === "checkbox" ? checked : value }));
  };

  const submit = async (e) => {
    e.preventDefault();
    // Capability check for editing
    if (!canEditClients) {
      setError("You don’t have permission to edit client profiles.");
      return;
    }
    if (!client?.id || !formValid || !hasChanges || saving) return;
    try {
      setSaving(true);
      setError("");

      const ref = doc(db, "clients", client.id);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("Client no longer exists.");
      const current = snap.data() || {};

      const payload = {
        // core edits
        firstName: normalized.firstName,
        lastName: normalized.lastName,
        address: normalized.address,
        phone: normalized.phone,
        phoneDigits: normalized.phoneDigits,
        zip: normalized.zip,
        county: normalized.county,
        dob: normalized.dob,
        householdSize: safeNum(normalized.householdSize),
        // Inactive flag can be toggled only if user has delete capability; otherwise preserve current
        inactive: canDeleteClients ? normalized.inactive : !!current.inactive,

        // computed
        fullNameLower: normalized.fullNameLower,
        nameDobHash: normalized.nameDobHash,

        // preserve tenant scope
        orgId: current.orgId ?? client.orgId ?? null,
        locationId: current.locationId ?? client.locationId ?? null,

        // audit
        updatedAt: serverTimestamp(),
        updatedByUserId: uid || auth.currentUser?.uid || null,
      };

      await updateDoc(ref, payload);
      onSaved?.({ id: client.id, ...client, ...payload });
    } catch (err) {
      console.error("EditForm save error:", err);
      setError(err?.message || "Could not save changes.");
    } finally {
      setSaving(false);
    }
  };

  // "Delete" now means deactivate (soft delete) — gated by 'deleteClients'
  const deactivateClient = async () => {
    if (!canDeleteClients) {
      setError("Only admins can deactivate clients.");
      return;
    }
    if (!client?.id || deactivating) return;
    if (client.inactive) return;
    const name = `${tcase(client.firstName || "")} ${tcase(client.lastName || "")}`.trim() || "this client";
    const ok = confirm(
      `Deactivate ${name}?\n\nThey will be hidden from intake/search but their history remains.\nYou can reactivate later.`
    );
    if (!ok) return;

    try {
      setDeactivating(true);
      setError("");

      const ref = doc(db, "clients", client.id);
      await updateDoc(ref, {
        inactive: true,
        deactivatedAt: serverTimestamp(),
        deactivatedByUserId: uid || auth.currentUser?.uid || null,
        updatedAt: serverTimestamp(),
        updatedByUserId: uid || auth.currentUser?.uid || null,
      });

      onSaved?.({ id: client.id, ...client, inactive: true });
      onClose?.();
      alert(`Deactivated ${name}.`);
    } catch (err) {
      console.error("Deactivate client error:", err);
      setError(err?.message || "Failed to deactivate client.");
    } finally {
      setDeactivating(false);
    }
  };

  const reactivateClient = async () => {
    if (!canDeleteClients) {
      setError("Only admins can reactivate clients.");
      return;
    }
    if (!client?.id || reactivating) return;
    if (!client.inactive && !form.inactive) return;

    try {
      setReactivating(true);
      setError("");

      const ref = doc(db, "clients", client.id);
      await updateDoc(ref, {
        inactive: false,
        reactivatedAt: serverTimestamp(),
        reactivatedByUserId: uid || auth.currentUser?.uid || null,
        updatedAt: serverTimestamp(),
        updatedByUserId: uid || auth.currentUser?.uid || null,
      });

      onSaved?.({ id: client.id, ...client, inactive: false });
      onClose?.();
      alert("Client reactivated.");
    } catch (err) {
      console.error("Reactivate client error:", err);
      setError(err?.message || "Failed to reactivate client.");
    } finally {
      setReactivating(false);
    }
  };

  if (!open) return null;

  const readOnlyBlock = !canEditClients;
  const headerName = `${tcase(client?.firstName || "")} ${tcase(
    client?.lastName || ""
  )}`.trim();

  const fieldInputCls =
    "w-full bg-white border border-brand-200 rounded-2xl p-3 h-11 shadow-inner/5 focus:outline-none focus:ring-4 focus:ring-brand-200 focus:border-brand-400";

  /* ---------- render ---------- */
  return (
    <div className="fixed inset-0 z-[1000]">
      {/* Backdrop */}
      <button
        aria-label="Close"
        className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Modal shell — bottom sheet on mobile; centered card on desktop */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-client-title"
        className="
          absolute left-1/2 -translate-x-1/2 w-full sm:w-[min(820px,94vw)]
          bottom-0 sm:bottom-auto sm:top-[55%] sm:-translate-y-1/2
          bg-white sm:rounded-3xl rounded-t-3xl shadow-2xl ring-1 ring-brand-200/70
          overflow-hidden flex flex-col
        "
        style={{
          maxHeight: "calc(100vh - 120px)",
          marginTop: "calc(env(safe-area-inset-top, 44px) + 56px)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header (sticky, matches NewClient/LogVisit style) */}
        <div
          className="sticky top-0 z-10"
          style={{
            paddingTop: "env(safe-area-inset-top, 12px)",
            top: "env(safe-area-inset-top, 12px)",
          }}
        >
          <div className="bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 text-white border-b shadow-[inset_0_-1px_0_rgba(255,255,255,0.25)] rounded-t-3xl">
            <div className="px-3.5 sm:px-6 py-2.5 sm:py-4">
              <div className="flex items-center justify-between gap-3 sm:gap-6">
                {/* Title + avatar + scope */}
                <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
                  <div className="shrink-0 h-10 w-10 rounded-2xl bg-white/15 text-white grid place-items-center font-semibold ring-1 ring-white/20">
                    {initials === "👤" ? (
                      <UserIcon className="h-5 w-5 text-white/95" aria-hidden="true" />
                    ) : (
                      <span>{initials}</span>
                    )}
                  </div>

                  <div className="min-w-0">
                    <h2
                      id="edit-client-title"
                      className="text-base sm:text-xl font-semibold truncate"
                    >
                      {`Edit Client${headerName ? ` – ${headerName}` : ""}`}
                    </h2>
                    <div className="mt-0.5 text-[11px] sm:text-xs opacity-90 leading-tight">
                      <div className="truncate">
                        Org: <b>{org?.id ?? "—"}</b>
                      </div>
                      <div className="truncate">
                        Loc: <b>{location?.id ?? "—"}</b>
                      </div>
                    </div>

                    {client?.inactive && (
                      <span className="mt-1 inline-flex items-center h-5 px-2 rounded-lg bg-white/15 border border-white/25 text-[10px] font-semibold">
                        Inactive
                      </span>
                    )}
                  </div>
                </div>

                {/* Close */}
                <button
                  onClick={onClose}
                  className="rounded-xl px-4 sm:px-5 h-11 sm:h-12 text-xl sm:text-2xl hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 shrink-0"
                  aria-label="Close"
                  title="Close"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Body (scroll area) */}
        <form
          id="edit-client-form"
          onSubmit={submit}
          onKeyDown={handleFormKeyDown}
          noValidate
          className="flex-1 overflow-y-auto overflow-x-hidden px-4 md:px-6 py-4 md:py-6 space-y-4 text-[17px] pretty-scroll"
          style={{ maxHeight: "calc(100vh - 220px)", paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {readOnlyBlock ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 ring-1 ring-amber-200 p-3 text-amber-900 text-sm flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" />
              You don’t have permission to edit client profiles. Please ask an admin.
            </div>
          ) : (
            <>
              {/* ===== Section: Client details ===== */}
              <section className="rounded-2xl border border-brand-200 bg-white shadow-sm p-3 sm:p-4 space-y-3">
                <SectionHeader
                  icon={<UserIcon className="h-3.5 w-3.5" />}
                  label="Client details"
                />

                {/* Name Row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="flex flex-col gap-1 sm:col-span-2">
                    <span className="text-[11px] font-medium text-gray-700">
                      {ICONS.firstName}
                      First name
                    </span>
                    <input
                      ref={firstRef}
                      className={fieldInputCls}
                      name="firstName"
                      value={form.firstName}
                      onChange={onChange}
                      onBlur={() => setForm((f) => ({ ...f, firstName: tcase(f.firstName) }))}
                      autoComplete="given-name"
                      required
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-gray-700">
                      {ICONS.lastName}
                      Last name
                    </span>
                    <input
                      className={fieldInputCls}
                      name="lastName"
                      value={form.lastName}
                      onChange={onChange}
                      onBlur={() => setForm((f) => ({ ...f, lastName: tcase(f.lastName) }))}
                      autoComplete="family-name"
                      required
                    />
                  </label>
                </div>

                {/* Phone */}
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-gray-700">
                    {ICONS.phone}
                    Phone
                  </span>
                  <input
                    className={fieldInputCls}
                    name="phone"
                    placeholder="(310) 254-1234"
                    inputMode="tel"
                    autoComplete="tel"
                    enterKeyHint="next"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: formatPhone(e.target.value) }))}
                  />
                </label>

                {/* DOB + Household size */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-gray-700">
                      {ICONS.dob}
                      Date of birth
                    </span>
                    <input
                      className={fieldInputCls}
                      type="date"
                      name="dob"
                      value={form.dob}
                      onChange={onChange}
                      max={new Date().toISOString().slice(0, 10)}
                    />
                    {form.dob && !isYmd(form.dob) && (
                      <div className="mt-1 text-[12px] text-red-600">Use format YYYY-MM-DD.</div>
                    )}
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-gray-700">
                      {ICONS.hh}
                      Household size
                    </span>
                    <div className="flex items-center gap-3 w-full">
                      <button
                        type="button"
                        aria-label="Decrease household size"
                        className="h-12 sm:h-11 w-28 sm:w-11 rounded-2xl border border-brand-300 text-brand-800 bg-white grid place-items-center text-xl font-semibold shadow-sm hover:bg-brand-50 hover:border-brand-400 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            householdSize: String(
                              Math.max(1, Number(onlyDigits(f.householdSize || "1")) - 1)
                            ),
                          }))
                        }
                      >
                        –
                      </button>
                      <div className="h-12 sm:h-11 flex-1 px-2 rounded-2xl border border-brand-400 bg-brand-50 text-brand-900 grid place-items-center shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-brand-200/70">
                        <span className="text-sm font-semibold tabular-nums">
                          {form.householdSize || 1}
                        </span>
                      </div>
                      <button
                        type="button"
                        aria-label="Increase household size"
                        className="h-12 sm:h-11 w-28 sm:w-11 rounded-2xl border border-brand-300 text-brand-800 bg-white grid place-items-center text-xl font-semibold shadow-sm hover:bg-brand-50 hover:border-brand-400 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            householdSize: String(
                              Math.min(20, Number(onlyDigits(f.householdSize || "1")) + 1)
                            ),
                          }))
                        }
                      >
                        +
                      </button>
                    </div>
                  </label>
                </div>
              </section>

              {/* ===== Section: Address and area ===== */}
              <section className="rounded-2xl border border-brand-200 bg-white shadow-sm p-3 sm:p-4 space-y-3">
                <SectionHeader
                  icon={<MapPin className="h-3.5 w-3.5" />}
                  label="Address and area"
                />

                {/* Address + Autocomplete */}
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-gray-700">
                    {ICONS.address}
                    Address
                  </span>

                  <input
                    ref={addrBoxRef}
                    disabled={!addrEnabled}
                    className={`${fieldInputCls} disabled:bg-gray-50 disabled:text-gray-500`}
                    placeholder={
                      addrEnabled
                        ? "e.g., 185 Harvard Dr, Seal Beach"
                        : "Address search disabled — missing Mapbox token"
                    }
                    value={form.address}
                    onChange={onAddressInputChange}
                    enterKeyHint="next"
                    autoComplete="street-address"
                    onFocus={() =>
                      addrEnabled && !addrLocked && suggestions.length && setShowDropdown(true)
                    }
                    aria-autocomplete="list"
                    aria-expanded={addrEnabled && showDropdown ? "true" : "false"}
                    aria-controls="addr-edit-panel"
                  />

                  {addrEnabled && showDropdown && (
                    <div
                      id="addr-edit-panel"
                      ref={dropdownRef}
                      className="mt-2 rounded-2xl border border-brand-200 bg-white shadow-soft overflow-hidden"
                      role="listbox"
                      aria-label="Nearby results"
                    >
                      <div className="px-3 py-2 text-[11px] font-medium text-gray-600 bg-gray-50 border-b">
                        {addrLoading ? "Searching addresses…" : "Nearby results"}
                      </div>
                      <ul className="max-h-48 sm:max-h-64 overflow-y-auto divide-y pretty-scroll pr-1">
                        {!addrLoading && suggestions.length === 0 && (
                          <li className="px-3 py-2 text-sm text-gray-600">No nearby matches</li>
                        )}
                        {suggestions.map((sug) => (
                          <li key={sug.id}>
                            <button
                              type="button"
                              role="option"
                              className="w-full text-left px-3 py-2 text-sm hover:bg-brand-50 focus:bg-brand-50 focus:outline-none"
                              onClick={() => onPickSuggestion(sug)}
                              title={sug.place_name}
                            >
                              <div className="text-[14px] text-gray-900">
                                {sug.text || sug.place_name}
                              </div>
                              <div className="text-xs text-gray-600 truncate">
                                {sug.place_name}
                              </div>
                            </button>
                          </li>
                        ))}
                      </ul>
                      <div className="flex items-center justify-end gap-2 px-3 py-2 bg-gray-50">
                        <button
                          type="button"
                          className="text-xs px-2 py-1 rounded-md border border-brand-200 text-gray-700 hover:bg-gray-100"
                          onClick={() => setShowDropdown(false)}
                        >
                          Hide
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ZIP + County */}
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    <label className="flex-1 flex flex-col gap-1">
                      <span className="text-[11px] font-medium text-gray-700">
                        {ICONS.zip}
                        ZIP code
                      </span>
                      <input
                        className={fieldInputCls}
                        name="zip"
                        placeholder="ZIP code"
                        value={form.zip}
                        onChange={(e) => setForm((f) => ({ ...f, zip: e.target.value }))}
                        inputMode="numeric"
                        pattern="\d{5}"
                        autoComplete="postal-code"
                        enterKeyHint="next"
                      />
                    </label>
                    <label className="flex-1 flex flex-col gap-1">
                      <span className="text-[11px] font-medium text-gray-700">
                        {ICONS.county}
                        County
                      </span>
                      <input
                        className={fieldInputCls}
                        name="county"
                        placeholder="County"
                        value={form.county}
                        onChange={(e) => setForm((f) => ({ ...f, county: e.target.value }))}
                        enterKeyHint="next"
                      />
                    </label>
                  </div>
                </div>
              </section>

              {/* Inactive toggle — visible and writable only with delete capability */}
              {canDeleteClients && (
                <label className="text-sm flex items-center gap-2 mt-1">
                  <input
                    type="checkbox"
                    name="inactive"
                    checked={!!form.inactive}
                    onChange={onChange}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span className="text-gray-700">
                    Mark client as inactive (hidden from search and intake)
                  </span>
                </label>
              )}

              {/* Error (live region) */}
              <div aria-live="polite" className="min-h-[1rem]">
                {error && (
                  <div className="mt-2 rounded-2xl border border-red-200 bg-red-50 ring-1 ring-red-200 px-3 py-2 text-sm text-red-800">
                    {error}
                  </div>
                )}
              </div>
            </>
          )}
        </form>

        {/* Consent note (same placement as NewClientForm) */}
        <div className="mt-1 text-[10px] leading-tight text-gray-400 text-center px-2">
          Edits are logged for reporting and audit. Data is retained within your organization unless required by law.
        </div>

        {/* Footer (sticky) */}
                <div
          className="sticky bottom-0 z-10 border-t bg-white/95 backdrop-blur px-4 sm:px-6 py-3 sm:py-4"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 6px)" }}
        >
          <div className="w-full h-px bg-gray-200 mb-2" />

          <div className="w-full max-w-xl mx-auto">
            <div className="flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap">
              {/* Left: Danger / Reactivation (compact, same line) */}
              <div className="flex-shrink-0">
                {canDeleteClients && (
                  !client?.inactive ? (
                    <button
                      type="button"
                      onClick={deactivateClient}
                      disabled={deactivating}
                      className="
                        inline-flex items-center justify-center gap-1.5
                        h-9 sm:h-10 px-3 sm:px-4
                        rounded-xl
                        text-xs sm:text-sm font-medium
                        bg-red-600 text-white
                        shadow-sm
                        hover:bg-red-700 active:bg-red-800
                        disabled:opacity-60
                      "
                    >
                      {deactivating ? (
                        "Working…"
                      ) : (
                        <>
                          <ShieldAlert className="h-3.5 w-3.5" />
                          <span>Deactivate</span>
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={reactivateClient}
                      disabled={reactivating}
                      className="
                        inline-flex items-center justify-center gap-1.5
                        h-9 sm:h-10 px-3 sm:px-4
                        rounded-xl
                        text-xs sm:text-sm font-medium
                        bg-green-600 text-white
                        shadow-sm
                        hover:bg-green-700 active:bg-green-800
                        disabled:opacity-60
                      "
                    >
                      {reactivating ? (
                        "Working…"
                      ) : (
                        <>
                          <RotateCcw className="h-3.5 w-3.5" />
                          <span>Reactivate</span>
                        </>
                      )}
                    </button>
                  )
                )}
              </div>

              {/* Right: Cancel + Save */}
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-11 px-5 rounded-2xl border border-brand-300 text-brand-800 bg-white hover:bg-brand-50 hover:border-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="edit-client-form"
                  disabled={saving || readOnlyBlock || !formValid || !hasChanges}
                  aria-disabled={saving || readOnlyBlock || !formValid || !hasChanges}
                  title={
                    readOnlyBlock
                      ? "Not allowed"
                      : !formValid
                      ? "Fix the highlighted fields"
                      : !hasChanges
                      ? "No changes to save"
                      : "Save changes"
                  }
                  className="h-11 px-6 rounded-2xl bg-[color:var(--brand-700)] text-white font-semibold shadow-sm hover:bg-[color:var(--brand-600)] active:bg-[color:var(--brand-800)] disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </div>
          </div>
        </div>


      </div>
    </div>
  );
}
