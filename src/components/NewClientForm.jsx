// src/components/NewClientForm.jsx
// Shepherds Table Cloud — New Client Intake (bottom sheet on mobile, Nov 2025)

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import {
  collection,
  doc,
  serverTimestamp,
  runTransaction,
  getDocs,
  setDoc,
  query,
  where,
  limit as qLimit,
  increment,
} from "firebase/firestore";
import { db, auth } from "../lib/firebase";
import { useAuth } from "../auth/useAuth";
import {
  User,
  IdCard,
  Calendar,
  Phone,
  MapPin,
  Tag,
  Landmark,
  Users,
  Soup,
  Languages,
  ChevronDown,
  ShieldCheck,
  GitMerge,
} from "lucide-react";

/* =========================
   Mapbox (env based)
========================= */
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || "";
const GEOCODE_URL = "https://api.mapbox.com/geocoding/v5/mapbox.places";
const LB_PROX = "-118.1937,33.7701";
// California bounding box: [W,S,E,N]
const CA_BBOX = "-124.48,32.53,-114.13,42.01";
// Counties we consider "LA and surrounding"
const NEARBY_COUNTIES = new Set([
  "Los Angeles County",
  "Orange County",
  "Riverside County",
  "San Bernardino County",
  "Ventura County",
]);

/* =========================
   Sticky user prefs (localStorage)
========================= */
const PREFS_KEY = "newClientForm.prefs";
const FALLBACK_DEFAULTS = {
  zipDefault: "90813",
  countyDefault: "Los Angeles County",
  autoClose: false,
};
function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...FALLBACK_DEFAULTS };
    const p = JSON.parse(raw);
    return {
      zipDefault: p.zipDefault || FALLBACK_DEFAULTS.zipDefault,
      countyDefault: p.countyDefault || FALLBACK_DEFAULTS.countyDefault,
      autoClose: !!p.autoClose,
    };
  } catch {
    return { ...FALLBACK_DEFAULTS };
  }
}
function savePrefs(next) {
  try {
    const merged = { ...loadPrefs(), ...next };
    localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
  } catch {}
}

/* =========================
   I18N
========================= */
const I18N = {
  en: {
    titleNew: "New Intake",
    titleEdit: "Edit Client",
    language: "Language",
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
    errZip: "ZIP code must be 5 digits.",
    errOrgLoc:
      "Organization and Location are required (use the switcher in the navbar).",
    errSave: "Error saving, please try again.",
    dupFoundTitle: "Existing client found",
    dupFoundMsg:
      "There’s already a client matching these details in this organization.",
    dupLogVisit: "Log Visit for Existing",
    dupUseAnyways: "Create new anyway",
    searching: "Searching addresses…",
    noMatches: "No nearby matches",
    addrDisabled: "Address search disabled — missing Mapbox token",
    org: "Org",
    loc: "Loc",
    mergeAdmin: "Merge into Existing (Admin)",
    merging: "Merging…",
    mergedOk: "Merged into existing client ✅",
    draftLoaded: "Draft loaded",
    clear: "Clear",
    permNoCreate: "You don’t have permission to create clients.",
    permNoEdit: "You don’t have permission to edit clients.",
    permNoLog: "You don’t have permission to log visits.",
    quickOptions: "Quick options",
    homelessQuick: "Homeless/Unhoused (no fixed address)",
  },
  es: {
    titleNew: "Nueva admisión",
    titleEdit: "Editar cliente",
    language: "Idioma",
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
    errZip: "El código postal debe tener 5 dígitos.",
    errOrgLoc:
      "Se requieren Organización y Ubicación (use el selector en la barra).",
    errSave: "Error al guardar. Intente de nuevo.",
    dupFoundTitle: "Cliente existente encontrado",
    dupFoundMsg: "Ya existe un cliente con estos datos en esta organización.",
    dupLogVisit: "Registrar visita al existente",
    dupUseAnyways: "Crear nuevo de todos modos",
    searching: "Buscando direcciones…",
    noMatches: "Sin resultados cercanos",
    addrDisabled: "Búsqueda deshabilitada: falta el token de Mapbox",
    org: "Org",
    loc: "Loc",
    mergeAdmin: "Fusionar con existente (Admin)",
    merging: "Fusionando…",
    mergedOk: "Fusionado con el cliente existente ✅",
    draftLoaded: "Borrador cargado",
    clear: "Borrar",
    permNoCreate: "No tienes permiso para crear clientes.",
    permNoEdit: "No tienes permiso para editar clientes.",
    permNoLog: "No tienes permiso para registrar visitas.",
    quickOptions: "Opciones rápidas",
    homelessQuick: "Personas sin domicilio (sin dirección fija)",
  },
};
const t = (lang, key) => I18N[lang]?.[key] ?? I18N.en[key] ?? key;

/* =========================
   Helpers
========================= */
const ICONS = {
  firstName: <User size={16} className="text-brand-600 inline mr-1" />,
  lastName: <IdCard size={16} className="text-brand-600 inline mr-1" />,
  dob: <Calendar size={16} className="text-brand-600 inline mr-1" />,
  phone: <Phone size={16} className="text-brand-600 inline mr-1" />,
  address: <MapPin size={16} className="text-brand-600 inline mr-1" />,
  zip: <Tag size={16} className="text-brand-600 inline mr-1" />,
  county: <Landmark size={16} className="text-brand-600 inline mr-1" />,
  hh: <Users size={16} className="text-brand-600 inline mr-1" />,
  usda: <Soup size={16} className="text-brand-600 inline mr-1" />,
};

// Reusable header with icon + title + horizontal line
function SectionHeader({ icon, label }) {
  return (
    <div className="flex items-center gap-2 text-[11px] sm:text-xs font-semibold text-gray-700 tracking-tight">
      <span className="flex items-center gap-1 whitespace-nowrap">
        {icon}
        {label}
      </span>
      <span className="h-px flex-1 bg-gradient-to-r from-brand-200 via-brand-100 to-transparent rounded-full" />
    </div>
  );
}

const onlyDigits = (s = "") => s.replace(/\D/g, "");
const normalizePhone = onlyDigits;
const tcase = (s = "") =>
  s
    .toLowerCase()
    .replace(/[\p{L}]+('[\p{L}]+)?/gu, (w) => w[0].toUpperCase() + w.slice(1))
    .replace(/([- ][\p{L}])/gu, (m) => m[0] + m[1].toUpperCase());

const localDateKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
const monthKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
function isoWeekKey(d = new Date()) {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function resolveVisitDate(visitDateOverride) {
  const now = new Date();
  if (!visitDateOverride || typeof visitDateOverride !== "string") return now;
  if (visitDateOverride.length < 10) return now;

  const y = Number(visitDateOverride.slice(0, 4));
  const m = Number(visitDateOverride.slice(5, 7)) - 1;
  const d = Number(visitDateOverride.slice(8, 10));

  if (
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d) ||
    y < 1900 ||
    m < 0 ||
    m > 11 ||
    d < 1 ||
    d > 31
  ) {
    return now;
  }

  // Keep current time of day, just change the date
  return new Date(
    y,
    m,
    d,
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    now.getMilliseconds()
  );
}

function formatPhone(value) {
  const digits = onlyDigits(value).slice(0, 10);
  const len = digits.length;
  if (len <= 3) return digits;
  if (len <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(
    6,
    10
  )}`;
}
function handleFormKeyDown(e) {
  if (e.key !== "Enter") return;
  const el = e.target;
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute("type") || "").toLowerCase();
  const safe =
    tag === "textarea" ||
    tag === "select" ||
    tag === "button" ||
    type === "submit" ||
    type === "button";
  if (safe) return;
  e.preventDefault();
  const form = e.currentTarget;
  const focusables = Array.from(
    form.querySelectorAll("input, select, textarea")
  ).filter((n) => !n.disabled && n.type !== "hidden" && n.tabIndex !== -1);
  const idx = focusables.indexOf(el);
  if (idx > -1 && idx < focusables.length - 1) focusables[idx + 1].focus();
  else el.blur();
}
function parseFeatureAddressParts(feature) {
  const street = feature.place_type?.includes("address")
    ? `${feature.address ?? ""} ${feature.text ?? ""}`.trim()
    : feature.text || "";
  let city = "";
  let county = "";
  let zip = "";
  let region = "";
  if (Array.isArray(feature.context)) {
    for (const c of feature.context) {
      const id = c.id || "";
      if (!city && (id.startsWith("locality") || id.startsWith("place")))
        city = c.text || city;
      if (!county && id.startsWith("district")) county = c.text || county;
      if (!zip && id.startsWith("postcode"))
        zip = (c.text || "").replace(/\D/g, "");
      if (!region && id.startsWith("region")) region = c.text || region;
    }
  }
  if (
    !city &&
    (feature.place_type?.includes("place") ||
      feature.place_type?.includes("locality"))
  ) {
    city = feature.text || city;
  }
  const displayAddress =
    street && city
      ? `${street}, ${city}`
      : feature.place_name?.split(",")[0] || "";
  return { displayAddress, zip, county, region };
}
function hashDJB2(str = "") {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i);
  return `h${(h >>> 0).toString(16)}`;
}

/* Model */
const initialForm = {
  firstName: "",
  lastName: "",
  dob: "",
  phone: "",
  address: "",
  zip: "",
  county: "",
  householdSize: 1,
  firstTimeThisMonth: null,
  autoClose: false,
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
  visitDateOverride,      // "YYYY-MM-DD" from Reports (optional)
  addedByReports = false, // true when launched from Reports
}) {

  const editing = !!client?.id;
  const authCtx = useAuth() || {};
  const {
    isAdmin,
    hasCapability,
    canCreateClients,
    canEditClients,
    canLogVisits,
    canPickAllLocations,
  } = authCtx || {};

  const lsScope = (() => {
    try {
      return JSON.parse(localStorage.getItem("stc_scope") || "{}");
    } catch {
      return {};
    }
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

  const sticky = useMemo(() => loadPrefs(), [open]);

  const DRAFT_KEY = useMemo(
    () =>
      orgId ? `newClientForm.draft.${orgId}.${locationId ?? "none"}` : null,
    [orgId, locationId]
  );

  const [form, setForm] = useState(() => ({
    ...initialForm,
    zip: FALLBACK_DEFAULTS.zipDefault,
    county: FALLBACK_DEFAULTS.countyDefault,
    autoClose: sticky.autoClose, // keep user's autoClose preference only
  }));

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [dup, setDup] = useState(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);

  const [lang, setLang] = useState(() => {
    const saved = localStorage.getItem("newClientForm.lang");
    if (saved === "en" || saved === "es") return saved;
    return navigator.language?.toLowerCase().startsWith("es") ? "es" : "en";
  });
  useEffect(() => {
    localStorage.setItem("newClientForm.lang", lang);
  }, [lang]);

  // Focus + backdrop scroll lock
  const firstRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => firstRef.current?.focus(), 120);
    return () => {
      document.body.style.overflow = prev;
      clearTimeout(t);
    };
  }, [open]);

  // Load form on open
  useEffect(() => {
    if (!open) return;
    const prefs = loadPrefs();

    if (editing) {
      setForm({
        firstName: client?.firstName || "",
        lastName: client?.lastName || "",
        dob: client?.dob || "",
        phone: client?.phone || "",
        address: client?.address || "",
        zip: client?.zip || prefs.zipDefault,
        county: client?.county || prefs.countyDefault,
        householdSize: Number(client?.householdSize ?? 1),
        firstTimeThisMonth:
          typeof client?.firstTimeThisMonth === "boolean"
            ? client.firstTimeThisMonth
            : null,
        autoClose: prefs.autoClose,
      });
      setDraftLoaded(false);
    } else {
      let restored = null;
      if (DRAFT_KEY) {
        try {
          const raw = localStorage.getItem(DRAFT_KEY);
          if (raw) restored = JSON.parse(raw);
        } catch {}
      }
      if (restored && typeof restored === "object") {
        setForm({
          ...initialForm,
          ...restored,
          zip: restored.zip || FALLBACK_DEFAULTS.zipDefault,
          county: restored.county || FALLBACK_DEFAULTS.countyDefault,
          autoClose: prefs.autoClose,
          householdSize: Number(restored.householdSize ?? 1),
          firstTimeThisMonth:
            typeof restored.firstTimeThisMonth === "boolean"
              ? restored.firstTimeThisMonth
              : null,
        });

        setDraftLoaded(true);
      } else {
        setForm({
          ...initialForm,
          zip: FALLBACK_DEFAULTS.zipDefault,
          county: FALLBACK_DEFAULTS.countyDefault,
          autoClose: prefs.autoClose,
          firstTimeThisMonth: null,
        });

        setDraftLoaded(false);
      }
      savePrefs({});
    }
    setDup(null);
  }, [open, editing, client, DRAFT_KEY]); // eslint-disable-line

  useEffect(() => {
    savePrefs({ autoClose: !!form.autoClose });
  }, [form.autoClose]);

  useEffect(() => {
    if (!open || editing || !DRAFT_KEY) return;
    const id = setTimeout(() => {
      try {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({
            firstName: form.firstName ?? "",
            lastName: form.lastName ?? "",
            dob: form.dob ?? "",
            phone: form.phone ?? "",
            address: form.address ?? "",
            householdSize: Number(form.householdSize || 1),
            firstTimeThisMonth:
              typeof form.firstTimeThisMonth === "boolean"
                ? form.firstTimeThisMonth
                : null,
          })
        );
      } catch {}
    }, 350);
    return () => clearTimeout(id);
  }, [open, editing, DRAFT_KEY, form]);

  const clearDraft = useCallback(() => {
    if (!DRAFT_KEY) return;
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {}
    setDraftLoaded(false);
  }, [DRAFT_KEY]);

  /* =========================
     Address autocomplete + Homeless quick-pick
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

  // Quick action: choose Homeless/Unhoused
  const chooseHomeless = useCallback(() => {
    const prefs = loadPrefs();
    setForm((f) => ({
      ...f,
      address: "Homeless/Unhoused",
      zip: prefs.zipDefault,
      county: prefs.countyDefault,
    }));
    setSuggestions([]);
    setShowDropdown(false);
    setAddrLocked(true);
    setLastPicked("Homeless/Unhoused");
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!addrEnabled) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    const qRaw = addrQ || "";
    const q = qRaw.trim();

    const showQuick = q.length === 0;

    if (showQuick && !addrLocked) {
      setSuggestions([]);
      setShowDropdown(true);
    }

    if (q.length < 3 || addrLocked) {
      setSuggestions([]);
      setShowDropdown(showQuick && !addrLocked);
      return;
    }

    let alive = true;
    const id = setTimeout(async () => {
      setAddrLoading(true);
      try {
        const url = new URL(`${GEOCODE_URL}/${encodeURIComponent(q)}.json`);
        url.searchParams.set("access_token", MAPBOX_TOKEN);
        url.searchParams.set("autocomplete", "true");
        url.searchParams.set("proximity", LB_PROX);
        url.searchParams.set("country", "US");
        url.searchParams.set("bbox", CA_BBOX);
        url.searchParams.set("limit", "7");
        url.searchParams.set("types", "address,locality,place,poi");

        const res = await fetch(url.toString());
        const data = await res.json();
        const feats = Array.isArray(data.features) ? data.features : [];

        const cleaned = feats
          .map((f) => ({
            id: f.id,
            place_name: f.place_name,
            text: f.text,
            address: f.address,
            place_type: f.place_type || [],
            context: f.context || [],
            _raw: f,
          }))
          .filter((f) => {
            const { region, county } = parseFeatureAddressParts(f._raw);
            const inCA = (region || "").toLowerCase().includes("california");
            if (!inCA) return false;
            if (county) return true;
            return true;
          })
          .sort((a, b) => {
            const pa = NEARBY_COUNTIES.has(
              parseFeatureAddressParts(a._raw).county || ""
            );
            const pb = NEARBY_COUNTIES.has(
              parseFeatureAddressParts(b._raw).county || ""
            );
            return Number(pb) - Number(pa);
          });

        if (alive) {
          setSuggestions(cleaned);
          setShowDropdown(cleaned.length > 0 || showQuick);
        }
      } catch {
        if (alive) {
          setSuggestions([]);
          setShowDropdown(showQuick);
        }
      } finally {
        if (alive) setAddrLoading(false);
      }
    }, 220);
    return () => {
      clearTimeout(id);
      alive = false;
    };
  }, [addrQ, addrLocked, open, addrEnabled]);

  useEffect(() => {
    if (!showDropdown) return;
    const onDocClick = (e) => {
      if (
        !addrBoxRef.current?.contains(e.target) &&
        !dropdownRef.current?.contains(e.target)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [showDropdown]);

  function onPickSuggestion(feat) {
    const { displayAddress, zip, county } = parseFeatureAddressParts(
      feat._raw || feat
    );
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
    const len = v.trim().length;
    setShowDropdown(len === 0 ? !addrLocked : len >= 3);
  }

  /* =========================
     Validation & dedupe
  ========================== */
  function validate() {
    if (editing) {
      if (!canEditClients && !(hasCapability && hasCapability("editClients"))) {
        return t(lang, "permNoEdit");
      }
    } else {
      const canCreate =
        canCreateClients || (hasCapability && hasCapability("createClients"));
      const canLog =
        canLogVisits || (hasCapability && hasCapability("logVisits"));
      if (!canCreate) return t(lang, "permNoCreate");
      if (!canLog) return t(lang, "permNoLog");
    }

    const fn = form.firstName.trim();
    const ln = form.lastName.trim();
    if (!fn || !ln) return t(lang, "errRequiredName");
    const zip = (form.zip || "").trim();
    if (!zip) return "ZIP code is required";
    if (!/^\d{5}$/.test(zip)) return t(lang, "errZip");
    if (!form.county?.trim()) return "County is required";
    if (!orgId || !locationId) return t(lang, "errOrgLoc");
    return "";
  }

  async function preflightDedupe({ phoneDigits, nameDobHash }) {
    const baseFilters = [where("orgId", "==", orgId)];
    if (!canPickAllLocations && locationId)
      baseFilters.push(where("locationId", "==", locationId));

    if (phoneDigits) {
      const qs = await getDocs(
        query(
          collection(db, "clients"),
          ...baseFilters,
          where("phoneDigits", "==", phoneDigits),
          qLimit(1)
        )
      );
      if (!qs.empty) {
        const d = qs.docs[0];
        return { id: d.id, ...(d.data() || {}) };
      }
    }
    if (nameDobHash) {
      const qs2 = await getDocs(
        query(
          collection(db, "clients"),
          ...baseFilters,
          where("nameDobHash", "==", nameDobHash),
          qLimit(1)
        )
      );
      if (!qs2.empty) {
        const d = qs2.docs[0];
        return { id: d.id, ...(d.data() || {}) };
      }
    }
    return null;
  }

  /* =========================
     Submit
  ========================== */
  const buildBasePayload = useCallback(() => {
    const firstName = tcase(form.firstName.trim());
    const lastName = tcase(form.lastName.trim());
    const fullNameLower = `${firstName} ${lastName}`.trim().toLowerCase();
    const nameDobHash = hashDJB2(`${fullNameLower}|${form.dob || ""}`);
    const phoneDigits = normalizePhone(form.phone);
    return {
      firstName,
      lastName,
      dob: form.dob.trim(),
      phone: form.phone.trim(),
      phoneDigits,
      address: form.address.trim(),
      zip: (form.zip || "").trim(),
      county: (form.county || "").trim(),
      householdSize: Number(form.householdSize || 1),
      firstTimeThisMonth:
        typeof form.firstTimeThisMonth === "boolean"
          ? form.firstTimeThisMonth
          : null,
      fullNameLower,
      nameDobHash,
    };
  }, [form]);

  async function saveClient({ force = false } = {}) {
    if (busy) return;
    const v = validate();
    if (v) {
      setMsg(v);
      return;
    }

    setBusy(true);
    setMsg("");
    if (!force) setDup(null);

    try {
      const base = buildBasePayload();
      const { firstName, lastName, nameDobHash, phoneDigits } = base;
      let createdId = client?.id;

      if (!editing && !force) {
        const existing = await preflightDedupe({ phoneDigits, nameDobHash });
        if (existing) {
          setDup(existing);
          setMsg(t(lang, "dupFoundMsg"));
          setBusy(false);
          return;
        }
      }

      if (!editing) {
        const clientRef = doc(collection(db, "clients"));
        await setDoc(clientRef, {
          ...base,
          orgId,
          locationId,
          createdAt: serverTimestamp(),
          createdByUserId: auth.currentUser?.uid || null,
          updatedAt: serverTimestamp(),
          updatedByUserId: auth.currentUser?.uid || null,
          inactive: false,
          mergedIntoId: null,
          visitCountLifetime: 0,
          visitCountByMonth: {},
          lastVisitAt: null,
          lastVisitMonthKey: null,
        });

       if (form.firstTimeThisMonth === true) {
          const when = resolveVisitDate(visitDateOverride);
          const mk = monthKey(when);
          const markerRef = doc(
            db,
            "usda_first",
            `${orgId}_${clientRef.id}_${mk}`
          );
          try {
            await setDoc(markerRef, {
              clientId: clientRef.id,
              orgId,
              locationId,
              monthKey: mk,
              createdAt: serverTimestamp(),
              createdByUserId: auth.currentUser?.uid || null,
            });
          } catch {}
        }


        await runTransaction(db, async (tx) => {
          const when = resolveVisitDate(visitDateOverride);
          const mk = monthKey(when);
          const dk = localDateKey(when);
          const wk = isoWeekKey(when);
          const weekday = when.getDay();

          const visitRef = doc(collection(db, "visits"));
          tx.set(visitRef, {
            clientId: dup.id,
            clientFirstName: dup.firstName || "",
            clientLastName: dup.lastName || "",
            clientAddress: dup.address || "",
            clientZip: dup.zip || "",
            clientCounty: dup.county || "",
            orgId,
            locationId,
            householdSize: Number(form.householdSize || 1),
            visitAt: when,
            createdAt: serverTimestamp(),
            monthKey: mk,
            dateKey: dk,
            weekKey: wk,
            weekday,
            usdaFirstTimeThisMonth: wantsUsdaFirst,
            createdByUserId: auth.currentUser?.uid || null,
            editedAt: null,
            editedByUserId: null,
            addedByReports: !!addedByReports,
          });



          const clientRef2 = doc(db, "clients", clientRef.id);
          tx.set(
            clientRef2,
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


        createdId = clientRef.id;
      } else {
        await runTransaction(db, async (tx) => {
          if (!client?.id) throw new Error("Missing client id for edit.");
          const clientRef = doc(db, "clients", client.id);
          tx.set(
            clientRef,
            {
              ...base,
              updatedAt: serverTimestamp(),
              updatedByUserId: auth.currentUser?.uid || null,
            },
            { merge: true }
          );
          createdId = clientRef.id;
        });
      }

      const saved = {
        id: createdId,
        ...(editing ? { ...client } : { orgId, locationId }),
        ...base,
      };
      onSaved?.(saved);
      setMsg(editing ? t(lang, "savedEdit") : t(lang, "savedMsg"));
      setDup(null);

      if (!editing) clearDraft();

      const prefsNow = loadPrefs();
      const changedZip = form.zip && form.zip !== prefsNow.zipDefault;
      const changedCounty =
        form.county &&
        form.county.trim() &&
        form.county !== prefsNow.countyDefault;
      if (changedZip || changedCounty) {
        savePrefs({
          zipDefault: changedZip ? form.zip : prefsNow.zipDefault,
          countyDefault: changedCounty
            ? form.county
            : prefsNow.countyDefault,
        });
      }

      if (!editing) {
        if (form.autoClose) {
          onClose?.();
        } else {
          const prefs = loadPrefs();
          setForm({
            ...initialForm,
            zip: FALLBACK_DEFAULTS.zipDefault,
            county: FALLBACK_DEFAULTS.countyDefault,
            autoClose: prefs.autoClose,
            firstTimeThisMonth: null,
          });

          setAddrLocked(false);
          setLastPicked("");
          firstRef.current?.focus();
        }
      }
    } catch (err) {
      console.error(err);
      setMsg(t(lang, "errSave"));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    await saveClient({ force: false });
  }
  async function createAnyway() {
    await saveClient({ force: true });
  }

  async function logVisitForDuplicate() {
    if (!dup?.id || busy) return;
    const canLog =
      canLogVisits || (hasCapability && hasCapability("logVisits"));
    if (!canLog) {
      setMsg(t(lang, "permNoLog"));
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      await runTransaction(db, async (tx) => {
        const when = resolveVisitDate(visitDateOverride);
        const mk = monthKey(when);
        const dk = localDateKey(when);
        const wk = isoWeekKey(when);
        const weekday = when.getDay();

        const wantsUsdaFirst = form.firstTimeThisMonth === true;
        if (wantsUsdaFirst) {
          const markerRef = doc(db, "usda_first", `${orgId}_${dup.id}_${mk}`);
          const markerSnap = await tx.get(markerRef);
          if (!markerSnap.exists()) {
            tx.set(markerRef, {
              clientId: dup.id,
              orgId,
              locationId,
              monthKey: mk,
              createdAt: serverTimestamp(),
              createdByUserId: auth.currentUser?.uid || null,
            });
          }
        }

        const visitRef = doc(collection(db, "visits"));
        tx.set(visitRef, {
          clientId: dup.id,
          clientFirstName: dup.firstName || "",
          clientLastName: dup.lastName || "",
          orgId,
          locationId,
          householdSize: Number(form.householdSize || 1),
          visitAt: when,
          createdAt: serverTimestamp(),
          monthKey: mk,
          dateKey: dk,
          weekKey: wk,
          weekday,
          usdaFirstTimeThisMonth: wantsUsdaFirst,
          createdByUserId: auth.currentUser?.uid || null,
          editedAt: null,
          editedByUserId: null,
          addedByReports: !!addedByReports,
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

      const prefs = loadPrefs();
      setForm({
        ...initialForm,
        zip: prefs.zipDefault,
        county: prefs.countyDefault,
        autoClose: prefs.autoClose,
        firstTimeThisMonth: null,
      });
      setAddrLocked(false);
      setLastPicked("");
      clearDraft();
      firstRef.current?.focus();
    } catch (e) {
      console.error(e);
      setMsg("Couldn’t log visit for the existing client.");
    } finally {
      setBusy(false);
    }
  }

  async function mergeIntoExistingAdmin() {
    if (!isAdmin || !dup?.id) return;
    const ok = confirm(
      "Merge this intake into the existing client?\n\nThis will keep the existing client's ID and optionally update blank contact fields. No new client will be created."
    );
    if (!ok) return;

    try {
      setMergeBusy(true);
      const targetRef = doc(db, "clients", dup.id);
      const base = buildBasePayload();
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(targetRef);
        if (!snap.exists()) throw new Error("Target client no longer exists.");
        const cur = snap.data() || {};
        const patch = {
          phone: cur.phone || base.phone || cur.phone || "",
          phoneDigits:
            cur.phoneDigits ||
            normalizePhone(base.phone) ||
            cur.phoneDigits ||
            "",
          address: cur.address || base.address || cur.address || "",
          zip: cur.zip || base.zip || cur.zip || "",
          county: cur.county || base.county || cur.county || "",
          updatedAt: serverTimestamp(),
          updatedByUserId: auth.currentUser?.uid || null,
        };
        tx.set(targetRef, patch, { merge: true });
      });

      setMsg(t(lang, "mergedOk"));
      onSaved?.({ ...(dup || {}) });
      setDup(null);

      const prefs = loadPrefs();
      setForm({
        ...initialForm,
        zip: prefs.zipDefault,
        county: prefs.countyDefault,
        autoClose: prefs.autoClose,
        firstTimeThisMonth: null,
      });
      setAddrLocked(false);
      setLastPicked("");
      clearDraft();
      firstRef.current?.focus();
    } catch (e) {
      console.error("mergeIntoExistingAdmin error:", e);
      alert(e?.message || "Merge failed. Try again.");
    } finally {
      setMergeBusy(false);
    }
  }

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

  if (!open) return null;

  const showAssist = lang === "es";
  const dual = (primary, hint) => (
    <span className="flex flex-col">
      <span>{primary}</span>
      {showAssist && (
        <span className="text-[11px] text-gray-500">{hint}</span>
      )}
    </span>
  );

  const canSubmitNew =
    (canCreateClients || (hasCapability && hasCapability("createClients"))) &&
    (canLogVisits || (hasCapability && hasCapability("logVisits")));
  const canSubmitEdit =
    canEditClients || (hasCapability && hasCapability("editClients"));

  const quickMode = !form.address || !form.address.trim();

  return (
    <div className="fixed inset-0 z-[1000]">
      {/* Backdrop */}
      <button
        aria-label="Close"
        className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
        onClick={() => {
          onClose?.();
          clearDraft();
        }}
      />

      {/* Modal shell — bottom sheet on mobile; centered card on desktop */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-client-title"
        className="
          absolute left-1/2 -translate-x-1/2 w-full sm:w-[min(560px,94vw)]
          bottom-0 sm:bottom-auto sm:top-[55%] sm:-translate-y-1/2
          bg-white sm:rounded-3xl rounded-t-3xl shadow-2xl ring-1 ring-brand-200/70
          overflow-hidden flex flex-col
          sm:max-h-[90vh]
        "
        style={{
          // Lower the dialog on mobile so the header sits further from the
          // browser chrome / notch. Increase the top margin while still
          // respecting the safe-area inset.
          maxHeight: "calc(100vh - 120px)",
          marginTop: `calc(env(safe-area-inset-top, 44px) + 56px)`,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header (sticky) */}
        <div className="sticky top-0 z-10" style={{ paddingTop: "env(safe-area-inset-top, 12px)", top: "env(safe-area-inset-top, 12px)" }}>
          <div className="bg-gradient-to-r from-[color:var(--brand-700)] to-[color:var(--brand-600)] text-white border-b shadow-sm">
            <div className="px-3.5 sm:px-6 py-2.5 sm:py-4">
              <div className="flex items-center justify-between gap-3 sm:gap-6">
                {/* Title + avatar */}
                <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
                  <div className="shrink-0 h-10 w-10 rounded-2xl bg-white/15 text-white grid place-items-center font-semibold ring-1 ring-white/20">
                    {initials === "👤" ? (
                      <User
                        className="h-5 w-5 text-white/95"
                        aria-hidden="true"
                      />
                    ) : (
                      <span>{initials}</span>
                    )}
                  </div>

                  <div className="min-w-0">
                    <h2
                      id="new-client-title"
                      className="text-base sm:text-xl font-semibold truncate"
                    >
                      {editing ? t(lang, "titleEdit") : t(lang, "titleNew")}
                    </h2>
                    <div className="mt-0.5 text-[11px] sm:text-xs opacity-90 leading-tight">
                      <div className="truncate">
                        {t(lang, "org")}: <b>{orgId ?? "—"}</b>
                      </div>
                      <div className="truncate">
                        {t(lang, "loc")}: <b>{locationId ?? "—"}</b>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Language + Close */}
                <div className="flex items-center gap-2 shrink-0">
                  <label className="sr-only" htmlFor="lang-select">
                    {t(lang, "language")}
                  </label>
                  <div className="relative shrink-0">
                    <Languages
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[color:var(--brand-700)] z-20 pointer-events-none"
                      aria-hidden="true"
                    />
                    <ChevronDown
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[color:var(--brand-700)] z-20 pointer-events-none"
                      aria-hidden="true"
                    />
                    <select
                      id="lang-select"
                      value={lang}
                      onChange={(e) => setLang(e.target.value)}
                      className="h-8 sm:h-9 min-w-[104px] appearance-none pl-8 pr-6 rounded-lg
                         bg-white/95 border border-white/60 shadow-sm
                         text-[color:var(--brand-700)] text-xs sm:text-sm font-medium leading-none
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                      aria-label={t(lang, "language")}
                    >
                      <option value="en">English</option>
                      <option value="es">Español</option>
                    </select>
                  </div>

                  <button
                    onClick={() => {
                      onClose?.();
                      clearDraft();
                    }}
                    className="rounded-xl px-4 sm:px-5 h-11 sm:h-12 text-xl sm:text-2xl hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 shrink-0"
                    aria-label="Close"
                    title="Close"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* draftLoaded indicator removed — drafts still saved/cleared in code */}
            </div>
          </div>
        </div>

        {/* Body (scroll area) */}
        <form
          id="new-client-form"
          onSubmit={onSubmit}
          onKeyDown={handleFormKeyDown}
          noValidate
          className="flex-1 overflow-y-auto overflow-x-hidden px-4 md:px-6 py-4 md:py-6 space-y-4 text-[17px] pretty-scroll"
          style={{
            maxHeight: "calc(100vh - 220px)",
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
        >
          {/* ==== Section: Basic info (names + DOB + phone) ==== */}
          <section className="rounded-2xl border border-brand-200 bg-white shadow-sm p-3 sm:p-4 space-y-3">
            <SectionHeader
              icon={ICONS.firstName}
              label={dual(
                <>Client details</>,
                "Name and basic information"
              )}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 min-w-0">
                <span className="text-[11px] font-medium text-gray-600">
                  {dual(
                    <>
                      {ICONS.firstName}
                      {t(lang, "firstName")}
                    </>,
                    "First name"
                  )}
                </span>
                <input
                  ref={firstRef}
                  className="w-full bg-white border border-brand-200 rounded-2xl p-3 h-11 shadow-inner/5 focus:outline-none focus:ring-4 focus:ring-brand-200 focus:border-brand-400"
                  name="firstName"
                  placeholder="e.g., Brian"
                  autoCapitalize="words"
                  autoComplete="given-name"
                  enterKeyHint="next"
                  value={form.firstName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, firstName: e.target.value }))
                  }
                  required
                />
              </label>
              <label className="flex flex-col gap-1 min-w-0">
                <span className="text-[11px] font-medium text-gray-600">
                  {dual(
                    <>
                      {ICONS.lastName}
                      {t(lang, "lastName")}
                    </>,
                    "Last name"
                  )}
                </span>
                <input
                  className="w-full bg-white border border-brand-200 rounded-2xl p-3 h-11 shadow-inner/5 focus:outline-none focus:ring-4 focus:ring-brand-200 focus:border-brand-400"
                  name="lastName"
                  placeholder="e.g., Aiad"
                  autoCapitalize="words"
                  autoComplete="family-name"
                  enterKeyHint="next"
                  value={form.lastName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, lastName: e.target.value }))
                  }
                  required
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 min-w-0">
                <span className="text-[11px] font-medium text-gray-600">
                  {dual(
                    <>
                      {ICONS.dob}
                      {t(lang, "dob")}
                    </>,
                    "Date of birth"
                  )}
                </span>
                <input
                  className="w-full bg-white border border-brand-200 rounded-2xl p-3 h-11 shadow-inner/5 focus:outline-none focus:ring-4 focus:ring-brand-200 focus:border-brand-400"
                  type="date"
                  name="dob"
                  autoComplete="bday"
                  value={form.dob}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, dob: e.target.value }))
                  }
                  max={new Date().toISOString().slice(0, 10)}
                  enterKeyHint="next"
                />
              </label>
              <label className="flex flex-col gap-1 min-w-0">
                <span className="text-[11px] font-medium text-gray-600">
                  {dual(
                    <>
                      {ICONS.phone}
                      {t(lang, "phone")}
                    </>,
                    "Phone"
                  )}
                </span>
                <input
                  className="w-full bg-white border border-brand-200 rounded-2xl p-3 h-11 shadow-inner/5 focus:outline-none focus:ring-4 focus:ring-brand-200 focus:border-brand-400"
                  name="phone"
                  placeholder="(310) 254-1234"
                  inputMode="tel"
                  autoComplete="tel"
                  enterKeyHint="next"
                  value={form.phone}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      phone: formatPhone(e.target.value),
                    }))
                  }
                />
              </label>
            </div>
          </section>

          {/* ==== Section: Address + zip/county ==== */}
          <section className="rounded-2xl border border-brand-200 bg-white shadow-sm p-3 sm:p-4 space-y-3">
            <SectionHeader
              icon={ICONS.address}
              label={dual(
                <>Address & area</>,
                "Where the client stays most nights"
              )}
            />

            <div className="flex flex-col gap-1">
              <input
                ref={addrBoxRef}
                disabled={!addrEnabled}
                className="w-full bg-white border border-brand-200 rounded-2xl p-3 h-11 shadow-inner/5 focus:outline-none focus:ring-4 focus:ring-brand-200 focus:border-brand-400 disabled:bg-gray-50 disabled:text-gray-500"
                placeholder={
                  addrEnabled
                    ? "e.g., 185 Harvard Dr, Seal Beach"
                    : t(lang, "addrDisabled")
                }
                value={form.address}
                onChange={onAddressInputChange}
                enterKeyHint="next"
                autoComplete="street-address"
                onFocus={() => {
                  if (!addrEnabled) return;
                  const empty = !form.address || !form.address.trim();
                  setShowDropdown(empty && !addrLocked);
                }}
                aria-autocomplete="list"
                aria-expanded={addrEnabled && showDropdown ? "true" : "false"}
                aria-controls="addr-nearby-panel"
              />

              {addrEnabled && showDropdown && (
                <div
                  id="addr-nearby-panel"
                  ref={dropdownRef}
                  className="mt-2 rounded-2xl border border-brand-200 bg-white shadow-soft overflow-hidden"
                  role="listbox"
                  aria-label="Nearby results"
                >
                  {/* Quick options — only when input is empty */}
                  {quickMode && (
                    <>
                      <div className="px-3 py-2 text-[11px] font-medium text-gray-600 bg-gray-50 border-b">
                        {t(lang, "quickOptions")}
                      </div>
                      <ul className="divide-y">
                        <li>
                          <button
                            type="button"
                            role="option"
                            className="w-full text-left px-3 py-2 text-sm hover:bg-brand-50 focus:bg-brand-50 focus:outline-none"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              chooseHomeless();
                            }}
                            title={t(lang, "homelessQuick")}
                          >
                            {t(lang, "homelessQuick")}
                          </button>
                        </li>
                      </ul>
                    </>
                  )}

                  {/* Nearby results — only when user has typed */}
                  {!quickMode && (
                    <>
                      <div className="px-3 py-2 text-[11px] font-medium text-gray-600 bg-gray-50 border-y">
                        {addrLoading ? t(lang, "searching") : "Nearby results"}
                      </div>
                      <ul className="max-h-48 sm:max-h-64 overflow-y-auto divide-y pretty-scroll pr-1">
                        {!addrLoading && suggestions.length === 0 && (
                          <li className="px-3 py-2 text-sm text-gray-600">
                            {t(lang, "noMatches")}
                          </li>
                        )}
                        {suggestions.map((sug) => (
                          <li key={sug.id}>
                            <button
                              type="button"
                              role="option"
                              className="w-full text-left px-3 py-2 text-sm hover:bg-brand-50 focus:bg-brand-50 focus:outline-none"
                              onMouseDown={(e) => e.preventDefault()}
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
                    </>
                  )}

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

              <div className="grid grid-cols-2 gap-3 mt-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-gray-600">
                    {dual(
                      <>
                        {ICONS.zip}
                        {t(lang, "zip")}
                      </>,
                      "ZIP code"
                    )}
                  </span>
                  <input
                    className="w-full bg-white border border-brand-200 rounded-2xl p-3 h-11 shadow-inner/5 focus:outline-none focus:ring-4 focus:ring-brand-200 focus:border-brand-400"
                    name="zip"
                    placeholder={lang === "es" ? "Código postal" : "ZIP code"}
                    value={form.zip}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, zip: e.target.value }))
                    }
                    onBlur={() => {
                      const v = (form.zip || "").trim();
                      if (/^\d{5}$/.test(v)) savePrefs({ zipDefault: v });
                    }}
                    inputMode="numeric"
                    pattern="\d{5}"
                    autoComplete="postal-code"
                    enterKeyHint="next"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-gray-600">
                    {dual(
                      <>
                        {ICONS.county}
                        {t(lang, "county")}
                      </>,
                      "County"
                    )}
                  </span>
                  <input
                    className="w-full bg-white border border-brand-200 rounded-2xl p-3 h-11 shadow-inner/5 focus:outline-none focus:ring-4 focus:ring-brand-200 focus:border-brand-400"
                    name="county"
                    placeholder={lang === "es" ? "Condado" : "County"}
                    value={form.county}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, county: e.target.value }))
                    }
                    onBlur={() => {
                      const v = (form.county || "").trim();
                      if (v) savePrefs({ countyDefault: v });
                    }}
                    enterKeyHint="next"
                  />
                </label>
              </div>
            </div>
          </section>

          {/* ==== Section: Household + USDA, matching LogVisit style ==== */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Household size boxed section */}
            <div className="rounded-2xl border border-brand-200 bg-white shadow-sm p-3 sm:p-4">
              <SectionHeader
                icon={ICONS.hh}
                label={dual(
                  t(lang, "hhSize"),
                  "Number of people in household"
                )}
              />
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  aria-label="Decrease household size"
                  className="h-11 w-11 rounded-2xl border border-brand-300 text-brand-800 bg-white grid place-items-center text-xl font-semibold shadow-sm hover:bg-brand-50 hover:border-brand-400 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      householdSize: Math.max(
                        1,
                        Number(f.householdSize) - 1
                      ),
                    }))
                  }
                >
                  –
                </button>
                <div className="h-11 min-w-[88px] px-4 rounded-2xl border border-brand-400 bg-brand-50 text-brand-900 grid place-items-center shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-brand-200/70">
                  <span className="text-lg font-semibold tabular-nums">
                    {form.householdSize}
                  </span>
                </div>
                <button
                  type="button"
                  aria-label="Increase household size"
                  className="h-11 w-11 rounded-2xl border border-brand-300 text-brand-800 bg-white grid place-items-center text-xl font-semibold shadow-sm hover:bg-brand-50 hover:border-brand-400 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      householdSize: Math.min(
                        20,
                        Number(f.householdSize) + 1
                      ),
                    }))
                  }
                >
                  +
                </button>
              </div>
              <p className="mt-1 text-[11px] text-gray-500">
                Pick a number from 1 to 20.
              </p>
            </div>

            {/* USDA boxed section */}
            {!editing && (
              <div className="rounded-2xl border border-brand-200 bg-white shadow-sm p-3 sm:p-4">
                <SectionHeader
                  icon={ICONS.usda}
                  label={dual(
                    t(lang, "usdaThisMonth"),
                    "USDA status for this month only"
                  )}
                />
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label
                    className={`h-11 rounded-2xl border grid place-items-center text-sm font-semibold cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200 ${
                      form.firstTimeThisMonth === true
                        ? "bg-gradient-to-b from-[color:var(--brand-600)] to-[color:var(--brand-700)] text-white border-[color:var(--brand-700)] ring-1 ring-brand-700/50 shadow-[0_6px_14px_-6px_rgba(199,58,49,0.35)]"
                        : "bg-white text-brand-900 border-brand-300 hover:bg-brand-50 hover:border-brand-400"
                    }`}
                  >
                    <input
                      type="radio"
                      name="usdaFirstThisMonth"
                      className="sr-only"
                      checked={form.firstTimeThisMonth === true}
                      onChange={() =>
                        setForm((f) => ({
                          ...f,
                          firstTimeThisMonth: true,
                        }))
                      }
                    />
                    {t(lang, "yes")}
                  </label>
                  <label
                    className={`h-11 rounded-2xl border grid place-items-center text-sm font-semibold cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200 ${
                      form.firstTimeThisMonth === false
                        ? "bg-gradient-to-b from-[color:var(--brand-600)] to-[color:var(--brand-700)] text-white border-[color:var(--brand-700)] ring-1 ring-brand-700/50 shadow-[0_6px_14px_-6px_rgba(199,58,49,0.35)]"
                        : "bg-white text-brand-900 border-brand-300 hover:bg-brand-50 hover:border-brand-400"
                    }`}
                  >
                    <input
                      type="radio"
                      name="usdaFirstThisMonth"
                      className="sr-only"
                      checked={form.firstTimeThisMonth === false}
                      onChange={() =>
                        setForm((f) => ({
                          ...f,
                          firstTimeThisMonth: false,
                        }))
                      }
                    />
                    {t(lang, "no")}
                  </label>
                </div>
                <p className="mt-2 text-[11px] text-gray-500">
                  {t(lang, "tipUsda")}
                </p>
              </div>
            )}
          </section>

          {/* Duplicate card */}
          {dup && (
            <div className="rounded-2xl border bg-amber-50 ring-1 ring-amber-200 p-4 space-y-2">
              <div className="font-semibold text-amber-900">
                {t(lang, "dupFoundTitle")}
              </div>
              <div className="text-sm text-amber-900/90">
                {t(lang, "dupFoundMsg")}
              </div>
              <div className="text-sm text-amber-900/90">
                <span className="font-medium">
                  {dup.firstName} {dup.lastName}
                </span>
                {!!dup.address && ` • ${dup.address}`} {!!dup.zip && ` ${dup.zip}`}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={logVisitForDuplicate}
                  disabled={
                    busy ||
                    mergeBusy ||
                    !(
                      canLogVisits ||
                      (hasCapability && hasCapability("logVisits"))
                    )
                  }
                  className="h-10 px-3 rounded-xl bg-[color:var(--brand-700)] text-white text-sm font-medium hover:bg-[color:var(--brand-600)] disabled:opacity-50"
                >
                  {t(lang, "dupLogVisit")}
                </button>
                <button
                  type="button"
                  disabled={
                    busy ||
                    mergeBusy ||
                    !(
                      canCreateClients ||
                      (hasCapability && hasCapability("createClients"))
                    )
                  }
                  onClick={createAnyway}
                  className="h-10 px-3 rounded-xl border text-sm hover:bg-gray-50 disabled:opacity-50"
                  title="Create a brand-new client even if a match exists"
                >
                  {t(lang, "dupUseAnyways")}
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={mergeIntoExistingAdmin}
                    disabled={busy || mergeBusy}
                    className="h-10 px-3 inline-flex items-center gap-2 rounded-xl border text-sm hover:bg-gray-50 disabled:opacity-50"
                    title="Merge this intake’s details into the existing client (no new client will be created)"
                  >
                    <GitMerge className="h-4 w-4" />
                    {mergeBusy ? t(lang, "merging") : t(lang, "mergeAdmin")}
                  </button>
                )}
              </div>
            </div>
          )}
        </form>

        {/* Consent notice */}
        <div className="mt-1 text-[9px] leading-snug text-gray-400 text-center px-2 max-w-md mx-auto">
          Client consents to data collection for food program eligibility. Data
          stays within organization unless required by law.
        </div>

        {/* Footer (sticky) */}
        <div
          className="sticky bottom-0 z-10 bg-white/95 backdrop-blur px-3 sm:px-6 pt-2 pb-4 flex flex-col items-center"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
        >
          <div className="w-full h-px bg-gray-200 mb-2" />
          <div className="flex items-center justify-between gap-2 w-full max-w-md mx-auto">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                checked={form.autoClose}
                onChange={(e) =>
                  setForm((f) => ({ ...f, autoClose: e.target.checked }))
                }
              />
              <span className="text-xs sm:text-sm text-gray-700 font-medium">
                Auto-Close After Save
              </span>
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onClose?.();
                  clearDraft();
                }}
                className="h-9 sm:h-10 px-4 sm:px-5 rounded-xl border border-brand-300 text-brand-800 bg-white hover:bg-brand-50 hover:border-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200 text-xs sm:text-sm font-semibold"
              >
                {t(lang, "cancel")}
              </button>
              <button
                type="submit"
                form="new-client-form"
                disabled={
                  busy || mergeBusy || (editing ? !canSubmitEdit : !canSubmitNew)
                }
                className="h-12 sm:h-14 w-44 sm:w-56 px-6 sm:px-8 rounded-xl bg-[color:var(--brand-700)] text-white font-bold text-base sm:text-xl whitespace-nowrap shadow-md hover:bg-[color:var(--brand-600)] active:bg-[color:var(--brand-800)] disabled:opacity-50 transition-all duration-150"
                title={
                  editing
                    ? !canSubmitEdit
                      ? t(lang, "permNoEdit")
                      : ""
                    : !canSubmitNew
                    ? `${!canCreateClients ? t(lang, "permNoCreate") : ""} ${
                        !canLogVisits ? t(lang, "permNoLog") : ""
                      }`.trim()
                    : ""
                }
              >
                {busy
                  ? "Saving…"
                  : editing
                  ? t(lang, "save")
                  : t(lang, "saveLog")}
              </button>
            </div>
          </div>

          {msg && (
            <div
              className="mt-2 text-sm text-gray-700"
              role="status"
              aria-live="polite"
            >
              {msg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
