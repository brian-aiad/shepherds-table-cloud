// src/components/NewClientForm.jsx
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  collection,
  doc,
  serverTimestamp,
  runTransaction,
  getDocs,
  query,
  where,
  limit as qLimit,
} from "firebase/firestore";
import { db, auth } from "../lib/firebase";
import { useAuth } from "../auth/useAuth";

/* ===========================
   Localized strings (EN/ES)
=========================== */
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
    hhSize: "Household size",
    usdaThisMonth: "First time receiving USDA this month",
    yes: "Yes",
    no: "No",
    tipUsda: "Tap one. This is for this month only.",
    closeAfterSave: "Close after save",
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
    dupFoundMsg: "There’s already a client with this phone number in this org.",
    dupLogVisit: "Log Visit for Existing",
    dupUseAnyways: "Create new anyway",
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
    hhSize: "Número de personas en el hogar",
    usdaThisMonth: "¿Primera vez recibiendo USDA este mes?",
    yes: "Sí",
    no: "No",
    tipUsda: "Elija una opción. Aplica solo a este mes.",
    closeAfterSave: "Cerrar después de guardar",
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
    dupFoundMsg: "Ya existe un cliente con este teléfono en esta organización.",
    dupLogVisit: "Registrar visita al existente",
    dupUseAnyways: "Crear nuevo de todos modos",
  },
};
const t = (lang, key) => I18N[lang]?.[key] ?? I18N.en[key] ?? key;

/* ===========================
   Helpers
=========================== */
const normalizePhone = (s = "") => s.replace(/\D/g, "");
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

// Phone mask “(xxx) xxx-xxxx”
function formatPhone(value) {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  const len = digits.length;
  if (len <= 3) return digits;
  if (len <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

// Prevent Enter from submitting; move focus to next field
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

const initialForm = {
  firstName: "",
  lastName: "",
  dob: "",
  phone: "",
  address: "",
  zip: "",
  householdSize: 1,
  firstTimeThisMonth: true,
};

/* ===========================
   Component
=========================== */
export default function NewClientForm({
  open,
  onClose,
  onSaved,
  client,
  defaultOrgId,
  defaultLocationId,
}) {
  const editing = !!client?.id;

  // Auth / active org & location (multi-org aware)
  const authCtx = useAuth() || {};
  const orgId =
    defaultOrgId ??
    authCtx.org?.id ??
    authCtx.activeOrgId ??
    authCtx.activeOrg?.id ??
    authCtx.orgId ??
    null;
  const locationId =
    defaultLocationId ??
    authCtx.location?.id ??
    authCtx.activeLocationId ??
    authCtx.activeLocation?.id ??
    authCtx.locationId ??
    null;

  // UI + state
  const [form, setForm] = useState(initialForm);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // language toggle (persisted)
  const [lang, setLang] = useState(() => {
    const saved = localStorage.getItem("newClientForm.lang");
    if (saved === "en" || saved === "es") return saved;
    return navigator.language?.toLowerCase().startsWith("es") ? "es" : "en";
  });
  useEffect(() => {
    localStorage.setItem("newClientForm.lang", lang);
  }, [lang]);

  // layout refs
  const firstRef = useRef(null);
  const footerRef = useRef(null);
  const headerRef = useRef(null);
  const bodyRef = useRef(null);

  const [footerH, setFooterH] = useState(88);
  const [headerH, setHeaderH] = useState(56);
  const [vh, setVh] = useState(
    typeof window !== "undefined" ? window.innerHeight : 720
  );

  // Lock background scroll, focus first
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

  // Measure header/footer and handle keyboards
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      setFooterH(footerRef.current?.offsetHeight || 88);
      setHeaderH(headerRef.current?.offsetHeight || 56);
      setVh(
        window.visualViewport
          ? Math.round(window.visualViewport.height)
          : window.innerHeight
      );
    };
    measure();
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", measure);
      vv.addEventListener("scroll", measure);
    }
    window.addEventListener("resize", measure);
    return () => {
      if (vv) {
        vv.removeEventListener("resize", measure);
        vv.removeEventListener("scroll", measure);
      }
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  // Autofill when editing / reset when new
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
        householdSize: Number(client?.householdSize ?? 1),
        firstTimeThisMonth: !!client?.firstTimeThisMonth,
      });
    } else {
      setForm(initialForm);
    }
    setMsg("");
  }, [open, editing, client]);

  function validate() {
    const fn = form.firstName.trim();
    const ln = form.lastName.trim();
    if (!fn || !ln) return t(lang, "errRequiredName");
    const phoneDigits = normalizePhone(form.phone);
    if (!phoneDigits && !form.dob.trim()) return t(lang, "errDobOrPhone");
    if (!Number(form.householdSize || 0) || Number(form.householdSize) < 1)
      return t(lang, "errHH");
    const zip = (form.zip || "").trim();
    if (zip && !/^\d{5}$/.test(zip)) return t(lang, "errZip");
    if (!orgId || !locationId) return t(lang, "errOrgLoc");
    return "";
  }

  // Check duplicates by phone within the active org
  async function preflightPhoneDedupe(phoneDigits) {
    if (!phoneDigits) return null;
    const qs = await getDocs(
      query(
        collection(db, "clients"),
        where("phoneDigits", "==", phoneDigits),
        where("orgId", "==", orgId),
        qLimit(1)
      )
    );
    if (!qs.empty) {
      const d = qs.docs[0];
      return { id: d.id, ...(d.data() || {}) };
    }
    return null;
  }

  // Duplicate found UI state
  const [dup, setDup] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;

    const v = validate();
    if (v) {
      setMsg(v);
      return;
    }

    setBusy(true);
    setMsg("");
    setDup(null);

    const phoneDigits = normalizePhone(form.phone);

    try {
      // If NEW: handle duplicate by phone within org by offering to log visit
      if (!editing) {
        const existing = await preflightPhoneDedupe(phoneDigits);
        if (existing) {
          setDup(existing); // surface choice to user
          setMsg(t(lang, "dupFoundMsg"));
          setBusy(false);
          return;
        }
      }

      // Build payload for create/update
      const payload = {
        firstName: tcase(form.firstName.trim()),
        lastName: tcase(form.lastName.trim()),
        dob: form.dob.trim(),
        phone: form.phone.trim(),
        phoneDigits,
        address: form.address.trim(),
        zip: (form.zip || "").trim(),
        householdSize: Number(form.householdSize || 1),
        firstTimeThisMonth: !!form.firstTimeThisMonth,
        orgId,
        locationId,
        updatedAt: serverTimestamp(),
      };

      let createdId = client?.id;

      // ***** TRANSACTION: ALL READS BEFORE ALL WRITES *****
      await runTransaction(db, async (tx) => {
        const now = new Date();
        const mk = monthKey(now);
        const dk = localDateKey(now);

        const clientRef = editing
          ? doc(db, "clients", client.id)
          : doc(collection(db, "clients"));

        const markerRef = doc(
          db,
          "usda_first",
          `${orgId}_${clientRef.id}_${mk}`
        );

        // READS FIRST (only need marker check for new client)
        const markerSnap = !editing ? await tx.get(markerRef) : null;
        const isFirst = !editing ? !markerSnap.exists() : false;

        // WRITES
        if (!editing) {
          tx.set(
            clientRef,
            { ...payload, createdAt: serverTimestamp() },
            { merge: true }
          );

          if (isFirst) {
            tx.set(markerRef, {
              clientId: clientRef.id,
              orgId,
              monthKey: mk,
              createdAt: serverTimestamp(),
            });
          }

          const visitRef = doc(collection(db, "visits"));
          tx.set(visitRef, {
            clientId: clientRef.id,
            clientFirstName: payload.firstName,
            clientLastName: payload.lastName,
            visitAt: serverTimestamp(),
            dateKey: dk,
            monthKey: mk,
            orgId,
            locationId,
            householdSize: Number(form.householdSize || 1),
            usdaFirstTimeThisMonth: isFirst,
            createdBy: auth.currentUser?.uid || null,
            addedByReports: false,
          });
        } else {
          tx.set(clientRef, payload, { merge: true });
        }

        createdId = clientRef.id;
      });

      const saved = { id: createdId, ...payload };
      onSaved?.(saved);
      setMsg(editing ? t(lang, "savedEdit") : t(lang, "savedMsg"));

      if (!editing) {
        setForm(initialForm);
        firstRef.current?.focus();
      }
    } catch (err) {
      console.error(err);
      setMsg(t(lang, "errSave"));
    } finally {
      setBusy(false);
    }
  }

  // If we detect a duplicate, allow quick “Log Visit” for the existing client
  async function logVisitForDuplicate() {
    if (!dup?.id || busy) return;
    setBusy(true);
    setMsg("");
    try {
      await runTransaction(db, async (tx) => {
        const now = new Date();
        const mk = monthKey(now);
        const dk = localDateKey(now);

        const markerRef = doc(db, "usda_first", `${orgId}_${dup.id}_${mk}`);
        const markerSnap = await tx.get(markerRef);
        const isFirst = !markerSnap.exists();

        if (isFirst) {
          tx.set(markerRef, {
            clientId: dup.id,
            orgId,
            monthKey: mk,
            createdAt: serverTimestamp(),
          });
        }

        const visitRef = doc(collection(db, "visits"));
        tx.set(visitRef, {
          clientId: dup.id,
          clientFirstName: dup.firstName || "",
          clientLastName: dup.lastName || "",
          visitAt: serverTimestamp(),
          monthKey: mk,
          dateKey: dk,
          orgId,
          locationId,
          householdSize: Number(form.householdSize || 1),
          usdaFirstTimeThisMonth: isFirst,
          createdBy: auth.currentUser?.uid || null,
          addedByReports: false,
        });
      });

      setMsg("Visit logged for existing client ✅");
      onSaved?.({ ...(dup || {}) });
      setDup(null);
      setForm(initialForm);
      firstRef.current?.focus();
    } catch (e) {
      console.error(e);
      setMsg("Couldn’t log visit for the existing client.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  // dynamic paddings/heights (kept for mobile keyboards)
  const safeBottom = `max(env(safe-area-inset-bottom), 0px)`;
  const formBottomPad = footerH + 16;

  const showAssist = lang === "es";
  const dual = (primary, hint) => (
    <span className="flex flex-col">
      <span>{primary}</span>
      {showAssist && <span className="text-[11px] text-gray-500">{hint}</span>}
    </span>
  );

  return (
    <div className="fixed inset-0 z-50">
      {/* dim */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* sheet / modal */}
      <div
        className="
          absolute inset-x-0 top-0 bottom-0
          md:inset-auto md:top-8 md:bottom-8 md:left-1/2 md:-translate-x-1/2
          md:w-[min(760px,92vw)] md:max-h-[92vh]
          bg-white md:rounded-3xl shadow-xl ring-1 ring-gray-200 flex flex-col
          relative h-dvh md:h-auto overflow-hidden
        "
        style={{
          WebkitOverflowScrolling: "touch",
          paddingBottom: safeBottom,
          touchAction: "manipulation",
        }}
        lang={lang}
      >
        {/* header */}
        <div
          ref={headerRef}
          className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b bg-white md:rounded-t-3xl"
        >
          <h2 className="text-lg md:text-xl font-semibold">
            {editing ? t(lang, "titleEdit") : t(lang, "titleNew")}
          </h2>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setLang("en")}
              className={`h-9 px-3 rounded-lg border text-sm transition-colors
                ${
                  lang === "en"
                    ? "bg-brand-700 text-white border-brand-700 hover:bg-brand-600"
                    : "bg-white text-brand-700 border-brand-700 hover:bg-brand-50"
                } focus:outline-none focus:ring-2 focus:ring-brand-400`}
              aria-pressed={lang === "en"}
            >
              English
            </button>
            <button
              type="button"
              onClick={() => setLang("es")}
              className={`h-9 px-3 rounded-lg border text-sm transition-colors
                ${
                  lang === "es"
                    ? "bg-brand-700 text-white border-brand-700 hover:bg-brand-600"
                    : "bg-white text-brand-700 border-brand-700 hover:bg-brand-50"
                } focus:outline-none focus:ring-2 focus:ring-brand-400`}
              aria-pressed={lang === "es"}
            >
              Español
            </button>
            <span className="ml-2 text-xs text-gray-600">
              Org: <b>{orgId ?? "—"}</b> • Loc: <b>{locationId ?? "—"}</b>
            </span>
            <button
              onClick={onClose}
              className="ml-2 rounded-xl px-3 h-11 hover:bg-gray-100"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* form (scroll area) */}
        <form
          id="new-client-form"
          ref={bodyRef}
          onSubmit={onSubmit}
          onKeyDown={handleFormKeyDown}
          noValidate
          className="flex-1 overflow-y-auto px-4 md:px-6 space-y-4 text-[17px]"
          style={{ overscrollBehaviorY: "contain", paddingBottom: formBottomPad }}
        >
          {/* Name */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-700">
                {dual(t(lang, "firstName"), "First name")}
              </span>
              <input
                ref={firstRef}
                className="border rounded-2xl p-3 h-12 focus:outline-none focus:ring-2 focus:ring-rose-500"
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
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-700">
                {dual(t(lang, "lastName"), "Last name")}
              </span>
              <input
                className="border rounded-2xl p-3 h-12 focus:outline-none focus:ring-2 focus:ring-rose-500"
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

          {/* DOB + Phone */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-700">
                {dual(t(lang, "dob"), "Date of birth")}
              </span>
              <input
                className="border rounded-2xl p-3 h-12 focus:outline-none focus:ring-2 focus:ring-rose-500"
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
                className="border rounded-2xl p-3 h-12 focus:outline-none focus:ring-2 focus:ring-rose-500"
                name="phone"
                placeholder="(310) 254-1234"
                inputMode="tel"
                autoComplete="tel"
                enterKeyHint="next"
                value={form.phone}
                onChange={(e) =>
                  setForm((f) => ({ ...f, phone: formatPhone(e.target.value) }))
                }
              />
            </label>
          </div>

          {/* Address */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-700">
              {dual(t(lang, "address"), "Address")}
            </span>
            <input
              className="w-full border rounded-2xl p-3 h-12 focus:outline-none focus:ring-2 focus:ring-rose-500"
              placeholder="e.g., 185 Harvard Dr, Seal Beach"
              value={form.address}
              onChange={(e) =>
                setForm((f) => ({ ...f, address: e.target.value }))
              }
              enterKeyHint="next"
              autoComplete="street-address"
            />

            <div className="flex gap-3 mt-2">
              <label className="flex-1">
                <span className="sr-only">{t(lang, "zip")}</span>
                <input
                  className="w-full border rounded-2xl p-3 h-12 focus:outline-none focus:ring-2 focus:ring-rose-500"
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
            </div>
          </div>

          {/* Household + USDA flag */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Household size */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-gray-700">
                {dual(t(lang, "hhSize"), "Household size")}
              </span>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label="Decrease household size"
                  className="h-12 w-12 rounded-2xl border grid place-items-center text-xl font-semibold hover:bg-gray-50 active:scale-95"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      householdSize: Math.max(1, Number(f.householdSize) - 1),
                    }))
                  }
                >
                  –
                </button>

                <div className="h-12 min-w-[88px] px-4 rounded-2xl border grid place-items-center shadow-sm">
                  <span className="text-lg tabular-nums">
                    {form.householdSize}
                  </span>
                </div>

                <button
                  type="button"
                  aria-label="Increase household size"
                  className="h-12 w-12 rounded-2xl border grid place-items-center text-xl font-semibold hover:bg-gray-50 active:scale-95"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      householdSize: Math.min(20, Number(f.householdSize) + 1),
                    }))
                  }
                >
                  +
                </button>
              </div>
            </div>

            {/* USDA this month (only when NEW) */}
            {!editing && (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-xs font-medium text-gray-700">
                  {dual(t(lang, "usdaThisMonth"), "First time receiving USDA this month")}
                </legend>

                <div className="grid grid-cols-2 gap-2">
                  <label
                    className={`h-12 rounded-2xl border grid place-items-center text-sm font-semibold cursor-pointer transition-colors
                      ${
                        form.firstTimeThisMonth
                          ? "bg-brand-700 text-white border-brand-700"
                          : "bg-white text-gray-800 border-gray-300 hover:bg-brand-50"
                      }`}
                  >
                    <input
                      type="radio"
                      name="usdaFirstThisMonth"
                      className="sr-only"
                      checked={form.firstTimeThisMonth === true}
                      onChange={() =>
                        setForm((f) => ({ ...f, firstTimeThisMonth: true }))
                      }
                    />
                    {t(lang, "yes")}
                  </label>

                  <label
                    className={`h-12 rounded-2xl border grid place-items-center text-sm font-semibold cursor-pointer transition-colors
                      ${
                        !form.firstTimeThisMonth
                          ? "bg-brand-700 text-white border-brand-700"
                          : "bg-white text-gray-800 border-gray-300 hover:bg-brand-50"
                      }`}
                  >
                    <input
                      type="radio"
                      name="usdaFirstThisMonth"
                      className="sr-only"
                      checked={form.firstTimeThisMonth === false}
                      onChange={() =>
                        setForm((f) => ({ ...f, firstTimeThisMonth: false }))
                      }
                    />
                    {t(lang, "no")}
                  </label>
                </div>
                <p className="text-xs text-gray-500">{t(lang, "tipUsda")}</p>
              </fieldset>
            )}
          </div>

          {/* Duplicate notice card (when found) */}
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
                {!!dup.address && ` • ${dup.address}`}
                {!!dup.zip && ` ${dup.zip}`}
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={logVisitForDuplicate}
                  disabled={busy}
                  className="h-10 px-3 rounded-xl bg-brand-700 text-white text-sm font-medium hover:bg-brand-600 active:bg-brand-800 disabled:opacity-50"
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

        {/* fixed footer inside modal (outside the scroll area) */}
        <div
          ref={footerRef}
          className="
            absolute bottom-0 left-0 right-0
            bg-white border-t
            px-4 md:px-6 pt-2 pb-[max(12px,env(safe-area-inset-bottom))]
            z-10
          "
        >
          {!editing && (
            <label className="flex items-center gap-2 text-xs text-gray-600 mb-2 select-none">
              <input type="checkbox" className="h-4 w-4" onChange={() => {}} />
              {t(lang, "closeAfterSave")}
            </label>
          )}

          <div className="flex flex-col-reverse md:flex-row md:items-center md:justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-12 md:h-12 px-5 rounded-2xl border hover:bg-gray-50"
            >
              {t(lang, "cancel")}
            </button>

            {/* Submit the form even though the button is outside it */}
            <button
              type="submit"
              form="new-client-form"
              disabled={busy}
              className="
                h-14 md:h-12 w-full md:w-auto
                px-6 rounded-2xl
                bg-brand-700 text-white
                text-[17px] font-semibold
                shadow-sm
                hover:bg-brand-600 active:bg-brand-800
                disabled:opacity-50
              "
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
