// src/auth/AuthProvider.tsx
// Shepherds Table Cloud — Auth context (multi-tenant, Oct 2025)
//
// Exposes useAuth() fields via context:
// { uid, email, org, orgs, location, locations, role, isAdmin, isMaster, loading,
//   setActiveOrg, setActiveLocation, saveDeviceDefaultScope, signOutNow }
//
// Master policy in this build:
// - Master is ONLY the email "csbrianaiad@gmail.com" (no claim required).
// - Admins are determined by /orgUsers/<uid>_<ORGID>.
// - Volunteers can read clients (assigned locations) and write visits (assigned locations).

import React, { createContext, useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
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

  role: Role;
  isAdmin: boolean;   // true for org admins and master
  isMaster: boolean;  // explicit master flag (email match)

  loading: boolean;

  setActiveOrg: (orgId: string | null) => Promise<void>;
  setActiveLocation: (locationId: string | null) => Promise<void>;
  saveDeviceDefaultScope: () => Promise<void>;
  signOutNow: () => Promise<void>;
};

/* ──────────────────────────────────────────────────────────────────────────────
   Constants
────────────────────────────────────────────────────────────────────────────── */
const MASTER_EMAIL = "csbrianaiad@gmail.com"; // single master account
const LS_KEY = "stc_scope"; // per-device mirror of activeOrgId/activeLocationId

/* ──────────────────────────────────────────────────────────────────────────────
   Helpers: device scope
────────────────────────────────────────────────────────────────────────────── */
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
  const next = {
    activeOrgId: patch.activeOrgId ?? prev.activeOrgId,
    activeLocationId: patch.activeLocationId ?? prev.activeLocationId,
  };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/* ──────────────────────────────────────────────────────────────────────────────
   Firestore: persist user context (explicit only)
────────────────────────────────────────────────────────────────────────────── */
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
   Context
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
  isMaster: false,

  loading: true,

  setActiveOrg: async () => {},
  setActiveLocation: async () => {},
  saveDeviceDefaultScope: async () => {},
  signOutNow: async () => {},
});

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [uid, setUid] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [locations, setLocations] = useState<LocationRec[]>([]);
  const [org, setOrg] = useState<Org | null>(null);
  const [location, setLocation] = useState<LocationRec | null>(null);

  const [role, setRole] = useState<Role>(null);
  const [isMaster, setIsMaster] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  /* ── Derived ─────────────────────────────────────────────────────────────── */
  const isAdmin = useMemo(() => isMaster || role === "admin", [isMaster, role]);

  /* ── Actions ─────────────────────────────────────────────────────────────── */
  const signOutNow = useCallback(async () => {
    await signOut(auth);
  }, []);

  // Switch org: update memory + device mirror; auto-pick first location for that org.
  const setActiveOrg = useCallback(
    async (orgId: string | null) => {
      if (!uid) return;

      const nextOrg = orgId ? (orgs.find((o) => o.id === orgId) ?? null) : null;
      setOrg(nextOrg);

      // filter locations for this org
      const locsForOrg = nextOrg ? locations.filter((l) => l.orgId === nextOrg.id) : [];
      const nextLoc = nextOrg ? (locsForOrg[0] ?? null) : null;
      setLocation(nextLoc);

      writeDeviceScope({ activeOrgId: nextOrg?.id ?? null, activeLocationId: nextLoc?.id ?? null });
    },
    [uid, orgs, locations]
  );

  // Switch location within current org: update memory + device mirror.
  const setActiveLocation = useCallback(
    async (locationId: string | null) => {
      if (!uid) return;
      const next = locationId ? (locations.find((l) => l.id === locationId) ?? null) : null;

      // Guard: only allow locations that match current org
      if (next && org && next.orgId !== org.id) {
        const fallback = locations.find((l) => org && l.orgId === org.id) ?? null;
        setLocation(fallback);
        writeDeviceScope({ activeLocationId: fallback?.id ?? null });
        return;
      }

      setLocation(next);
      writeDeviceScope({ activeLocationId: next?.id ?? null });
    },
    [uid, locations, org]
  );

  // Explicit “Make default on this device” → persists the current device scope to Firestore
  const saveDeviceDefaultScope = useCallback(async () => {
    if (!uid) return;
    const scope = readDeviceScope();
    await persistUserScopeToFirestore(uid, scope);
  }, [uid]);

  /* ── Bootstrap on auth state ─────────────────────────────────────────────── */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u: User | null) => {
      setLoading(true);
      try {
        if (!u) {
          // Reset on sign-out
          setUid(null);
          setEmail(null);
          setOrg(null);
          setLocation(null);
          setOrgs([]);
          setLocations([]);
          setRole(null);
          setIsMaster(false);
          setLoading(false);
          return;
        }

        setUid(u.uid);
        setEmail(u.email ?? null);

        // Master flag: ONLY email match
        const masterNow =
          (u.email ?? "").toLowerCase() === MASTER_EMAIL.toLowerCase();
        setIsMaster(masterNow);

        // Ensure users/{uid} shell exists (no scope write here)
        const uref = doc(db, "users", u.uid);
        const usnap = await getDoc(uref);
        if (!usnap.exists()) {
          await setDoc(
            uref,
            { email: u.email ?? "", createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
            { merge: true }
          );
        }

        // Load orgs/locations depending on master/admin
        let nextOrgs: Org[] = [];
        let nextLocations: LocationRec[] = [];
        let nextRole: Role = null;

        if (masterNow) {
          // Master: can see all orgs & locations
          const orgQs = await getDocs(collection(db, "organizations"));
          nextOrgs = orgQs.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Org[];

          const locQs = await getDocs(collection(db, "locations"));
          nextLocations = locQs.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as LocationRec[];

          nextRole = "admin";
        } else {
          // Non-master: memberships from orgUsers
          const ouQs = await getDocs(
            query(collection(db, "orgUsers"), where("userId", "==", u.uid))
          );

          const orgIds = new Set<string>();
          const allowedLocsByOrg: Record<string, string[]> = {};
          let anyAdmin = false;

          ouQs.forEach((row) => {
            const rec = row.data() as any;
            if (!rec?.orgId) return;
            orgIds.add(rec.orgId);
            if (Array.isArray(rec?.locationIds) && rec.locationIds.length) {
              allowedLocsByOrg[rec.orgId] = rec.locationIds;
            }
            if (rec?.role === "admin") anyAdmin = true;
          });

          // Load orgs
          const orgFetches = Array.from(orgIds).map(async (id) => {
            const snap = await getDoc(doc(db, "organizations", id));
            return snap.exists() ? ({ id: snap.id, ...(snap.data() as any) } as Org) : null;
          });
          nextOrgs = (await Promise.all(orgFetches)).filter(Boolean) as Org[];

          // Load locations; volunteers restricted to assigned locationIds
          const locFetches = nextOrgs.map(async (o) => {
            const qs = await getDocs(query(collection(db, "locations"), where("orgId", "==", o.id)));
            const all = qs.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as LocationRec[];
            const allow = allowedLocsByOrg[o.id];
            return allow?.length ? all.filter((l) => allow.includes(l.id)) : all;
          });
          nextLocations = (await Promise.all(locFetches)).flat();

          nextRole = anyAdmin ? "admin" : "volunteer";
        }

        // Resolve initial selection with device-first preference (no Firestore writes here)
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

        const pickLocId =
          (device.activeLocationId &&
            nextLocations.find((l) => l.id === device.activeLocationId && l.orgId === pickOrgId)?.id) ||
          (storedLocId &&
            nextLocations.find((l) => l.id === storedLocId && l.orgId === pickOrgId)?.id) ||
          (pickOrgId ? nextLocations.find((l) => l.orgId === pickOrgId)?.id : null) ||
          null;

        const pickLoc = pickLocId ? nextLocations.find((l) => l.id === pickLocId) ?? null : null;

        setOrgs(nextOrgs);
        setLocations(nextLocations);
        setOrg(pickOrg ?? null);
        setLocation(pickLoc ?? null);
        setRole(nextRole);

        // Update device mirror so reloads are instant on this device
        writeDeviceScope({ activeOrgId: pickOrg?.id ?? null, activeLocationId: pickLoc?.id ?? null });
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
      role,
      isAdmin,
      isMaster,
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
      isMaster,
      loading,
      setActiveOrg,
      setActiveLocation,
      saveDeviceDefaultScope,
      signOutNow,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
