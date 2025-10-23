// src/components/EditForm.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { db, auth } from "../lib/firebase";
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { useAuth } from "../auth/useAuth";

/* =============== Helpers =============== */
const tcase = (s = "") =>
  s
    .toLowerCase()
    .replace(/[\p{L}]+('[\p{L}]+)?/gu, (w) => w[0].toUpperCase() + w.slice(1))
    .replace(/([- ][\p{L}])/gu, (m) => m[0] + m[1].toUpperCase());

const onlyDigits = (s = "") => s.replace(/\D/g, "");
const safeNum = (v) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const isYmd = (s = "") => /^\d{4}-\d{2}-\d{2}$/.test(s);

const formatPhoneFromDigits = (digits = "") => {
  const d = String(digits).replace(/\D/g, "").slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`;
};

// tiny stable hash for dedupe/search keys
function hashDJB2(str = "") {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i);
  return `h${(h >>> 0).toString(16)}`;
}

/* =============== Component =============== */
export default function EditForm({ open, client, onClose, onSaved }) {
  const { isAdmin, uid } = useAuth() || {};

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    address: "",
    phoneDigits: "",
    zip: "",
    dob: "",
    householdSize: "",
    inactive: false,
  });
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const [error, setError] = useState("");

  // focus trap + click-outside
  const dialogRef = useRef(null);
  const firstFieldRef = useRef(null);

  /* ---------- effects ---------- */
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => firstFieldRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!client) return;
    setError("");
    setForm({
      firstName: client.firstName || "",
      lastName: client.lastName || "",
      address: client.address || "",
      phoneDigits: onlyDigits(client.phoneDigits || client.phone || ""),
      zip: onlyDigits(client.zip || ""),
      dob: client.dob || "",
      householdSize:
        client.householdSize !== undefined && client.householdSize !== null
          ? String(client.householdSize)
          : "",
      inactive: !!client.inactive,
    });
  }, [client]);

  /* ---------- memos ---------- */
  const normalized = useMemo(() => {
    const firstName = tcase((form.firstName || "").trim());
    const lastName = tcase((form.lastName || "").trim());
    const address = (form.address || "").trim();
    const phoneDigits = onlyDigits(form.phoneDigits || "");
    const phone = formatPhoneFromDigits(phoneDigits);
    const zip = onlyDigits(form.zip || "");
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
      cmp(client.dob || "", normalized.dob) &&
      (safeNum(client.householdSize) ?? null) === (safeNum(normalized.householdSize) ?? null) &&
      (!!client.inactive === normalized.inactive)
    );
  }, [client, normalized]);

  const formValid = useMemo(() => {
    if (!normalized.firstName || !normalized.lastName) return false;
    if (normalized.dob && !isYmd(normalized.dob)) return false;
    if (normalized.phoneDigits && normalized.phoneDigits.length < 7) return false;
    if (normalized.zip && normalized.zip.length < 3) return false;
    if (normalized.householdSize !== "" && safeNum(normalized.householdSize) === null) return false;
    return true;
  }, [normalized]);

  /* ---------- early exit ---------- */
  if (!open) return null;

  /* ---------- handlers ---------- */
  const onBackdropClick = (e) => {
    if (dialogRef.current && !dialogRef.current.contains(e.target)) onClose?.();
  };

  const onChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((f) => ({ ...f, [name]: type === "checkbox" ? checked : value }));
  };

  const submit = async (e) => {
    e.preventDefault();
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
        phone: normalized.phone,             // formatted
        phoneDigits: normalized.phoneDigits, // normalized
        zip: normalized.zip,
        dob: normalized.dob,
        householdSize: safeNum(normalized.householdSize),
        inactive: normalized.inactive,

        // computed / denorm for search & dedupe
        fullNameLower: normalized.fullNameLower,
        nameDobHash: normalized.nameDobHash,

        // preserve tenant scope
        orgId: current.orgId ?? client.orgId ?? null,
        locationId: current.locationId ?? client.locationId ?? null,

        // audit
        updatedAt: serverTimestamp(),
        updatedBy: uid || auth.currentUser?.uid || null,
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

  // "Delete" now means deactivate (soft delete)
  const deactivateClient = async () => {
    if (!client?.id || deactivating) return;
    if (client.inactive) return; // already inactive

    const name =
      `${tcase(client.firstName || "")} ${tcase(client.lastName || "")}`.trim() || "this client";

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
        deactivatedBy: uid || auth.currentUser?.uid || null,
        updatedAt: serverTimestamp(),
        updatedBy: uid || auth.currentUser?.uid || null,
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
    if (!client?.id || reactivating) return;
    if (!client.inactive && !form.inactive) return;

    try {
      setReactivating(true);
      setError("");

      const ref = doc(db, "clients", client.id);
      await updateDoc(ref, {
        inactive: false,
        reactivatedAt: serverTimestamp(),
        reactivatedBy: uid || auth.currentUser?.uid || null,
        updatedAt: serverTimestamp(),
        updatedBy: uid || auth.currentUser?.uid || null,
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

  const readOnlyBlock = !isAdmin;

  /* ---------- render ---------- */
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-3"
      role="dialog"
      aria-modal="true"
      onMouseDown={onBackdropClick}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-lg bg-white rounded-2xl shadow-xl ring-1 ring-black/10 overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b bg-gradient-to-b from-white to-gray-50 flex items-center justify-between">
          <div className="font-semibold">
            Edit client
            {client?.firstName || client?.lastName ? (
              <span className="ml-2 text-gray-500 font-normal">
                — {tcase(client.firstName)} {tcase(client.lastName)}
                {client?.inactive ? (
                  <span className="ml-2 inline-flex items-center text-[12px] px-2 py-[2px] rounded-full bg-gray-100 border text-gray-700">
                    Inactive
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 rounded-md px-2 py-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        {readOnlyBlock ? (
          <div className="p-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-sm">
              You don’t have permission to edit client profiles. Please ask an admin.
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="h-10 px-4 rounded-lg border bg-white hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="p-4 space-y-4">
            {/* Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="text-gray-700">First name</span>
                <input
                  ref={firstFieldRef}
                  className="mt-1 w-full rounded-xl border border-brand-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  name="firstName"
                  value={form.firstName}
                  onChange={onChange}
                  onBlur={() => setForm((f) => ({ ...f, firstName: tcase(f.firstName) }))}
                  required
                  autoComplete="given-name"
                />
              </label>

              <label className="text-sm">
                <span className="text-gray-700">Last name</span>
                <input
                  className="mt-1 w-full rounded-xl border border-brand-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  name="lastName"
                  value={form.lastName}
                  onChange={onChange}
                  onBlur={() => setForm((f) => ({ ...f, lastName: tcase(f.lastName) }))}
                  required
                  autoComplete="family-name"
                />
              </label>

              <label className="text-sm sm:col-span-2">
                <span className="text-gray-700">Address</span>
                <input
                  className="mt-1 w-full rounded-xl border border-brand-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  name="address"
                  value={form.address}
                  onChange={onChange}
                  autoComplete="street-address"
                />
              </label>

              <label className="text-sm">
                <span className="text-gray-700">Phone (digits)</span>
                <input
                  className="mt-1 w-full rounded-xl border border-brand-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  name="phoneDigits"
                  value={form.phoneDigits}
                  onChange={(e) => setForm((f) => ({ ...f, phoneDigits: onlyDigits(e.target.value) }))}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="e.g., 3102541234"
                />
                {form.phoneDigits && (
                  <div className="mt-1 text-[12px] text-gray-500">
                    Saved as: {formatPhoneFromDigits(form.phoneDigits)}
                  </div>
                )}
              </label>

              <label className="text-sm">
                <span className="text-gray-700">ZIP</span>
                <input
                  className="mt-1 w-full rounded-xl border border-brand-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  name="zip"
                  value={form.zip}
                  onChange={(e) => setForm((f) => ({ ...f, zip: onlyDigits(e.target.value) }))}
                  inputMode="numeric"
                  placeholder="e.g., 90210"
                  autoComplete="postal-code"
                />
              </label>

              <label className="text-sm">
                <span className="text-gray-700">DOB</span>
                <input
                  className="mt-1 w-full rounded-xl border border-brand-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  name="dob"
                  value={form.dob}
                  onChange={onChange}
                  placeholder="YYYY-MM-DD"
                  inputMode="numeric"
                />
                {form.dob && !isYmd(form.dob) && (
                  <div className="mt-1 text-[12px] text-red-600">Use format YYYY-MM-DD.</div>
                )}
              </label>

              <label className="text-sm">
                <span className="text-gray-700">Household size</span>
                <input
                  className="mt-1 w-full rounded-xl border border-brand-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  name="householdSize"
                  value={form.householdSize}
                  onChange={(e) => setForm((f) => ({ ...f, householdSize: onlyDigits(e.target.value) }))}
                  inputMode="numeric"
                  placeholder="e.g., 3"
                />
              </label>

              {/* Active / Inactive (admin only) */}
              {isAdmin && (
                <label className="text-sm flex items-center gap-2 mt-1 sm:col-span-2">
                  <input
                    type="checkbox"
                    name="inactive"
                    checked={!!form.inactive}
                    onChange={onChange}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span className="text-gray-700">Mark client as inactive (hidden from search/intake)</span>
                </label>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 text-red-800 px-3 py-2 text-sm">
                {error}
              </div>
            )}

            {/* Actions row */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
              {/* Danger / Reactivation zone (Admin only) */}
              {isAdmin && (
                <div className="sm:order-1 flex items-center gap-2">
                  {!client?.inactive ? (
                    <button
                      type="button"
                      onClick={deactivateClient}
                      disabled={deactivating}
                      className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-red-600 text-white font-medium shadow-sm hover:bg-red-700 active:bg-red-800 disabled:opacity-60"
                    >
                      {deactivating ? "Working…" : "Deactivate client"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={reactivateClient}
                      disabled={reactivating}
                      className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-green-600 text-white font-medium shadow-sm hover:bg-green-700 active:bg-green-800 disabled:opacity-60"
                    >
                      {reactivating ? "Working…" : "Reactivate client"}
                    </button>
                  )}
                </div>
              )}

              {/* Save/Cancel */}
              <div className="flex items-center gap-2 sm:order-2 sm:ml-auto">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-10 px-4 rounded-xl border border-brand-200 bg-white hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !formValid || !hasChanges}
                  className="h-10 px-4 rounded-xl bg-brand-700 text-white font-medium shadow-sm hover:bg-brand-800 disabled:opacity-60"
                  aria-disabled={saving || !formValid || !hasChanges}
                  title={
                    !formValid ? "Fix the highlighted fields" : !hasChanges ? "No changes to save" : "Save changes"
                  }
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
