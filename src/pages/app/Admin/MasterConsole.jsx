// src/pages/app/Admin/MasterConsole.jsx
// Shepherds Table Cloud — Master Console (global super admin)
//
// This page is intended ONLY for the master user (isMaster === true).
// Mount it behind:
//   <ProtectedRoute requireMaster>
//     <MasterConsole />
//   </ProtectedRoute>
//
// Features (v1 scaffold):
// - List all organizations; create + rename + toggle active.
// - For selected org:
//    • View and manage locations (create, rename, toggle active).
//    • View and manage orgUsers (role, active, scope notes).
//    • Quick data counts: clients, visits, usda_first markers.
//
// Notes:
// - This is a master-level tool; it calls Firestore directly.
// - AuthProvider/Firestore rules already enforce that only master can reach this.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  Fragment,
} from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  updateDoc,
  addDoc,
  serverTimestamp,
  getCountFromServer,
  orderBy,
} from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { useAuth } from "../../../auth/useAuth";

// Tab ids: "overview" | "locations" | "users" | "data"
const TABS = [
  { id: "overview", label: "Overview" },
  { id: "locations", label: "Locations" },
  { id: "users", label: "Org Users" },
  { id: "data", label: "Data" },
];

function SectionCard({ title, description, children }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white/80 shadow-sm p-4 md:p-6 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          {description && (
            <p className="mt-1 text-xs text-gray-500">{description}</p>
          )}
        </div>
      </div>
      <div>{children}</div>
    </section>
  );
}

export default function MasterConsole() {
  const { isMaster, email } = useAuth();

  const [orgs, setOrgs] = useState([]);          // [{ id, name, active, ... }]
  const [locations, setLocations] = useState([]); // [{ id, orgId, name, address, active, ... }]
  const [orgUsers, setOrgUsers] = useState([]);   // [{ id, orgId, userId, email, role, scope, ... }]
  const [selectedOrgId, setSelectedOrgId] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");

  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [loadingOrgUsers, setLoadingOrgUsers] = useState(false);
  const [loadingCounts, setLoadingCounts] = useState(false);

  const [creatingOrg, setCreatingOrg] = useState(false);
  const [createOrgId, setCreateOrgId] = useState("");
  const [createOrgName, setCreateOrgName] = useState("");

  const [creatingLoc, setCreatingLoc] = useState(false);
  const [createLocName, setCreateLocName] = useState("");
  const [createLocAddress, setCreateLocAddress] = useState("");

  const [counts, setCounts] = useState({
    clients: null,
    visits: null,
    markers: null,
  });

  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);

  // Derived
  const selectedOrg = useMemo(
    () => (selectedOrgId ? orgs.find((o) => o.id === selectedOrgId) || null : null),
    [orgs, selectedOrgId]
  );

  const locationsForOrg = useMemo(
    () =>
      selectedOrgId ? locations.filter((l) => l.orgId === selectedOrgId) : [],
    [locations, selectedOrgId]
  );

  const orgUsersForOrg = useMemo(
    () =>
      selectedOrgId ? orgUsers.filter((u) => u.orgId === selectedOrgId) : [],
    [orgUsers, selectedOrgId]
  );

  // ─────────────────────────────────────────────────────────────
  // Load organizations + locations (master sees all)
  // ─────────────────────────────────────────────────────────────
  const loadOrgsAndLocations = useCallback(async () => {
    setLoadingOrgs(true);
    setError(null);
    try {
      const [orgSnap, locSnap] = await Promise.all([
        getDocs(
          query(collection(db, "organizations"), orderBy("name", "asc"))
        ).catch(() => null),
        getDocs(collection(db, "locations")).catch(() => null),
      ]);

      const nextOrgs =
        orgSnap?.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })) || [];
      const nextLocations =
        locSnap?.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })) || [];

      setOrgs(nextOrgs);
      setLocations(nextLocations);

      // Auto-select first org if none selected
      if (!selectedOrgId && nextOrgs.length > 0) {
        setSelectedOrgId(nextOrgs[0].id);
      }
    } catch (err) {
      console.error("[MasterConsole] Failed to load orgs/locations", err);
      setError("Failed to load organizations/locations. Check console for details.");
    } finally {
      setLoadingOrgs(false);
    }
  }, [selectedOrgId]);

  // ─────────────────────────────────────────────────────────────
  // Load orgUsers for selected org
  // ─────────────────────────────────────────────────────────────
  const loadOrgUsers = useCallback(async (orgId) => {
    if (!orgId) {
      setOrgUsers([]);
      return;
    }
    setLoadingOrgUsers(true);
    setError(null);
    try {
      const qRef = query(collection(db, "orgUsers"), where("orgId", "==", orgId));
      const snap = await getDocs(qRef);
      const rows = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() || {}),
      }));
      setOrgUsers((prev) => {
        const others = prev.filter((u) => u.orgId !== orgId);
        return [...others, ...rows];
      });
    } catch (err) {
      console.error("[MasterConsole] Failed to load orgUsers", err);
      setError("Failed to load org users. Check console for details.");
    } finally {
      setLoadingOrgUsers(false);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Load basic counts for selected org
  // ─────────────────────────────────────────────────────────────
  const loadCounts = useCallback(async (orgId) => {
    if (!orgId) {
      setCounts({ clients: null, visits: null, markers: null });
      return;
    }
    setLoadingCounts(true);
    setError(null);
    try {
      const [clientsCount, visitsCount, markersCount] = await Promise.all([
        getCountFromServer(
          query(collection(db, "clients"), where("orgId", "==", orgId))
        ).catch(() => null),
        getCountFromServer(
          query(collection(db, "visits"), where("orgId", "==", orgId))
        ).catch(() => null),
        getCountFromServer(
          query(collection(db, "usda_first"), where("orgId", "==", orgId))
        ).catch(() => null),
      ]);

      setCounts({
        clients: clientsCount?.data().count ?? null,
        visits: visitsCount?.data().count ?? null,
        markers: markersCount?.data().count ?? null,
      });
    } catch (err) {
      console.error("[MasterConsole] Failed to load counts", err);
      setError("Failed to load data counts. Check console for details.");
    } finally {
      setLoadingCounts(false);
    }
  }, []);

  useEffect(() => {
    if (!isMaster) return;
    loadOrgsAndLocations();
  }, [isMaster, loadOrgsAndLocations]);

  useEffect(() => {
    if (!isMaster) return;
    loadOrgUsers(selectedOrgId);
    loadCounts(selectedOrgId);
  }, [isMaster, selectedOrgId, loadOrgUsers, loadCounts]);

  // ─────────────────────────────────────────────────────────────
  // Actions: Organizations
  // ─────────────────────────────────────────────────────────────
  const handleCreateOrg = async (e) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    const id = createOrgId.trim();
    const name = createOrgName.trim();

    if (!id || !name) {
      setError("Org ID and name are required.");
      return;
    }

    try {
      const ref = doc(db, "organizations", id);
      const existing = await getDoc(ref);
      if (existing.exists()) {
        setError(`Organization with id "${id}" already exists.`);
        return;
      }

      await setDoc(ref, {
        name,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setCreateOrgId("");
      setCreateOrgName("");
      setCreatingOrg(false);
      setInfo(`Created organization "${name}".`);
      await loadOrgsAndLocations();
      setSelectedOrgId(id);
    } catch (err) {
      console.error("[MasterConsole] Failed to create org", err);
      setError("Failed to create organization. Check console for details.");
    }
  };

  const handleRenameOrg = async (orgId, name) => {
    setError(null);
    setInfo(null);
    try {
      const ref = doc(db, "organizations", orgId);
      await updateDoc(ref, {
        name: name.trim(),
        updatedAt: serverTimestamp(),
      });
      setInfo("Organization updated.");
      await loadOrgsAndLocations();
    } catch (err) {
      console.error("[MasterConsole] Failed to rename org", err);
      setError("Failed to update organization.");
    }
  };

  const handleToggleOrgActive = async (orgId, active) => {
    setError(null);
    setInfo(null);
    try {
      const ref = doc(db, "organizations", orgId);
      await updateDoc(ref, {
        active: !active,
        updatedAt: serverTimestamp(),
      });
      setInfo(`Organization ${active ? "deactivated" : "activated"}.`);
      await loadOrgsAndLocations();
    } catch (err) {
      console.error("[MasterConsole] Failed to toggle org active", err);
      setError("Failed to toggle organization active state.");
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Actions: Locations
  // ─────────────────────────────────────────────────────────────
  const handleCreateLocation = async (e) => {
    e.preventDefault();
    if (!selectedOrgId) {
      setError("Select an organization first.");
      return;
    }
    setError(null);
    setInfo(null);

    const name = createLocName.trim();
    const address = createLocAddress.trim();

    if (!name) {
      setError("Location name is required.");
      return;
    }

    try {
      await addDoc(collection(db, "locations"), {
        orgId: selectedOrgId,
        name,
        address: address || null,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setCreateLocName("");
      setCreateLocAddress("");
      setCreatingLoc(false);
      setInfo("Location created.");
      await loadOrgsAndLocations();
    } catch (err) {
      console.error("[MasterConsole] Failed to create location", err);
      setError("Failed to create location.");
    }
  };

  const handleUpdateLocation = async (locId, patch) => {
    setError(null);
    setInfo(null);
    try {
      const ref = doc(db, "locations", locId);
      await updateDoc(ref, {
        ...patch,
        updatedAt: serverTimestamp(),
      });
      setInfo("Location updated.");
      await loadOrgsAndLocations();
    } catch (err) {
      console.error("[MasterConsole] Failed to update location", err);
      setError("Failed to update location.");
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Actions: OrgUsers
  // ─────────────────────────────────────────────────────────────
  const handleToggleOrgUserActive = async (row) => {
    setError(null);
    setInfo(null);
    try {
      const ref = doc(db, "orgUsers", row.id);
      await updateDoc(ref, {
        active: row.active === false ? true : false,
        updatedAt: serverTimestamp(),
      });
      setInfo("Org user active state updated.");
      await loadOrgUsers(row.orgId);
    } catch (err) {
      console.error("[MasterConsole] Failed to toggle orgUser", err);
      setError("Failed to update org user.");
    }
  };

  const handleOrgUserRoleChange = async (row, role) => {
    setError(null);
    setInfo(null);
    try {
      const ref = doc(db, "orgUsers", row.id);
      await updateDoc(ref, {
        role,
        updatedAt: serverTimestamp(),
      });
      setInfo("Org user role updated.");
      await loadOrgUsers(row.orgId);
    } catch (err) {
      console.error("[MasterConsole] Failed to update role", err);
      setError("Failed to update org user role.");
    }
  };

  const handleOrgUserScopeChange = async (row, scope) => {
    setError(null);
    setInfo(null);
    try {
      const ref = doc(db, "orgUsers", row.id);
      await updateDoc(ref, {
        scope,
        updatedAt: serverTimestamp(),
      });
      setInfo("Org user scope updated.");
      await loadOrgUsers(row.orgId);
    } catch (err) {
      console.error("[MasterConsole] Failed to update scope", err);
      setError("Failed to update org user scope.");
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────────
  if (!isMaster) {
    return (
      <div className="p-6 md:p-10">
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          This page is restricted to the master account.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-6 md:py-8 md:px-6 space-y-6">
        {/* Header */}
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold text-gray-900">
              Master Console
            </h1>
            <p className="mt-1 text-xs md:text-sm text-gray-500">
              Signed in as{" "}
              <span className="font-medium text-gray-900">
                {email || "unknown"}
              </span>
              . Global access across all orgs and locations.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full bg-brand-600/10 px-3 py-1 text-xs font-medium text-brand-700 border border-brand-600/30">
            <span className="h-2 w-2 rounded-full bg-brand-600" aria-hidden />
            <span>Master mode</span>
          </div>
        </header>

        {/* Error / Info banners */}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
        {info && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">
            {info}
          </div>
        )}

        {/* Org + tab row */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          {/* Org selector */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-gray-600">
              Organization:
            </span>
            <div className="flex flex-wrap gap-2">
              {loadingOrgs && orgs.length === 0 ? (
                <span className="text-xs text-gray-400">Loading orgs…</span>
              ) : orgs.length === 0 ? (
                <span className="text-xs text-gray-400">
                  No organizations yet.
                </span>
              ) : (
                orgs.map((o) => {
                  const isSelected = o.id === selectedOrgId;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setSelectedOrgId(o.id)}
                      className={[
                        "inline-flex items-center rounded-full border px-3 py-1 text-xs",
                        isSelected
                          ? "border-brand-600 bg-brand-600 text-white"
                          : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
                      ].join(" ")}
                    >
                      <span className="font-medium truncate max-w-[140px]">
                        {o.name || o.id}
                      </span>
                      {o.active === false && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                          inactive
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="inline-flex items-center gap-1 rounded-full bg-white px-1 py-1 border border-gray-200 shadow-sm">
            {TABS.map((tab) => {
              const active = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={[
                    "rounded-full px-3 py-1 text-xs font-medium",
                    active
                      ? "bg-brand-600 text-white shadow-sm"
                      : "text-gray-600 hover:bg-gray-50",
                  ].join(" ")}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Main grid */}
        <div className="grid gap-4 md:gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {/* Left column: org management */}
          <div className="space-y-4">
            <SectionCard
              title="Organizations"
              description="Create and manage all organizations that use Shepherd’s Table Cloud."
            >
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setCreatingOrg((v) => !v)}
                  className="inline-flex items-center rounded-full border border-dashed border-brand-500/60 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100"
                >
                  {creatingOrg ? "Cancel" : "New organization"}
                </button>

                {creatingOrg && (
                  <form
                    onSubmit={handleCreateOrg}
                    className="mt-2 grid gap-2 rounded-xl border border-gray-200 bg-gray-50/80 p-3 text-xs"
                  >
                    <div className="grid gap-2 md:grid-cols-2">
                      <label className="flex flex-col gap-1">
                        <span className="font-medium text-gray-700">
                          Org ID (stable, no spaces)
                        </span>
                        <input
                          value={createOrgId}
                          onChange={(e) => setCreateOrgId(e.target.value)}
                          placeholder="WEHELP, CTGS, STMONICA…"
                          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="font-medium text-gray-700">
                          Display name
                        </span>
                        <input
                          value={createOrgName}
                          onChange={(e) => setCreateOrgName(e.target.value)}
                          placeholder="We Help Long Beach"
                          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                        />
                      </label>
                    </div>
                    <div className="flex items-center justify-end gap-2 mt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setCreatingOrg(false);
                          setCreateOrgId("");
                          setCreateOrgName("");
                        }}
                        className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700"
                      >
                        Save organization
                      </button>
                    </div>
                  </form>
                )}

                <div className="mt-2 space-y-2">
                  {orgs.length === 0 && !loadingOrgs && (
                    <p className="text-xs text-gray-500">
                      No organizations yet. Create one to get started.
                    </p>
                  )}

                  {orgs.map((o) => (
                    <OrgRow
                      key={o.id}
                      org={o}
                      onRename={handleRenameOrg}
                      onToggleActive={handleToggleOrgActive}
                    />
                  ))}
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Quick data snapshot"
              description={
                selectedOrg
                  ? `Counts for org: ${selectedOrg.name || selectedOrg.id}`
                  : "Select an organization to see its data counts."
              }
            >
              {selectedOrg ? (
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <DataCountBox
                    label="Clients"
                    value={counts.clients}
                    loading={loadingCounts}
                  />
                  <DataCountBox
                    label="Visits"
                    value={counts.visits}
                    loading={loadingCounts}
                  />
                  <DataCountBox
                    label="USDA first markers"
                    value={counts.markers}
                    loading={loadingCounts}
                  />
                </div>
              ) : (
                <p className="text-xs text-gray-500">
                  Choose an organization to see counts.
                </p>
              )}
            </SectionCard>
          </div>

          {/* Right column: tabbed panels for selected org */}
          <div className="space-y-4">
            {!selectedOrg && (
              <SectionCard title="Select an organization">
                <p className="text-xs text-gray-500">
                  Choose an organization on the left to manage locations, org
                  users, and data.
                </p>
              </SectionCard>
            )}

            {selectedOrg && activeTab === "overview" && (
              <SectionCard
                title="Overview"
                description="High-level org summary."
              >
                <div className="grid gap-3 text-xs md:grid-cols-2">
                  <div className="space-y-1">
                    <div className="font-medium text-gray-800">
                      {selectedOrg.name || selectedOrg.id}
                    </div>
                    <div className="text-gray-500">
                      Org ID:{" "}
                      <span className="font-mono text-[11px] text-gray-700">
                        {selectedOrg.id}
                      </span>
                    </div>
                    <div className="text-gray-500">
                      Status:{" "}
                      {selectedOrg.active === false ? (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                          Inactive
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          Active
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-gray-500">
                      Locations:{" "}
                      <span className="font-semibold text-gray-900">
                        {locationsForOrg.length}
                      </span>
                    </div>
                    <div className="text-gray-500">
                      Org users:{" "}
                      <span className="font-semibold text-gray-900">
                        {orgUsersForOrg.length}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-gray-400">
                      Use the tabs above to drill into locations, org users,
                      and data for this organization.
                    </p>
                  </div>
                </div>
              </SectionCard>
            )}

            {selectedOrg && activeTab === "locations" && (
              <SectionCard
                title={`Locations for ${selectedOrg.name || selectedOrg.id}`}
                description="Add, rename, or deactivate locations for this org."
              >
                <div className="space-y-3 text-xs">
                  <button
                    type="button"
                    onClick={() => setCreatingLoc((v) => !v)}
                    className="inline-flex items-center rounded-full border border-dashed border-brand-500/60 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100"
                  >
                    {creatingLoc ? "Cancel" : "New location"}
                  </button>

                  {creatingLoc && (
                    <form
                      onSubmit={handleCreateLocation}
                      className="mt-2 grid gap-2 rounded-xl border border-gray-200 bg-gray-50/80 p-3 text-xs"
                    >
                      <div className="grid gap-2 md:grid-cols-2">
                        <label className="flex flex-col gap-1">
                          <span className="font-medium text-gray-700">
                            Location name
                          </span>
                          <input
                            value={createLocName}
                            onChange={(e) => setCreateLocName(e.target.value)}
                            placeholder="CTGS Food Bank"
                            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="font-medium text-gray-700">
                            Address (optional)
                          </span>
                          <input
                            value={createLocAddress}
                            onChange={(e) =>
                              setCreateLocAddress(e.target.value)
                            }
                            placeholder="Christ the Good Shepherd, LA"
                            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                          />
                        </label>
                      </div>
                      <div className="flex items-center justify-end gap-2 mt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setCreatingLoc(false);
                            setCreateLocName("");
                            setCreateLocAddress("");
                          }}
                          className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700"
                        >
                          Save location
                        </button>
                      </div>
                    </form>
                  )}

                  <div className="mt-2 space-y-2">
                    {locationsForOrg.length === 0 ? (
                      <p className="text-xs text-gray-500">
                        No locations yet for this organization.
                      </p>
                    ) : (
                      locationsForOrg.map((loc) => (
                        <LocationRow
                          key={loc.id}
                          location={loc}
                          onUpdate={handleUpdateLocation}
                        />
                      ))
                    )}
                  </div>
                </div>
              </SectionCard>
            )}

            {selectedOrg && activeTab === "users" && (
              <SectionCard
                title={`Org users for ${selectedOrg.name || selectedOrg.id}`}
                description="Admins and volunteers attached to this organization."
              >
                <div className="space-y-2 text-xs">
                  {loadingOrgUsers && orgUsersForOrg.length === 0 && (
                    <p className="text-xs text-gray-400">Loading org users…</p>
                  )}
                  {orgUsersForOrg.length === 0 && !loadingOrgUsers && (
                    <p className="text-xs text-gray-500">
                      No org users yet for this organization. You can create them
                      from your usual onboarding flow.
                    </p>
                  )}
                  <div className="space-y-2">
                    {orgUsersForOrg.map((row) => (
                      <OrgUserRow
                        key={row.id}
                        row={row}
                        locationsForOrg={locationsForOrg}
                        onToggleActive={() => handleToggleOrgUserActive(row)}
                        onRoleChange={(role) =>
                          handleOrgUserRoleChange(row, role)
                        }
                        onScopeChange={(scope) =>
                          handleOrgUserScopeChange(row, scope)
                        }
                      />
                    ))}
                  </div>
                </div>
              </SectionCard>
            )}

            {selectedOrg && activeTab === "data" && (
              <SectionCard
                title="Data debug (read-only snapshot)"
                description="Quick peek into counts and structure. For deeper analysis, use exports and reports."
              >
                <ul className="space-y-1 text-xs text-gray-600">
                  <li>
                    <span className="font-medium">Clients count:</span>{" "}
                    {counts.clients ?? "—"}
                  </li>
                  <li>
                    <span className="font-medium">Visits count:</span>{" "}
                    {counts.visits ?? "—"}
                  </li>
                  <li>
                    <span className="font-medium">USDA first markers:</span>{" "}
                    {counts.markers ?? "—"}
                  </li>
                </ul>
                <p className="mt-2 text-[11px] text-gray-400">
                  To keep this safe and fast, this panel only shows counts, not
                  full record lists. Use your standard Reports / USDA pages to
                  export detailed data.
                </p>
              </SectionCard>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Small subcomponents
────────────────────────────────────────────────────────────── */

function OrgRow({ org, onRename, onToggleActive }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(org.name || org.id);

  useEffect(() => {
    setName(org.name || org.id);
  }, [org.name, org.id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    await onRename(org.id, name);
    setEditing(false);
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs">
      <div className="min-w-0 flex-1">
        {editing ? (
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
            />
            <button
              type="submit"
              className="rounded-full bg-brand-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-brand-700"
            >
              Save
            </button>
          </form>
        ) : (
          <Fragment>
            <div className="font-medium text-gray-900 truncate">
              {org.name || org.id}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-gray-500">
              <span className="font-mono text-[10px] text-gray-500">
                {org.id}
              </span>
              {org.active === false ? (
                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  inactive
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                  active
                </span>
              )}
            </div>
          </Fragment>
        )}
      </div>
      <div className="flex items-center gap-1">
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-full border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
          >
            Rename
          </button>
        )}
        <button
          type="button"
          onClick={() => onToggleActive(org.id, org.active !== false)}
          className="rounded-full border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
        >
          {org.active === false ? "Activate" : "Deactivate"}
        </button>
      </div>
    </div>
  );
}

function LocationRow({ location, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(location.name || "");
  const [address, setAddress] = useState(location.address || "");

  useEffect(() => {
    setName(location.name || "");
    setAddress(location.address || "");
  }, [location.name, location.address]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    await onUpdate(location.id, { name, address });
    setEditing(false);
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs">
      {editing ? (
        <form onSubmit={handleSubmit} className="space-y-2">
          <div className="grid gap-2 md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="font-medium text-gray-700">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium text-gray-700">Address</span>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              />
            </label>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-full bg-brand-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-brand-700"
            >
              Save
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <div className="font-medium text-gray-900">
              {location.name || "Unnamed location"}
            </div>
            {location.address && (
              <div className="text-[11px] text-gray-500">
                {location.address}
              </div>
            )}
            <div className="text-[11px] text-gray-500">
              Status:{" "}
              {location.active === false ? (
                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  inactive
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                  active
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() =>
                onUpdate(location.id, {
                  active: location.active === false ? true : false,
                })
              }
              className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
            >
              {location.active === false ? "Activate" : "Deactivate"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function OrgUserRow({
  row,
  locationsForOrg,
  onToggleActive,
  onRoleChange,
  onScopeChange,
}) {
  const [updatingRole, setUpdatingRole] = useState(false);
  const [updatingScope, setUpdatingScope] = useState(false);

  const scopeLabel = useMemo(() => {
    if (row.scope === "all" || row.role === "admin") {
      const explicit = row.locationIds && row.locationIds.length > 0;
      return explicit ? "Admin (subset locations)" : "Admin (all locations)";
    }
    if (row.scope === "subset" || row.role === "volunteer") {
      const count = (row.locationIds && row.locationIds.length) || 0;
      return count === 0
        ? "Volunteer (no locations)"
        : `Volunteer (${count} location${count === 1 ? "" : "s"})`;
    }
    return "Unknown scope";
  }, [row]);

  const assignedLocationNames = useMemo(() => {
    if (!row.locationIds || row.locationIds.length === 0) return [];
    const map = new Map(
      locationsForOrg.map((l) => [l.id, l.name || l.id])
    );
    return row.locationIds.map((id) => map.get(id) || id);
  }, [row.locationIds, locationsForOrg]);

  const handleRoleClick = async (role) => {
    setUpdatingRole(true);
    try {
      await onRoleChange(role);
    } finally {
      setUpdatingRole(false);
    }
  };

  const handleScopeClick = async (scope) => {
    setUpdatingScope(true);
    try {
      await onScopeChange(scope);
    } finally {
      setUpdatingScope(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="min-w-0">
          <div className="font-medium text-gray-900 truncate">
            {row.email || row.userId}
          </div>
          <div className="text-[11px] text-gray-500">
            userId:{" "}
            <span className="font-mono text-[10px] text-gray-500">
              {row.userId}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700">
            {row.role === "admin" ? "Admin" : "Volunteer"}
          </span>
          {row.active === false || row.suspended === true ? (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              {row.suspended === true ? "suspended" : "inactive"}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
              active
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1 text-[11px] text-gray-600">
        <div>
          <span className="font-medium">Scope:</span>{" "}
          <span>{scopeLabel}</span>
        </div>
        {assignedLocationNames.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {assignedLocationNames.map((name) => (
              <span
                key={name}
                className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-700"
              >
                {name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-gray-500">Role:</span>
          <button
            type="button"
            disabled={updatingRole}
            onClick={() => handleRoleClick("admin")}
            className={[
              "rounded-full border px-2 py-0.5",
              row.role === "admin"
                ? "border-brand-600 bg-brand-50 text-brand-700"
                : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
            ].join(" ")}
          >
            Admin
          </button>
          <button
            type="button"
            disabled={updatingRole}
            onClick={() => handleRoleClick("volunteer")}
            className={[
              "rounded-full border px-2 py-0.5",
              row.role === "volunteer"
                ? "border-brand-600 bg-brand-50 text-brand-700"
                : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
            ].join(" ")}
          >
            Volunteer
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-gray-500">Scope:</span>
          <button
            type="button"
            disabled={updatingScope}
            onClick={() => handleScopeClick("all")}
            className={[
              "rounded-full border px-2 py-0.5",
              row.scope === "all" || row.role === "admin"
                ? "border-brand-600 bg-brand-50 text-brand-700"
                : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
            ].join(" ")}
          >
            All
          </button>
          <button
            type="button"
            disabled={updatingScope}
            onClick={() => handleScopeClick("subset")}
            className={[
              "rounded-full border px-2 py-0.5",
              row.scope === "subset" && row.role !== "admin"
                ? "border-brand-600 bg-brand-50 text-brand-700"
                : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
            ].join(" ")}
          >
            Subset
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToggleActive}
            className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
          >
            {row.active === false || row.suspended === true
              ? "Reactivate"
              : "Deactivate"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DataCountBox({ label, value, loading }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="mt-1 text-base font-semibold text-gray-900">
        {loading ? "…" : value ?? "—"}
      </div>
    </div>
  );
}
