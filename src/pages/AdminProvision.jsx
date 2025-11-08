// Shepherds Table Cloud — Admin Provisioning (orgs, locations, users, memberships)
// Drop-in page for master/admins. Creates/updates:
//  • organizations/{orgId}
//  • locations/{locationId}
//  • users/{uid}
//  • orgUsers/{uid}_{orgId}
// Also calls a callable to create Auth users without signing out the admin.
//
// Requirements in lib/firebase:
//   export const db = getFirestore(app);
//   export const auth = getAuth(app);
//   export const functions = getFunctions(app, /* region if you set one */);

import { useEffect, useMemo, useState } from "react";
import {
  collection, doc, setDoc, serverTimestamp, onSnapshot,
  query, where, orderBy
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../lib/firebase";
import { useAuth } from "../auth/useAuth";

function cx(...v) { return v.filter(Boolean).join(" "); }
const ROLES = [
  { value: "admin", label: "Admin (full capabilities)" },
  { value: "volunteer", label: "Volunteer (no delete, no reports)" },
  // future: { value: "manager", label: "Manager (reports + site mgmt)" },
  // future: { value: "viewer", label: "Viewer (read-only reports)" },
];

function toId(s) {
  return (s || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "")
    .toUpperCase();
}

export default function AdminProvision() {
  const { uid, email, org, isAdmin } = useAuth(); // page is for master/admins
  const [orgs, setOrgs] = useState([]);
  const [locsByOrg, setLocsByOrg] = useState({});

  // --- Create Org form ---
  const [orgName, setOrgName] = useState("");
  const [orgId, setOrgId] = useState(""); // editable; defaults from name
  const [orgLogo, setOrgLogo] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [orgActive, setOrgActive] = useState(true);
  const [orgAddress, setOrgAddress] = useState("");

  // --- Create Location form ---
  const [locOrgId, setLocOrgId] = useState("");
  const [locName, setLocName] = useState("");
  const [locId, setLocId] = useState(""); // defaults ORG_LOC
  const [locAddress, setLocAddress] = useState("");
  const [locActive, setLocActive] = useState(true);

  // --- Create/Assign User form ---
  const [memOrgId, setMemOrgId] = useState("");
  const [memRole, setMemRole] = useState("volunteer");
  const [memScope, setMemScope] = useState("subset"); // "all" | "subset"
  const [memLocationIds, setMemLocationIds] = useState([]); // multi-select
  const [useExistingUid, setUseExistingUid] = useState(false);
  const [existingUid, setExistingUid] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [sendInvite, setSendInvite] = useState(true);

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  // Load all orgs
  useEffect(() => {
    const qOrgs = query(collection(db, "organizations"), orderBy("name"));
    const unsub = onSnapshot(qOrgs, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setOrgs(list);
      // prime memOrgId if empty
      if (!memOrgId && list.length) setMemOrgId(list[0].id);
      if (!locOrgId && list.length) setLocOrgId(list[0].id);
    });
    return () => unsub();
  }, []);

  // Load locations per org and cache
  // Subscribe to locations for the currently selected org only.
  // This is simpler and avoids creating a subscription per org (helps with HMR and permissions surprises).
  useEffect(() => {
    if (!memOrgId) return;
    const qLocs = query(
      collection(db, "locations"),
      where("orgId", "==", memOrgId),
      orderBy("name")
    );
    const unsub = onSnapshot(
      qLocs,
      (snap) => {
        setLocsByOrg((prev) => ({
          ...prev,
          [memOrgId]: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
        }));
      },
      (err) => {
        // Surface Firestore errors (permission denied, missing index, etc.)
        console.error("locations onSnapshot error for org", memOrgId, err);
      }
    );
    return () => unsub();
  }, [memOrgId]);

  // Helpers
  const locationsForMemOrg = useMemo(
    () => (memOrgId ? (locsByOrg[memOrgId] || []) : []),
    [locsByOrg, memOrgId]
  );
  const computedOrgId = useMemo(() => (orgId || toId(orgName)), [orgId, orgName]);
  const computedLocId = useMemo(() => {
    const base = toId(locName);
    const orgPart = toId(locOrgId || "");
    return locId || (orgPart && base ? `${orgPart}_${base}` : base);
  }, [locId, locName, locOrgId]);

  function note(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 4000);
  }

  // ============ Create Organization ============
  async function createOrganization(e) {
    e.preventDefault();
    if (!orgName.trim()) return note("Organization name is required.");
    const id = computedOrgId;
    setBusy(true);
    try {
      await setDoc(
        doc(db, "organizations", id),
        {
          name: orgName.trim(),
          slug: orgSlug || orgName.trim().toLowerCase().replace(/\s+/g, "-"),
          logoUrl: orgLogo || "",
          address: orgAddress || "",
          active: !!orgActive,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      note(`Organization ${id} saved.`);
    } catch (err) {
      console.error(err);
      note("Failed to save organization.");
    } finally {
      setBusy(false);
    }
  }

  // ============ Create Location ============
  async function createLocation(e) {
    e.preventDefault();
    if (!locOrgId) return note("Pick an organization for the location.");
    if (!locName.trim()) return note("Location name is required.");
    const id = computedLocId;
    setBusy(true);
    try {
      await setDoc(
        doc(db, "locations", id),
        {
          orgId: locOrgId,
          name: locName.trim(),
          address: locAddress || "",
          active: !!locActive,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      note(`Location ${id} saved.`);
    } catch (err) {
      console.error(err);
      note("Failed to save location.");
    } finally {
      setBusy(false);
    }
  }

  // ============ Create / Assign User + Membership ============
  async function createOrAssignUser(e) {
    e.preventDefault();
    if (!memOrgId) return note("Choose an organization to assign.");
    if (memScope === "subset" && memLocationIds.length === 0) {
      return note("Pick at least one location for subset scope.");
    }

    setBusy(true);
    try {
      let targetUid = existingUid.trim();

      if (!useExistingUid) {
        if (!newEmail.trim() || !newPassword.trim()) {
          setBusy(false);
          return note("Email & temporary password required to create a user.");
        }
        // Call the callable to create Auth user without signing out admin
        const call = httpsCallable(functions, "provisionUser");
        const res = await call({
          email: newEmail.trim(),
          password: newPassword.trim(),
          sendInvite: !!sendInvite,
          orgId: memOrgId, // <-- pass org for org-admin authorization
        });
        targetUid = res?.data?.uid;
        if (!targetUid) throw new Error("provisionUser did not return a uid");
        // Seed users/{uid} (merge)
        await setDoc(
          doc(db, "users", targetUid),
          {
            email: newEmail.trim(),
            activeOrgId: memOrgId,
            activeLocationId:
              memScope === "all" ? "" : (memLocationIds[0] || ""),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        if (!targetUid) {
          setBusy(false);
          return note("Provide an existing UID.");
        }
        // Ensure users/{uid} exists
        await setDoc(
          doc(db, "users", targetUid),
          {
            email: newEmail.trim() || undefined,
            activeOrgId: memOrgId,
            activeLocationId:
              memScope === "all" ? "" : (memLocationIds[0] || ""),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      // Create/merge membership orgUsers/{uid}_{orgId}
      const mId = `${targetUid}_${memOrgId}`;
      await setDoc(
        doc(db, "orgUsers", mId),
        {
          userId: targetUid,
          email: (newEmail || "").trim() || undefined,
          orgId: memOrgId,
          role: memRole,
          scope: memScope, // "all" or "subset"
          locationIds: memScope === "all" ? [] : memLocationIds,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      note("User & membership saved.");
      // reset only safe bits
      setNewPassword("");
    } catch (err) {
      console.error(err);
      note("Failed to create/assign user.");
    } finally {
      setBusy(false);
    }
  }

  // ======= UI =======
  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Admin Provisioning</h1>
        <p className="text-sm text-gray-600">
          Create organizations, locations, and Auth users; assign roles & location scope.
        </p>
      </header>

      {toast && (
        <div className="mb-4 rounded-lg bg-emerald-50 ring-1 ring-emerald-200 px-4 py-2 text-emerald-800">
          {toast}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Create Organization */}
        <section className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">Create / Update Organization</h2>
          <form onSubmit={createOrganization} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="text-gray-600">Name</span>
                <input
                  className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Christ the Good Shepherd"
                  required
                />
              </label>
              <label className="text-sm">
                <span className="text-gray-600">Org ID (auto)</span>
                <input
                  className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2"
                  value={orgId}
                  onChange={(e) => setOrgId(e.target.value)}
                  placeholder={toId(orgName)}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="text-gray-600">Slug</span>
                <input
                  className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2"
                  value={orgSlug}
                  onChange={(e) => setOrgSlug(e.target.value)}
                  placeholder="wehelp"
                />
              </label>
              <label className="text-sm">
                <span className="text-gray-600">Logo URL</span>
                <input
                  className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2"
                  value={orgLogo}
                  onChange={(e) => setOrgLogo(e.target.value)}
                  placeholder="https://…/logo.png"
                />
              </label>
            </div>

            <label className="text-sm">
              <span className="text-gray-600">Address (optional)</span>
              <input
                className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2"
                value={orgAddress}
                onChange={(e) => setOrgAddress(e.target.value)}
                placeholder="1535 Gundry Ave, Long Beach, CA"
              />
            </label>

            <div className="flex items-center justify-between">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={orgActive}
                  onChange={(e) => setOrgActive(e.target.checked)}
                />
                <span>Active</span>
              </label>

              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-brand-600 px-4 py-2 text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save Organization"}
              </button>
            </div>
          </form>
        </section>

        {/* Create Location */}
        <section className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">Create / Update Location</h2>
          <form onSubmit={createLocation} className="space-y-3">
            <label className="text-sm">
              <span className="text-gray-600">Organization</span>
              <select
                className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2"
                value={locOrgId}
                onChange={(e) => setLocOrgId(e.target.value)}
              >
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name} ({o.id})</option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="text-gray-600">Location name</span>
                <input
                  className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2"
                  value={locName}
                  onChange={(e) => setLocName(e.target.value)}
                  placeholder="Christ the Redeemer"
                  required
                />
              </label>
              <label className="text-sm">
                <span className="text-gray-600">Location ID (auto)</span>
                <input
                  className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2"
                  value={locId}
                  onChange={(e) => setLocId(e.target.value)}
                  placeholder={computedLocId || "WEHELP_DELAMO"}
                />
              </label>
            </div>

            <label className="text-sm">
              <span className="text-gray-600">Address</span>
              <input
                className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2"
                value={locAddress}
                onChange={(e) => setLocAddress(e.target.value)}
                placeholder="6440 Del Amo Blvd, Lakewood, CA 90713"
              />
            </label>

            <div className="flex items-center justify-between">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={locActive}
                  onChange={(e) => setLocActive(e.target.checked)}
                />
                <span>Active</span>
              </label>

              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-brand-600 px-4 py-2 text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save Location"}
              </button>
            </div>
          </form>
        </section>

        {/* Create Auth User + Assign to Org/Locations */}
        <section className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm lg:col-span-2">
          <h2 className="mb-3 text-lg font-semibold">Create User & Assign Membership</h2>
          <form onSubmit={createOrAssignUser} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <label className="text-sm">
                <span className="text-gray-600">Organization</span>
                <select
                  className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2"
                  value={memOrgId}
                  onChange={(e) => {
                    setMemOrgId(e.target.value);
                    setMemLocationIds([]); // reset when org changes
                  }}
                >
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>{o.name} ({o.id})</option>
                  ))}
                </select>
              </label>

              <label className="text-sm">
                <span className="text-gray-600">Role</span>
                <select
                  className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2"
                  value={memRole}
                  onChange={(e) => setMemRole(e.target.value)}
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </label>

              <label className="text-sm">
                <span className="text-gray-600">Scope</span>
                <select
                  className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2"
                  value={memScope}
                  onChange={(e) => setMemScope(e.target.value)}
                >
                  <option value="all">All locations (org-wide)</option>
                  <option value="subset">Only selected locations</option>
                </select>
              </label>
            </div>

            {/* Multi-select for subset scope */}
            {memScope === "subset" && (
              <div>
                <span className="text-sm text-gray-600">Locations</span>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                  {locationsForMemOrg.map((loc) => {
                    const checked = memLocationIds.includes(loc.id);
                    return (
                      <label
                        key={loc.id}
                        className={cx(
                          "flex items-center gap-2 rounded-lg px-3 py-2 ring-1",
                          checked ? "bg-brand-50 ring-brand-200" : "bg-white ring-black/10"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setMemLocationIds((prev) =>
                              e.target.checked
                                ? [...prev, loc.id]
                                : prev.filter((x) => x !== loc.id)
                            );
                          }}
                        />
                        <span className="text-sm">
                          {loc.name} <span className="text-gray-500">({loc.id})</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="rounded-xl bg-gray-50 p-3 ring-1 ring-black/5">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={useExistingUid}
                  onChange={(e) => setUseExistingUid(e.target.checked)}
                />
                <span>Use existing Auth UID (skip creating a new Auth user)</span>
              </label>

              {!useExistingUid ? (
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <label className="text-sm">
                    <span className="text-gray-600">Email</span>
                    <input
                      className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="user@example.com"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="text-gray-600">Temporary password</span>
                    <input
                      type="password"
                      className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Temp@1234"
                    />
                  </label>
                  <label className="mt-6 inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={sendInvite}
                      onChange={(e) => setSendInvite(e.target.checked)}
                    />
                    <span>Send password reset invite email</span>
                  </label>
                </div>
              ) : (
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="text-sm">
                    <span className="text-gray-600">Existing UID</span>
                    <input
                      className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2"
                      value={existingUid}
                      onChange={(e) => setExistingUid(e.target.value)}
                      placeholder="paste uid…"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="text-gray-600">Email (optional — stored in users/)</span>
                    <input
                      className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="user@example.com"
                    />
                  </label>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-brand-600 px-4 py-2 text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save User & Membership"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}

