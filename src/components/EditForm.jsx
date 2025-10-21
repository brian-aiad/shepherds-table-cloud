// src/components/EditForm.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../lib/firebase";
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  collection,
  query,
  where,
  getDocs,
  writeBatch,
  deleteDoc,
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

/* =============== Component =============== */
export default function EditForm({ open, client, onClose, onSaved }) {
  const { isAdmin } = useAuth() || {};

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    address: "",
    phone: "",
    zip: "",
    dob: "",
    householdSize: "",
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  // focus trap + click-outside
  const dialogRef = useRef(null);
  const firstFieldRef = useRef(null);

  /* ---------- effects (always called, order is stable) ---------- */
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
      phone: client.phone || "",
      zip: client.zip || "",
      dob: client.dob || "",
      householdSize:
        client.householdSize !== undefined && client.householdSize !== null
          ? String(client.householdSize)
          : "",
    });
  }, [client]);

  /* ---------- memos (also always called) ---------- */
  const normalized = useMemo(() => {
    const firstName = tcase((form.firstName || "").trim());
    const lastName = tcase((form.lastName || "").trim());
    const address = (form.address || "").trim();
    const phone = onlyDigits(form.phone || "");
    const zip = onlyDigits(form.zip || "");
    const dob = (form.dob || "").trim();
    const householdSize =
      form.householdSize === "" ? "" : String(onlyDigits(form.householdSize || ""));
    return { firstName, lastName, address, phone, zip, dob, householdSize };
  }, [form]);

  const hasChanges = useMemo(() => {
    if (!client) return false;
    const cmp = (a, b) => (a ?? "") === (b ?? "");
    return !(
      cmp(tcase(client.firstName || ""), normalized.firstName) &&
      cmp(tcase(client.lastName || ""), normalized.lastName) &&
      cmp(client.address || "", normalized.address) &&
      cmp(onlyDigits(client.phone || ""), normalized.phone) &&
      cmp(onlyDigits(client.zip || ""), normalized.zip) &&
      cmp(client.dob || "", normalized.dob) &&
      (safeNum(client.householdSize) ?? null) === (safeNum(normalized.householdSize) ?? null)
    );
  }, [client, normalized]);

  const formValid = useMemo(() => {
    if (!normalized.firstName || !normalized.lastName) return false;
    if (normalized.dob && !isYmd(normalized.dob)) return false;
    if (normalized.phone && normalized.phone.length < 7) return false;
    if (normalized.zip && normalized.zip.length < 3) return false;
    if (normalized.householdSize !== "" && safeNum(normalized.householdSize) === null) return false;
    return true;
  }, [normalized]);

  /* ---------- early exit AFTER hooks are declared ---------- */
  if (!open) return null;

  /* ---------- handlers ---------- */
  const onBackdropClick = (e) => {
    if (dialogRef.current && !dialogRef.current.contains(e.target)) onClose?.();
  };

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
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
        firstName: normalized.firstName,
        lastName: normalized.lastName,
        address: normalized.address,
        phone: normalized.phone,
        zip: normalized.zip,
        dob: normalized.dob,
        householdSize: safeNum(normalized.householdSize),
        // preserve tenant scope
        orgId: current.orgId ?? client.orgId ?? null,
        locationId: current.locationId ?? client.locationId ?? null,
        updatedAt: serverTimestamp(),
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

  const deleteKeepHistory = async () => {
    if (!client?.id || deleting) return;
    const name =
      `${tcase(client.firstName || "")} ${tcase(client.lastName || "")}`.trim() || "this client";

    const ok1 = confirm(
      `Delete ${name}'s profile?\n\nTheir visit history will be KEPT for reports.\nThis cannot be undone.`
    );
    if (!ok1) return;

    try {
      setDeleting(true);
      setError("");

      // 1) backfill visit history with snapshot fields + flags
      const qs = await getDocs(query(collection(db, "visits"), where("clientId", "==", client.id)));
      const docs = qs.docs;

      const chunkSize = 250; // Firestore limit safety
      for (let i = 0; i < docs.length; i += chunkSize) {
        const batch = writeBatch(db);
        for (const d of docs.slice(i, i + chunkSize)) {
          const v = d.data() || {};
          batch.update(d.ref, {
            clientDeleted: true,
            clientDeletedAt: serverTimestamp(),
            clientFirstName: v.clientFirstName ?? client.firstName ?? "",
            clientLastName: v.clientLastName ?? client.lastName ?? "",
          });
        }
        await batch.commit();
      }

      // 2) delete client profile
      await deleteDoc(doc(db, "clients", client.id));

      // 3) close modal + bubble up
      onSaved?.({ id: client.id, deleted: true });
      onClose?.();
      alert(`Deleted profile for ${name}. Visit history retained.`);
    } catch (err) {
      console.error("Delete client error:", err);
      setError(err?.message || "Failed to delete client while retaining visit history.");
    } finally {
      setDeleting(false);
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
                <span className="text-gray-700">Phone</span>
                <input
                  className="mt-1 w-full rounded-xl border border-brand-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  name="phone"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: onlyDigits(e.target.value) }))}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="digits only"
                />
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
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 text-red-800 px-3 py-2 text-sm">
                {error}
              </div>
            )}

            {/* Actions row */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
              {/* Danger zone (Admin only) */}
              {isAdmin && (
                <div className="sm:order-1">
                  <button
                    type="button"
                    onClick={deleteKeepHistory}
                    disabled={deleting}
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-red-600 text-white font-medium shadow-sm hover:bg-red-700 active:bg-red-800 disabled:opacity-60"
                  >
                    {deleting ? (
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity=".25" />
                        <path d="M22 12a10 10 0 0 1-10 10" fill="currentColor" />
                      </svg>
                    ) : (
                      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path
                          fillRule="evenodd"
                          d="M6 8a1 1 0 011 1v6a1 1 0 11-2 0V9a1 1 0 011-1zm4 0a1 1 0 011 1v6a1 1 0 11-2 0V9a1 1 0 011-1zm4 0a1 1 0 011 1v6a1 1 0 11-2 0V9a1 1 0 011-1zM7 4a3 3 0 013-3h0a3 3 0 013 3h4a1 1 0 110 2h-1v11a3 3 0 01-3 3H7a3 3 0 01-3-3V6H3a1 1 0 110-2h4zm2-1a1 1 0 00-1 1h4a1 1 0 00-1-1H9z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                    Delete client (keep visits)
                  </button>
                  <div className="mt-1 text-[12px] text-gray-500">
                    Removes profile only. All visits stay for reports.
                  </div>
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
