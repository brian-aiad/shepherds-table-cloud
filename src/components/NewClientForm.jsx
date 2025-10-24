// src/components/NewClientForm.jsx
// Shepherds Table Cloud — New Client Intake (stable modal, Oct 2025)
// - Stable layout: full-screen on mobile, centered card on desktop (no jitter).
// - Sticky header/footer; scroll only the body region.
// - Keeps your I18N, dedupe (phone + name+dob), Mapbox, counters, audit fields.
// - Two-commit flow: create client, then first visit (transaction).
// - Brand-forward styling, a11y, and mobile-first polish.

import { useEffect, useRef, useState, useMemo } from "react";
import {
  collection, doc, serverTimestamp, runTransaction, getDocs, setDoc,
  query, where, limit as qLimit, increment
} from "firebase/firestore";
import { db, auth } from "../lib/firebase";
import { useAuth } from "../auth/useAuth";

/* =========================
   Mapbox (env based)
========================= */
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || "";
const GEOCODE_URL = "https://api.mapbox.com/geocoding/v5/mapbox.places";
const LB_PROX = "-118.1937,33.7701";

/* =========================
   I18N
========================= */
const I18N = {
  en: {
    titleNew: "New Intake",
    titleEdit: "Edit Client",
    firstName: "First name",
    lastName: "Last name",
    dob: "Date of birth",
    phone: "Phone",
    address: "Address",
    zip: "ZIP code",
    county: "County",
    hhSize: "Household size",
    usdaThisMonth: "First time receiving USDA this month",
    yes: "Yes",
    no: "No",
    tipUsda: "Choose one if applicable. This is only for the current month.",
    cancel: "Cancel",
    save: "Save changes",
    saveLog: "Save + Log Visit",
    savedMsg: "Saved + Visit Logged ✅",
    savedEdit: "Saved ✅",
    errRequiredName: "First and last name are required.",
    errDobOrPhone: "Provide at least a phone number or date of birth.",
    errZip: "ZIP code must be 5 digits.",
    errHH: "Household size must be at least 1.",
    errOrgLoc: "Organization and Location are required (use the switcher in the navbar).",
    errSave: "Error saving, please try again.",
    dupFoundTitle: "Existing client found",
    dupFoundMsg: "There’s already a client matching these details in this organization.",
    dupLogVisit: "Log Visit for Existing",
    dupUseAnyways: "Create new anyway",
    searching: "Searching addresses…",
    noMatches: "No nearby matches",
    addrDisabled: "Address search disabled — missing Mapbox token",
  },
  es: {
    titleNew: "Nueva admisión",
    titleEdit: "Editar cliente",
    firstName: "Nombre",
    lastName: "Apellidos",
    dob: "Fecha de nacimiento",
    phone: "Teléfono",
    address: "Dirección",
    zip: "Código postal",
    county: "Condado",
    hhSize: "Número de personas en el hogar",
    usdaThisMonth: "¿Primera vez recibiendo USDA este mes?",
    yes: "Sí",
    no: "No",
    tipUsda: "Elija una opción si aplica. Solo para el mes actual.",
    cancel: "Cancelar",
    save: "Guardar cambios",
    saveLog: "Guardar + Registrar visita",
    savedMsg: "Guardado + Visita registrada ✅",
    savedEdit: "Guardado ✅",
    errRequiredName: "El nombre y los apellidos son obligatorios.",
    errDobOrPhone: "Proporcione al menos un teléfono o fecha de nacimiento.",
    errZip: "El código postal debe tener 5 dígitos.",
    errHH: "El tamaño del hogar debe ser al menos 1.",
    errOrgLoc: "Se requieren Organización y Ubicación (use el selector en la barra).",
    errSave: "Error al guardar. Intente de nuevo.",
    dupFoundTitle: "Cliente existente encontrado",
    dupFoundMsg: "Ya existe un cliente con estos datos en esta organización.",
    dupLogVisit: "Registrar visita al existente",
    dupUseAnyways: "Crear nuevo de todos modos",
    searching: "Buscando direcciones…",
    noMatches: "Sin resultados cercanos",
    addrDisabled: "Búsqueda deshabilitada: falta el token de Mapbox",
  },
};
const t = (lang, key) => I18N[lang]?.[key] ?? I18N.en[key] ?? key;

/* =========================
   Helpers
========================= */
const onlyDigits = (s = "") => s.replace(/\D/g, "");
const normalizePhone = onlyDigits;
const tcase = (s = "") =>
  s
    .toLowerCase()
    .replace(/[\p{L}]+('[\p{L}]+)?/gu, (w) => w[0].toUpperCase() + w.slice(1))
    .replace(/([- ][\p{L}])/gu, (m) => m[0] + m[1].toUpperCase());

const localDateKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
function isoWeekKey(d = new Date()) {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
function formatPhone(value) {
  const digits = onlyDigits(value).slice(0, 10);
  const len = digits.length;
  if (len <= 3) return digits;
  if (len <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}
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
function hashDJB2(str = "") {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i);
  return `h${(h >>> 0).toString(16)}`;
}

const initialForm = {
  firstName: "",
  lastName: "",
  dob: "",
  phone: "",
  address: "",
  zip: "",
  county: "",
  householdSize: 1,
  firstTimeThisMonth: null, // true | false | null
};

/* =========================
   Component
========================= */
export default function NewClientForm({
  open,
  onClose,
  onSaved,
  client,
  defaultOrgId,
  defaultLocationId,
}) {
  const editing = !!client?.id;
  const authCtx = useAuth() || {};

  // Device-scoped fallback
  const lsScope = (() => {
    try { return JSON.parse(localStorage.getItem("stc_scope") || "{}"); } catch { return {}; }
  })();

  const orgId =
    defaultOrgId ??
    authCtx.org?.id ??
    authCtx.activeOrgId ??
    authCtx.activeOrg?.id ??
    authCtx.orgId ??
    lsScope.activeOrgId ??
    null;

  const locationId =
    defaultLocationId ??
    authCtx.location?.id ??
    authCtx.activeLocationId ??
    authCtx.activeLocation?.id ??
    authCtx.locationId ??
    lsScope.activeLocationId ??
    null;

  // UI state
  const [form, setForm] = useState(initialForm);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [dup, setDup] = useState(null);

  const [lang, setLang] = useState(() => {
    const saved = localStorage.getItem("newClientForm.lang");
    if (saved === "en" || saved === "es") return saved;
    return navigator.language?.toLowerCase().startsWith("es") ? "es" : "en";
  });
  useEffect(() => { localStorage.setItem("newClientForm.lang", lang); }, [lang]);

  // focus + backdrop scroll lock
  const containerRef = useRef(null);
  const firstRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => firstRef.current?.focus(), 120);
    return () => { document.body.style.overflow = prev; clearTimeout(t); };
  }, [open]);

  // seed values on open/edit
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        firstName: client?.firstName || "",
        lastName: client?.lastName || "",
        dob: client?.dob || "",
        phone: client?.phone || "",
        address: client?.address || "",
        zip: client?.zip || "",
        county: client?.county || "",
        householdSize: Number(client?.householdSize ?? 1),
        firstTimeThisMonth:
          typeof client?.firstTimeThisMonth === "boolean" ? client.firstTimeThisMonth : null,
      });
    } else {
      setForm(initialForm);
    }
    setMsg("");
    setDup(null);
  }, [open, editing, client]);

  /* =========================
     Address autocomplete
  ========================== */
  const addrEnabled = Boolean(MAPBOX_TOKEN);
  const [addrQ, setAddrQ] = useState("");
  const [addrLoading, setAddrLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [addrLocked, setAddrLocked] = useState(false);
  const [lastPicked, setLastPicked] = useState("");

  const addrBoxRef = useRef(null);
  const dropdownRef = useRef(null);
  useEffect(() => setAddrQ(form.address), [form.address]);

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
    setForm((f) => ({ ...f, address: displayAddress, zip: zip || f.zip, county: county || f.county }));
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

  /* =========================
     Validation & dedupe
  ========================== */
  function validate() {
    const fn = form.firstName.trim();
    const ln = form.lastName.trim();
    if (!fn || !ln) return t(lang, "errRequiredName");
    const phoneDigits = normalizePhone(form.phone);
    if (!phoneDigits && !form.dob.trim()) return t(lang, "errDobOrPhone");
    if (!Number(form.householdSize || 0) || Number(form.householdSize) < 1) return t(lang, "errHH");
    const zip = (form.zip || "").trim();
    if (zip && !/^\d{5}$/.test(zip)) return t(lang, "errZip");
    if (!orgId || !locationId) return t(lang, "errOrgLoc");
    return "";
  }

  async function preflightDedupe({ phoneDigits, nameDobHash }) {
    if (phoneDigits) {
      const qs = await getDocs(
        query(collection(db, "clients"), where("phoneDigits", "==", phoneDigits), where("orgId", "==", orgId), qLimit(1))
      );
      if (!qs.empty) { const d = qs.docs[0]; return { id: d.id, ...(d.data() || {}) }; }
    }
    if (nameDobHash) {
      const qs2 = await getDocs(
        query(collection(db, "clients"), where("nameDobHash", "==", nameDobHash), where("orgId", "==", orgId), qLimit(1))
      );
      if (!qs2.empty) { const d = qs2.docs[0]; return { id: d.id, ...(d.data() || {}) }; }
    }
    return null;
  }

  /* =========================
     Submit
  ========================== */
  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;

    const v = validate();
    if (v) { setMsg(v); return; }

    setBusy(true);
    setMsg("");
    setDup(null);

    const phoneDigits = normalizePhone(form.phone);

    try {
      const firstName = tcase(form.firstName.trim());
      const lastName  = tcase(form.lastName.trim());
      const fullNameLower = `${firstName} ${lastName}`.trim().toLowerCase();
      const nameDobHash   = hashDJB2(`${fullNameLower}|${form.dob || ""}`);

      if (!editing) {
        const existing = await preflightDedupe({ phoneDigits, nameDobHash });
        if (existing) {
          setDup(existing);
          setMsg(t(lang, "dupFoundMsg"));
          setBusy(false);
          return;
        }
      }

      const basePayload = {
        firstName,
        lastName,
        dob: form.dob.trim(),
        phone: form.phone.trim(),
        phoneDigits,
        address: form.address.trim(),
        zip: (form.zip || "").trim(),
        county: (form.county || "").trim(),
        householdSize: Number(form.householdSize || 1),
        firstTimeThisMonth: typeof form.firstTimeThisMonth === "boolean" ? form.firstTimeThisMonth : null,
        fullNameLower,
        nameDobHash,
        updatedAt: serverTimestamp(),
        updatedByUserId: auth.currentUser?.uid || null,
      };

      let createdId = client?.id;

      if (!editing) {
        // 1) CREATE CLIENT (separate commit)
        const clientRef = doc(collection(db, "clients"));
        await setDoc(clientRef, {
          ...basePayload,
          orgId,
          locationId,
          createdAt: serverTimestamp(),
          createdByUserId: auth.currentUser?.uid || null,
          inactive: false,
          mergedIntoId: null,
          visitCountLifetime: 0,
          visitCountByMonth: {},
          lastVisitAt: null,
          lastVisitMonthKey: null,
        });

        // Optional USDA marker — best effort; rules enforce uniqueness
        if (form.firstTimeThisMonth === true) {
          const mk = monthKey(new Date());
          const markerRef = doc(db, "usda_first", `${orgId}_${clientRef.id}_${mk}`);
          try {
            await setDoc(markerRef, {
              clientId: clientRef.id,
              orgId,
              locationId,
              monthKey: mk,
              createdAt: serverTimestamp(),
              createdByUserId: auth.currentUser?.uid || null,
            });
          } catch { /* ignore collisions */ }
        }

        // 2) FIRST VISIT + COUNTERS (transaction, now that client exists)
        await runTransaction(db, async (tx) => {
          const now = new Date();
          const mk = monthKey(now);
          const dk = localDateKey(now);
          const wk = isoWeekKey(now);
          const weekday = now.getDay();

          const visitRef = doc(collection(db, "visits"));
          tx.set(visitRef, {
            clientId: clientRef.id,
            clientFirstName: basePayload.firstName,
            clientLastName: basePayload.lastName,
            orgId,
            locationId,
            householdSize: Number(form.householdSize || 1),
            visitAt: serverTimestamp(),
            createdAt: serverTimestamp(),
            dateKey: dk,
            monthKey: mk,
            weekKey: wk,
            weekday,
            usdaFirstTimeThisMonth: form.firstTimeThisMonth === true,
            createdBy: auth.currentUser?.uid || null, // legacy
            createdByUserId: auth.currentUser?.uid || null,
            editedAt: null,
            editedByUserId: null,
            addedByReports: false,
          });

          const clientRef2 = doc(db, "clients", clientRef.id);
          tx.update(clientRef2, {
            visitCountLifetime: increment(1),
            [`visitCountByMonth.${mk}`]: increment(1),
            lastVisitAt: serverTimestamp(),
            lastVisitMonthKey: mk,
            updatedAt: serverTimestamp(),
            updatedByUserId: auth.currentUser?.uid || null,
          });
        });

        createdId = clientRef.id;
      } else {
        // EDITING: preserve existing org/location
        await runTransaction(db, async (tx) => {
          if (!client?.id) throw new Error("Missing client id for edit.");
          const clientRef = doc(db, "clients", client.id);
          tx.set(
            clientRef,
            { ...basePayload }, // orgId/locationId preserved by rules; do not reassign silently
            { merge: true }
          );
          createdId = clientRef.id;
        });
      }

      const saved = { id: createdId, ...(editing ? { ...client } : { orgId, locationId }), ...basePayload };
      onSaved?.(saved);
      setMsg(editing ? t(lang, "savedEdit") : t(lang, "savedMsg"));

      if (!editing) {
        setForm(initialForm);
        setAddrLocked(false);
        setLastPicked("");
        firstRef.current?.focus();
      }
    } catch (err) {
      console.error(err);
      setMsg(t(lang, "errSave"));
    } finally {
      setBusy(false);
    }
  }

  // Log visit for duplicate
  async function logVisitForDuplicate() {
    if (!dup?.id || busy) return;
    setBusy(true);
    setMsg("");
    try {
      await runTransaction(db, async (tx) => {
        const now = new Date();
        const mk = monthKey(now);
        const dk = localDateKey(now);
        const wk = isoWeekKey(now);
        const weekday = now.getDay();

        const wantsUsdaFirst = form.firstTimeThisMonth === true;
        if (wantsUsdaFirst) {
          const markerRef = doc(db, "usda_first", `${orgId}_${dup.id}_${mk}`);
          const markerSnap = await tx.get(markerRef);
          if (!markerSnap.exists()) {
            tx.set(markerRef, {
              clientId: dup.id, orgId, locationId, monthKey: mk,
              createdAt: serverTimestamp(), createdByUserId: auth.currentUser?.uid || null,
            });
          }
        }

        const visitRef = doc(collection(db, "visits"));
        tx.set(visitRef, {
          clientId: dup.id,
          clientFirstName: dup.firstName || "",
          clientLastName: dup.lastName || "",
          orgId, locationId,
          householdSize: Number(form.householdSize || 1),
          visitAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          monthKey: mk, dateKey: dk, weekKey: wk, weekday,
          usdaFirstTimeThisMonth: wantsUsdaFirst,
          createdBy: auth.currentUser?.uid || null,
          createdByUserId: auth.currentUser?.uid || null,
          editedAt: null, editedByUserId: null,
          addedByReports: false,
        });

        const clientRef = doc(db, "clients", dup.id);
        tx.set(
          clientRef,
          {
            visitCountLifetime: increment(1),
            [`visitCountByMonth.${mk}`]: increment(1),
            lastVisitAt: serverTimestamp(),
            lastVisitMonthKey: mk,
            updatedAt: serverTimestamp(),
            updatedByUserId: auth.currentUser?.uid || null,
          },
          { merge: true }
        );
      });

      setMsg("Visit logged for existing client ✅");
      onSaved?.({ ...(dup || {}) });
      setDup(null);
      setForm(initialForm);
      setAddrLocked(false);
      setLastPicked("");
      firstRef.current?.focus();
    } catch (e) {
      console.error(e);
      setMsg("Couldn’t log visit for the existing client.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const showAssist = lang === "es";
  const dual = (primary, hint) => (
    <span className="flex flex-col">
      <span>{primary}</span>
      {showAssist && <span className="text-[11px] text-gray-500">{hint}</span>}
    </span>
  );

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[1000] flex items-stretch md:items-center justify-center"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <button
        aria-label="Close"
        className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Modal shell */}
      <div
        className="
          relative w-full h-full md:h-auto md:w-[min(820px,94vw)] max-h-[96vh]
          bg-white md:rounded-3xl shadow-2xl ring-1 ring-brand-200/70
          flex flex-col overflow-hidden
        "
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header (sticky) */}
        <div className="sticky top-0 z-10">
          <div
            className="
              px-4 md:px-6 py-3 border-b
              bg-gradient-to-r from-[color:var(--brand-700)] to-[color:var(--brand-600)]
              text-white flex items-center justify-between
            "
          >
            <h2 className="text-base md:text-lg font-semibold">
              {editing ? t(lang, "titleEdit") : t(lang, "titleNew")}
            </h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setLang("en")}
                className={`h-9 px-3 rounded-lg border text-sm transition-colors ${
                  lang === "en"
                    ? "bg-white/10 text-white border-white/30"
                    : "bg-white text-[color:var(--brand-700)] border-white/30"
                }`}
                aria-pressed={lang === "en"}
              >
                English
              </button>
              <button
                type="button"
                onClick={() => setLang("es")}
                className={`h-9 px-3 rounded-lg border text-sm transition-colors ${
                  lang === "es"
                    ? "bg-white/10 text-white border-white/30"
                    : "bg-white text-[color:var(--brand-700)] border-white/30"
                }`}
                aria-pressed={lang === "es"}
              >
                Español
              </button>

              <span className="ml-2 text-[11px] md:text-xs opacity-90">
                Org: <b>{orgId ?? "—"}</b> • Loc: <b>{locationId ?? "—"}</b>
              </span>

              <button
                onClick={onClose}
                className="ml-2 rounded-xl px-3 h-10 hover:bg-white/10 focus:outline-none"
                aria-label="Close"
                title="Close"
              >
                ✕
              </button>
            </div>
          </div>
        </div>

        {/* Body (scroll area) */}
        <form
          id="new-client-form"
          onSubmit={onSubmit}
          onKeyDown={handleFormKeyDown}
          noValidate
          className="flex-1 overflow-y-auto px-4 md:px-6 py-4 md:py-6 space-y-4 text-[17px]"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {/* Names */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-700">
                {dual(t(lang, "firstName"), "First name")}
              </span>
              <input
                ref={firstRef}
                className="border rounded-2xl p-3 h-12 focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-500)]"
                name="firstName"
                placeholder="e.g., Brian"
                autoCapitalize="words"
                autoComplete="given-name"
                enterKeyHint="next"
                value={form.firstName}
                onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                required
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-700">
                {dual(t(lang, "lastName"), "Last name")}
              </span>
              <input
                className="border rounded-2xl p-3 h-12 focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-500)]"
                name="lastName"
                placeholder="e.g., Aiad"
                autoCapitalize="words"
                autoComplete="family-name"
                enterKeyHint="next"
                value={form.lastName}
                onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                required
              />
            </label>
          </div>

          {/* DOB + Phone */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-700">
                {dual(t(lang, "dob"), "Date of birth")}
              </span>
              <input
                className="border rounded-2xl p-3 h-12 focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-500)]"
                type="date"
                name="dob"
                autoComplete="bday"
                value={form.dob}
                onChange={(e) => setForm((f) => ({ ...f, dob: e.target.value }))}
                max={new Date().toISOString().slice(0, 10)}
                enterKeyHint="next"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-700">
                {dual(t(lang, "phone"), "Phone")}
              </span>
              <input
                className="border rounded-2xl p-3 h-12 focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-500)]"
                name="phone"
                placeholder="(310) 254-1234"
                inputMode="tel"
                autoComplete="tel"
                enterKeyHint="next"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: formatPhone(e.target.value) }))}
              />
            </label>
          </div>

          {/* Address + ZIP + County */}
          <div className="flex flex-col gap-1 relative">
            <span className="text-xs font-medium text-gray-700">
              {dual(t(lang, "address"), "Address")}
            </span>
            <input
              ref={addrBoxRef}
              disabled={!addrEnabled}
              className="w-full border rounded-2xl p-3 h-12 focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-500)] disabled:bg-gray-50 disabled:text-gray-500"
              placeholder={addrEnabled ? "e.g., 185 Harvard Dr, Seal Beach" : t(lang, "addrDisabled")}
              value={form.address}
              onChange={onAddressInputChange}
              enterKeyHint="next"
              autoComplete="street-address"
              onFocus={() => addrEnabled && !addrLocked && suggestions.length && setShowDropdown(true)}
            />

            {/* Suggestions dropdown */}
            {addrEnabled && showDropdown && (
              <div
                ref={dropdownRef}
                className="absolute left-0 right-0 top-[100%] mt-1 z-50 rounded-2xl bg-white shadow-xl ring-1 ring-black/10 overflow-hidden"
              >
                <div className="px-3 py-2 text-[11px] font-medium text-gray-500 border-b">
                  {addrLoading ? t(lang, "searching") : "Nearby results"}
                </div>
                <ul className="max-h-[280px] overflow-auto">
                  {!addrLoading && suggestions.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-gray-500">{t(lang, "noMatches")}</li>
                  ) : null}
                  {suggestions.map((sug) => (
                    <li key={sug.id}>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 active:bg-gray-100"
                        onClick={() => onPickSuggestion(sug)}
                        title={sug.place_name}
                      >
                        {sug.place_name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 mt-2">
              <label className="flex-1">
                <span className="sr-only">{t(lang, "zip")}</span>
                <input
                  className="w-full border rounded-2xl p-3 h-12 focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-500)]"
                  name="zip"
                  placeholder={lang === "es" ? "Código postal" : "ZIP code"}
                  value={form.zip}
                  onChange={(e) => setForm((f) => ({ ...f, zip: e.target.value }))}
                  inputMode="numeric"
                  pattern="\d{5}"
                  autoComplete="postal-code"
                  enterKeyHint="next"
                />
              </label>
              <label className="flex-1">
                <span className="sr-only">{t(lang, "county")}</span>
                <input
                  className="w-full border rounded-2xl p-3 h-12 focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-500)]"
                  name="county"
                  placeholder={lang === "es" ? "Condado" : "County"}
                  value={form.county}
                  onChange={(e) => setForm((f) => ({ ...f, county: e.target.value }))}
                  enterKeyHint="next"
                />
              </label>
            </div>
          </div>

          {/* Household + USDA */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-gray-700">
                {dual(t(lang, "hhSize"), "Household size")}
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label="Decrease household size"
                  className="h-12 w-12 rounded-2xl border grid place-items-center text-xl font-semibold hover:bg-gray-50 active:scale-95"
                  onClick={() => setForm((f) => ({ ...f, householdSize: Math.max(1, Number(f.householdSize) - 1) }))}
                >
                  –
                </button>
                <div className="h-12 min-w-[88px] px-4 rounded-2xl border grid place-items-center shadow-sm">
                  <span className="text-lg tabular-nums">{form.householdSize}</span>
                </div>
                <button
                  type="button"
                  aria-label="Increase household size"
                  className="h-12 w-12 rounded-2xl border grid place-items-center text-xl font-semibold hover:bg-gray-50 active:scale-95"
                  onClick={() => setForm((f) => ({ ...f, householdSize: Math.min(20, Number(f.householdSize) + 1) }))}
                >
                  +
                </button>
              </div>
            </div>

            {!editing && (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-xs font-medium text-gray-700">
                  {dual(t(lang, "usdaThisMonth"), "First time receiving USDA this month")}
                </legend>
                <div className="grid grid-cols-2 gap-2">
                  <label
                    className={`h-12 rounded-2xl border grid place-items-center text-sm font-semibold cursor-pointer transition-colors ${
                      form.firstTimeThisMonth === true
                        ? "bg-[color:var(--brand-700)] text-white border-[color:var(--brand-700)]"
                        : "bg-white text-gray-800 border-gray-300 hover:bg-[color:var(--brand-50)]"
                    }`}
                  >
                    <input
                      type="radio"
                      name="usdaFirstThisMonth"
                      className="sr-only"
                      checked={form.firstTimeThisMonth === true}
                      onChange={() => setForm((f) => ({ ...f, firstTimeThisMonth: true }))}
                    />
                    {t(lang, "yes")}
                  </label>
                  <label
                    className={`h-12 rounded-2xl border grid place-items-center text-sm font-semibold cursor-pointer transition-colors ${
                      form.firstTimeThisMonth === false
                        ? "bg-[color:var(--brand-700)] text-white border-[color:var(--brand-700)]"
                        : "bg-white text-gray-800 border-gray-300 hover:bg-[color:var(--brand-50)]"
                    }`}
                  >
                    <input
                      type="radio"
                      name="usdaFirstThisMonth"
                      className="sr-only"
                      checked={form.firstTimeThisMonth === false}
                      onChange={() => setForm((f) => ({ ...f, firstTimeThisMonth: false }))}
                    />
                    {t(lang, "no")}
                  </label>
                </div>
                <p className="text-xs text-gray-500">{t(lang, "tipUsda")}</p>
              </fieldset>
            )}
          </div>

          {/* Duplicate card */}
          {dup && (
            <div className="rounded-2xl border bg-amber-50 ring-1 ring-amber-200 p-4 space-y-2">
              <div className="font-semibold text-amber-900">{t(lang, "dupFoundTitle")}</div>
              <div className="text-sm text-amber-900/90">{t(lang, "dupFoundMsg")}</div>
              <div className="text-sm text-amber-900/90">
                <span className="font-medium">{dup.firstName} {dup.lastName}</span>
                {!!dup.address && ` • ${dup.address}`} {!!dup.zip && ` ${dup.zip}`}
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={logVisitForDuplicate}
                  disabled={busy}
                  className="h-10 px-3 rounded-xl bg-[color:var(--brand-700)] text-white text-sm font-medium hover:bg-[color:var(--brand-600)] disabled:opacity-50"
                >
                  {t(lang, "dupLogVisit")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setDup(null)}
                  className="h-10 px-3 rounded-xl border text-sm hover:bg-gray-50"
                  title="Continue to create new client anyway"
                >
                  {t(lang, "dupUseAnyways")}
                </button>
              </div>
            </div>
          )}
        </form>

        {/* Footer (sticky) */}
        <div
          className="sticky bottom-0 z-10 border-t bg-white/95 backdrop-blur px-4 md:px-6 py-3"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="flex flex-col-reverse md:flex-row md:items-center md:justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-12 px-5 rounded-2xl border hover:bg-gray-50"
            >
              {t(lang, "cancel")}
            </button>
            <button
              type="submit"
              form="new-client-form"
              disabled={busy}
              className="h-12 w-full md:w-auto px-6 rounded-2xl bg-[color:var(--brand-700)] text-white text-[17px] font-semibold shadow-sm hover:bg-[color:var(--brand-600)] active:bg-[color:var(--brand-800)] disabled:opacity-50"
            >
              {busy ? "Saving…" : editing ? t(lang, "save") : t(lang, "saveLog")}
            </button>
          </div>

          {msg && (
            <div className="mt-2 text-sm text-gray-700" role="status" aria-live="polite">
              {msg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
