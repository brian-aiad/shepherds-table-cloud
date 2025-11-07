// src/auth/AuthProvider.tsx
// Shepherds Table Cloud — Auth context (multi-tenant, Nov 2025)
//
// Exposes useAuth() fields via context:
// { uid, email, org, orgs, location, locations, role, isAdmin, canPickAllLocations, loading,
//   setActiveOrg, setActiveLocation, saveDeviceDefaultScope, signOutNow,
//   roleForActiveOrg, isAdminForActiveOrg, hasCapability,
//   canAccessDashboard, canCreateClients, canEditClients, canLogVisits,
//   canDeleteClients, canDeleteVisits, canViewReports, canManageOrg }
//
// Role model:
// - Master (via custom claim `master: true`) → full access across all orgs/locations
// - Org Admins (from /orgUsers) → admin inside their org; may be restricted to specific locationIds
// - Volunteers (from /orgUsers) → restricted to assigned locationIds; no “All locations”
// Suspensions:
// - /orgUsers rows with { active: false } OR { suspended: true } are ignored (no access)
//
// Data used:
// organizations/{orgId} {name, slug, active, ...}
// locations/{locId} {orgId, name, active, ...}
// orgUsers/{uid_orgId} {orgId, userId, email, role, locationIds, active, suspended}
// users/{uid} {activeOrgId, activeLocationId}
//
// Notes:
// - “All locations” only appears when canPickAllLocations === true (admin with org-wide access)
// - Local device scope mirror: stc_scope { activeOrgId, activeLocationId }

import React, { createContext, useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut, getIdTokenResult } from "firebase/auth";
import type { User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { can, type AppRole } from "./roles";

/* ──────────────────────────────────────────────────────────────────────────────
   Types
────────────────────────────────────────────────────────────────────────────── */
type Role = "admin" | "volunteer" | null;

type Org = {
  id: string;
  name?: string;
  slug?: string;
  active?: boolean;
  [k: string]: any;
};

type LocationRec = {
  id: string;
  orgId: string;
  name?: string;
  address?: string;
  active?: boolean;
  [k: string]: any;
};

export type AuthValue = {
  uid: string | null;
  email: string | null;

  org: Org | null;
  location: LocationRec | null;

  orgs: Org[];
  locations: LocationRec[];

  /** Coarse badge across ANY org (kept for back-compat) */
  role: Role;

  /** Admin for the ACTIVE org (or master); kept for back-compat */
  isAdmin: boolean;

  /** New: role resolved for ACTIVE org only (null when no active org) */
  roleForActiveOrg: AppRole | null;

  /** New: explicit alias for per-active-org admin */
  isAdminForActiveOrg: boolean;

  /** New: capability checker for ACTIVE org */
  hasCapability: (capability: string) => boolean;

  /** New: convenience booleans (ACTIVE org) */
  canAccessDashboard: boolean;
  canCreateClients: boolean;
  canEditClients: boolean;
  canLogVisits: boolean;
  canDeleteClients: boolean;
  canDeleteVisits: boolean;
  canViewReports: boolean;
  canManageOrg: boolean;

  /** UI helper: show “All locations” only if true */
  canPickAllLocations: boolean;

  loading: boolean;

  setActiveOrg: (orgId: string | null) => Promise<void>;
  setActiveLocation: (locationId: string | null) => Promise<void>;
  saveDeviceDefaultScope: () => Promise<void>;
  signOutNow: () => Promise<void>;
};

/* ──────────────────────────────────────────────────────────────────────────────
   Device scope mirror (localStorage)
────────────────────────────────────────────────────────────────────────────── */
const LS_KEY = "stc_scope";
type DeviceScope = { activeOrgId: string | null; activeLocationId: string | null };

function readDeviceScope(): DeviceScope {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { activeOrgId: null, activeLocationId: null };
    const parsed = JSON.parse(raw);
    return {
      activeOrgId: parsed?.activeOrgId ?? null,
      activeLocationId: parsed?.activeLocationId ?? null,
    };
  } catch {
    return { activeOrgId: null, activeLocationId: null };
  }
}

function writeDeviceScope(patch: Partial<DeviceScope>) {
  const prev = readDeviceScope();
  const next: DeviceScope = {
    activeOrgId: patch.activeOrgId ?? prev.activeOrgId,
    activeLocationId: patch.activeLocationId ?? prev.activeLocationId,
  };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/* Persist current device scope to Firestore only when user explicitly asks */
async function persistUserScopeToFirestore(uid: string, scope: DeviceScope) {
  const uref = doc(db, "users", uid);
  await setDoc(
    uref,
    {
      activeOrgId: scope.activeOrgId ?? null,
      activeLocationId: scope.activeLocationId ?? null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Context defaults
────────────────────────────────────────────────────────────────────────────── */
export const AuthContext = createContext<AuthValue>({
  uid: null,
  email: null,

  org: null,
  location: null,

  orgs: [],
  locations: [],

  role: null,
  isAdmin: false,

  roleForActiveOrg: null,
  isAdminForActiveOrg: false,
  hasCapability: () => false,

  canAccessDashboard: false,
  canCreateClients: false,
  canEditClients: false,
  canLogVisits: false,
  canDeleteClients: false,
  canDeleteVisits: false,
  canViewReports: false,
  canManageOrg: false,

  canPickAllLocations: false,

  loading: true,

  setActiveOrg: async () => {},
  setActiveLocation: async () => {},
  saveDeviceDefaultScope: async () => {},
  signOutNow: async () => {},
});

/* ──────────────────────────────────────────────────────────────────────────────
   Branded loading screen (kept)
────────────────────────────────────────────────────────────────────────────── */
function BrandedLoading() {
  const logoSrc = `${import.meta.env.BASE_URL}logo.png`;
  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center text-white"
      style={{
        background:
          "linear-gradient(160deg, var(--brand-700) 0%, var(--brand-600) 55%, var(--brand-500) 100%)",
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{
          background:
            "radial-gradient(600px 260px at -8% -10%, rgba(255,255,255,.45), transparent 60%), radial-gradient(520px 240px at 108% 120%, rgba(255,255,255,.35), transparent 60%)",
        }}
      />
      <div className="relative z-10 flex flex-col items-center gap-4">
        <img
          src={logoSrc}
          alt="Shepherd’s Table logo"
          className="h-16 w-16 rounded-xl bg-white p-2 ring-1 ring-black/10 object-contain shadow-md"
        />
        <div className="text-xl font-semibold tracking-tight drop-shadow-[0_1px_0_rgba(0,0,0,.2)]">
          Shepherd’s Table
        </div>
        <div className="mt-2 inline-flex items-center gap-2 text-white/95">
          <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity="0.25" />
            <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" fill="none" />
          </svg>
          <span className="text-base font-medium">Loading…</span>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Provider
────────────────────────────────────────────────────────────────────────────── */
export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [uid, setUid] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [locations, setLocations] = useState<LocationRec[]>([]);
  const [org, setOrg] = useState<Org | null>(null);
  const [location, setLocation] = useState<LocationRec | null>(null);

  const [role, setRole] = useState<Role>(null); // coarse badge: any admin anywhere → "admin"
  const [isMaster, setIsMaster] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  // Per-org maps
  const [rolesByOrg, setRolesByOrg] = useState<Record<string, Role>>({});
  const [allowedLocsByOrg, setAllowedLocsByOrg] = useState<Record<string, string[]>>({});
  // true when admin has org-wide location access (no explicit locationIds restriction)
  const [adminAllByOrg, setAdminAllByOrg] = useState<Record<string, boolean>>({});

  /* Derived flags */
  const isAdmin = useMemo(() => {
    if (isMaster) return true;
    const activeOrgId = org?.id || null;
    if (!activeOrgId) return false;
    return rolesByOrg[activeOrgId] === "admin";
  }, [isMaster, org?.id, rolesByOrg]);

  const canPickAllLocations = useMemo(() => {
    if (isMaster) return true;
    const activeOrgId = org?.id || null;
    if (!activeOrgId) return false;
    return rolesByOrg[activeOrgId] === "admin" && adminAllByOrg[activeOrgId] === true;
  }, [isMaster, org?.id, rolesByOrg, adminAllByOrg]);

  /** Role for active org (future-ready to 'manager'|'viewer') */
  const roleForActiveOrg: AppRole | null = useMemo(() => {
    const activeOrgId = org?.id || null;
    if (!activeOrgId) return null;
    const r = rolesByOrg[activeOrgId];
    if (!r) return null;
    // Map legacy Role to AppRole; today only "admin"|"volunteer" are emitted.
    return (r as AppRole) ?? null;
  }, [org?.id, rolesByOrg]);

  /** Explicit alias; keep old isAdmin for back-compat, expose new name */
  const isAdminForActiveOrg = isAdmin;

  /** Capability checker (ACTIVE org) */
  const hasCapability = useCallback(
    (capability: string) => {
      // Master/admin always allowed
      if (isAdminForActiveOrg) return true;
      return can(roleForActiveOrg, capability);
    },
    [isAdminForActiveOrg, roleForActiveOrg]
  );

  /** Convenience booleans (ACTIVE org) */
  const canAccessDashboard = hasCapability("dashboard");
  const canCreateClients   = hasCapability("createClients");
  const canEditClients     = hasCapability("editClients");
  const canLogVisits       = hasCapability("logVisits");
  const canDeleteClients   = hasCapability("deleteClients");
  const canDeleteVisits    = hasCapability("deleteVisits");
  const canViewReports     = hasCapability("viewReports");
  const canManageOrg       = hasCapability("manageOrg");

  /* Actions */
  const signOutNow = useCallback(async () => {
    await signOut(auth);
  }, []);

  const setActiveOrg = useCallback(
    async (orgId: string | null) => {
      if (!uid) return;

      const nextOrg = orgId ? (orgs.find((o) => o.id === orgId) ?? null) : null;
      setOrg(nextOrg);

      let nextLoc: LocationRec | null = null;
      if (nextOrg) {
        const locsForOrg = locations.filter((l) => l.orgId === nextOrg.id);
        const adminHere = isMaster || rolesByOrg[nextOrg.id] === "admin";

        if (adminHere) {
          const allow = allowedLocsByOrg[nextOrg.id] || [];
          const adminAll = adminAllByOrg[nextOrg.id] === true || allow.length === 0;
          nextLoc = adminAll
            ? (locsForOrg[0] ?? null)
            : (locsForOrg.find((l) => allow.includes(l.id)) ?? null);
        } else {
          const allow = allowedLocsByOrg[nextOrg.id] || [];
          nextLoc = locsForOrg.find((l) => allow.includes(l.id)) ?? null;
        }
      }

      setLocation(nextLoc);
      writeDeviceScope({
        activeOrgId: nextOrg?.id ?? null,
        activeLocationId: nextLoc?.id ?? null,
      });
    },
    [uid, orgs, locations, isMaster, rolesByOrg, allowedLocsByOrg, adminAllByOrg]
  );

  // "" (empty string) is the sentinel for "All locations" — only when allowed.
  const setActiveLocation = useCallback(
    async (locationId: string | null) => {
      if (!uid) return;

      const activeOrgId = org?.id || null;
      if (!activeOrgId) return;

      const adminHere = isMaster || rolesByOrg[activeOrgId] === "admin";

      if (locationId === "") {
        const allow = allowedLocsByOrg[activeOrgId] || [];
        const adminAll = adminHere && (adminAllByOrg[activeOrgId] === true || allow.length === 0);
        if (!adminAll) return;

        const allPseudo = { id: "", orgId: activeOrgId, name: "All locations" } as LocationRec;
        setLocation(allPseudo);
        writeDeviceScope({ activeLocationId: "" });
        return;
      }

      const next = locationId ? (locations.find((l) => l.id === locationId) ?? null) : null;

      // cross-org guard
      if (next && next.orgId !== activeOrgId) {
        const locsForOrg = locations.filter((l) => l.orgId === activeOrgId);
        const fallback = adminHere
          ? (locsForOrg[0] ?? null)
          : (() => {
              const allow = allowedLocsByOrg[activeOrgId] || [];
              return locsForOrg.find((l) => allow.includes(l.id)) ?? null;
            })();
        setLocation(fallback);
        writeDeviceScope({ activeLocationId: fallback?.id ?? null });
        return;
      }

      // volunteers must be explicitly assigned
      if (!adminHere && next) {
        const allow = allowedLocsByOrg[activeOrgId] || [];
        if (!allow.includes(next.id)) {
          const locsForOrg = locations.filter((l) => l.orgId === activeOrgId);
          const fallback = locsForOrg.find((l) => allow.includes(l.id)) ?? null;
          setLocation(fallback);
          writeDeviceScope({ activeLocationId: fallback?.id ?? null });
          return;
        }
      }

      setLocation(next);
      writeDeviceScope({ activeLocationId: next?.id ?? null });
    },
    [uid, org?.id, locations, isMaster, rolesByOrg, allowedLocsByOrg, adminAllByOrg]
  );

  const saveDeviceDefaultScope = useCallback(async () => {
    if (!uid) return;
    const scope = readDeviceScope();
    await persistUserScopeToFirestore(uid, scope);
  }, [uid]);

  /* ── Bootstrap ───────────────────────────────────────────────────────────── */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u: User | null) => {
      setLoading(true);
      try {
        if (!u) {
          // reset on sign-out
          setUid(null);
          setEmail(null);
          setOrg(null);
          setLocation(null);
          setOrgs([]);
          setLocations([]);
          setRole(null);
          setIsMaster(false);
          setRolesByOrg({});
          setAllowedLocsByOrg({});
          setAdminAllByOrg({});
          setLoading(false);
          return;
        }

        setUid(u.uid);
        setEmail(u.email ?? null);

        // Master via custom claim
        let masterNow = false;
        try {
          const token = await getIdTokenResult(u);
          masterNow = token?.claims?.master === true;
        } catch {
          masterNow = false;
        }
        setIsMaster(masterNow);

        // ensure users/{uid} shell
        const uref = doc(db, "users", u.uid);
        const usnap = await getDoc(uref);
        if (!usnap.exists()) {
          await setDoc(
            uref,
            { email: u.email ?? "", createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
            { merge: true }
          );
        }

        let nextOrgs: Org[] = [];
        let nextLocations: LocationRec[] = [];
        let nextRole: Role = null;

        let mapRolesByOrg: Record<string, Role> = {};
        let mapAllowedLocsByOrg: Record<string, string[]> = {};
        let mapAdminAllByOrg: Record<string, boolean> = {};

        if (masterNow) {
          // Master sees all orgs and locations
          const orgQs = await getDocs(collection(db, "organizations"));
          nextOrgs = orgQs.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Org[];

          const locQs = await getDocs(collection(db, "locations"));
          nextLocations = locQs.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as LocationRec[];

          nextRole = "admin";
        } else {
          // Non-master: build access from orgUsers, ignoring inactive/suspended
          const ouQs = await getDocs(
            query(collection(db, "orgUsers"), where("userId", "==", u.uid))
          );

          const orgIds = new Set<string>();
          mapRolesByOrg = {};
          mapAllowedLocsByOrg = {};
          mapAdminAllByOrg = {};

          ouQs.forEach((row) => {
            const rec = row.data() as any;
            if (!rec?.orgId) return;

            // Skip inactive / suspended memberships
            if (rec?.active === false || rec?.suspended === true) return;

            orgIds.add(rec.orgId);

            const r: Role = rec?.role === "admin" ? "admin" : "volunteer";
            mapRolesByOrg[rec.orgId] = r;

            const locs = Array.isArray(rec?.locationIds) ? rec.locationIds.filter(Boolean) : [];

            if (r === "admin") {
              // Admin w/ explicit locationIds → restricted; empty → org-wide
              mapAllowedLocsByOrg[rec.orgId] = locs;
              mapAdminAllByOrg[rec.orgId] = locs.length === 0;
            } else {
              // Volunteer must have explicit allow list (can be empty = no access)
              mapAllowedLocsByOrg[rec.orgId] = locs;
              mapAdminAllByOrg[rec.orgId] = false;
            }
          });

          // Fetch org docs we actually belong to
          const orgFetches = Array.from(orgIds).map(async (id) => {
            const snap = await getDoc(doc(db, "organizations", id));
            return snap.exists() ? ({ id: snap.id, ...(snap.data() as any) } as Org) : null;
          });
          nextOrgs = (await Promise.all(orgFetches)).filter(Boolean) as Org[];

          // Fetch locations per org, respecting location restrictions
          const locFetches = nextOrgs.map(async (o) => {
            const qs = await getDocs(query(collection(db, "locations"), where("orgId", "==", o.id)));
            const all = qs.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as LocationRec[];

            const r = mapRolesByOrg[o.id] || "volunteer";
            if (r === "admin") {
              const allow = mapAllowedLocsByOrg[o.id] || [];
              return (mapAdminAllByOrg[o.id] === true || allow.length === 0)
                ? all
                : all.filter((l) => allow.includes(l.id));
            }
            const allow = mapAllowedLocsByOrg[o.id] || [];
            return all.filter((l) => allow.includes(l.id));
          });
          nextLocations = (await Promise.all(locFetches)).flat();

          // Coarse badge
          nextRole = Object.values(mapRolesByOrg).includes("admin") ? "admin" : "volunteer";
        }

        // Initial selection: prefer device scope, then stored in users/{uid}, else first available
        const device = readDeviceScope();
        const stored = (await getDoc(doc(db, "users", u.uid))).data() as any | undefined;

        const storedOrgId: string | null = stored?.activeOrgId ?? null;
        const storedLocId: string | null = stored?.activeLocationId ?? null;

        const pickOrgId =
          (device.activeOrgId && nextOrgs.find((o) => o.id === device.activeOrgId)?.id) ||
          (storedOrgId && nextOrgs.find((o) => o.id === storedOrgId)?.id) ||
          nextOrgs[0]?.id ||
          null;

        const pickOrg = pickOrgId ? nextOrgs.find((o) => o.id === pickOrgId) ?? null : null;

        let pickLocId: string | null =
          typeof device.activeLocationId !== "undefined"
            ? device.activeLocationId
            : (typeof storedLocId !== "undefined" ? storedLocId : null);

        if (pickOrg) {
          const locsForOrg = nextLocations.filter((l) => l.orgId === pickOrg.id);
          const adminHere = masterNow || (mapRolesByOrg[pickOrg.id] === "admin");

          if (pickLocId === "" && adminHere) {
            const allow = mapAllowedLocsByOrg[pickOrg.id] || [];
            const adminAll = masterNow || mapAdminAllByOrg[pickOrg.id] === true || allow.length === 0;
            if (adminAll) {
              setOrg(pickOrg);
              setLocation({ id: "", orgId: pickOrg.id, name: "All locations" } as LocationRec);
              writeDeviceScope({ activeOrgId: pickOrg.id, activeLocationId: "" });
            } else {
              const resolved = locsForOrg.find((l) => allow.includes(l.id)) ?? locsForOrg[0] ?? null;
              setOrg(pickOrg);
              setLocation(resolved ?? null);
              writeDeviceScope({ activeOrgId: pickOrg.id, activeLocationId: resolved?.id ?? null });
            }
          } else {
            const resolved =
              (pickLocId && locsForOrg.find((l) => l.id === pickLocId)) || locsForOrg[0] || null;
            setOrg(pickOrg);
            setLocation(resolved ?? null);
            writeDeviceScope({
              activeOrgId: pickOrg.id,
              activeLocationId: resolved?.id ?? null,
            });
          }
        } else {
          setOrg(null);
          setLocation(null);
          writeDeviceScope({ activeOrgId: null, activeLocationId: null });
        }

        setOrgs(nextOrgs);
        setLocations(nextLocations);
        setRole(nextRole);

        // commit maps to state
        setRolesByOrg(mapRolesByOrg);
        setAllowedLocsByOrg(mapAllowedLocsByOrg);
        setAdminAllByOrg(mapAdminAllByOrg);
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  const value: AuthValue = useMemo(
    () => ({
      uid,
      email,
      org,
      orgs,
      location,
      locations,

      role,                 // coarse badge (any-admin)
      isAdmin,              // back-compat

      roleForActiveOrg,
      isAdminForActiveOrg,
      hasCapability,

      canAccessDashboard,
      canCreateClients,
      canEditClients,
      canLogVisits,
      canDeleteClients,
      canDeleteVisits,
      canViewReports,
      canManageOrg,

      canPickAllLocations,
      loading,
      setActiveOrg,
      setActiveLocation,
      saveDeviceDefaultScope,
      signOutNow,
    }),
    [
      uid,
      email,
      org,
      orgs,
      location,
      locations,

      role,
      isAdmin,

      roleForActiveOrg,
      isAdminForActiveOrg,
      hasCapability,

      canAccessDashboard,
      canCreateClients,
      canEditClients,
      canLogVisits,
      canDeleteClients,
      canDeleteVisits,
      canViewReports,
      canManageOrg,

      canPickAllLocations,
      loading,
      setActiveOrg,
      setActiveLocation,
      saveDeviceDefaultScope,
      signOutNow,
    ]
  );

  if (loading) {
    return (
      <AuthContext.Provider value={value}>
        <BrandedLoading />
      </AuthContext.Provider>
    );
    }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
