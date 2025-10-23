// src/auth/AuthProvider.tsx
// Shepherds Table Cloud — Auth context (multi-tenant, Oct 2025)
//
// Exposes useAuth() fields via context:
// { uid, email, org, orgs, location, locations, role, isAdmin, loading, setActiveOrg, setActiveLocation, signOutNow }
//
// Key behaviors & fixes:
// - Master Admin (by email) can see all orgs & locations.
// - Non-master users load memberships from orgUsers and are restricted by role.
// - On org change we ALWAYS pick a valid location (no lingering nulls).
// - We persist activeOrgId/activeLocationId to users/{uid} and mirror to localStorage
//   so each device remembers its last scope without waiting for the network.
// - Defensive loading: never crash consumers; provide safe defaults.

import React, { createContext, useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
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
  isAdmin: boolean;

  loading: boolean;

  setActiveOrg: (orgId: string | null) => Promise<void>;
  setActiveLocation: (locationId: string | null) => Promise<void>;
  signOutNow: () => Promise<void>;
};

/* ──────────────────────────────────────────────────────────────────────────────
   Constants
────────────────────────────────────────────────────────────────────────────── */
const MASTER_ADMIN_EMAIL = "csbrianaiad@gmail.com";
const LS_KEY = "stc_scope"; // mirrors Firestore selection per device

/* ──────────────────────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────────────────────── */
function readDeviceScope() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { activeOrgId: null as string | null, activeLocationId: null as string | null };
    const parsed = JSON.parse(raw);
    return {
      activeOrgId: (parsed?.activeOrgId ?? null) as string | null,
      activeLocationId: (parsed?.activeLocationId ?? null) as string | null,
    };
  } catch {
    return { activeOrgId: null, activeLocationId: null };
  }
}

function writeDeviceScope(patch: { activeOrgId?: string | null; activeLocationId?: string | null }) {
  const prev = readDeviceScope();
  const next = {
    activeOrgId: patch.activeOrgId ?? prev.activeOrgId,
    activeLocationId: patch.activeLocationId ?? prev.activeLocationId,
  };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

async function persistUserContext(
  uid: string,
  patch: Partial<{ activeOrgId: string | null; activeLocationId: string | null }>
) {
  const uref = doc(db, "users", uid);
  await setDoc(
    uref,
    { ...patch, updatedAt: serverTimestamp() },
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
  loading: true,
  setActiveOrg: async () => {},
  setActiveLocation: async () => {},
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
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  /* ── Actions ─────────────────────────────────────────────────────────────── */

  const signOutNow = useCallback(async () => {
    await signOut(auth);
  }, []);

  // Switch org, auto-pick a valid location, persist both
  const setActiveOrg = useCallback(
    async (orgId: string | null) => {
      if (!uid) return;

      // Set org in memory
      const nextOrg = orgId ? (orgs.find((o) => o.id === orgId) ?? null) : null;
      setOrg(nextOrg);

      // Filter locations for this org; if none loaded yet, lazy fetch
      let locsForOrg = locations.filter((l) => l.orgId === orgId);
      if (orgId && locsForOrg.length === 0) {
        const qs = await getDocs(query(collection(db, "locations"), where("orgId", "==", orgId)));
        locsForOrg = qs.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as LocationRec[];
        // merge into cache
        setLocations((prev) => {
          const map = new Map<string, LocationRec>();
          [...prev, ...locsForOrg].forEach((l) => map.set(l.id, l));
          return Array.from(map.values());
        });
      }

      // Always pick a sensible default location (prevents null holes on save)
      const nextLoc = nextOrg ? (locsForOrg[0] ?? null) : null;
      setLocation(nextLoc);

      // Persist (Firestore + device mirror)
      await persistUserContext(uid, {
        activeOrgId: nextOrg?.id ?? null,
        activeLocationId: nextLoc?.id ?? null,
      });
      writeDeviceScope({ activeOrgId: nextOrg?.id ?? null, activeLocationId: nextLoc?.id ?? null });
    },
    [uid, orgs, locations]
  );

  // Switch location within current org and persist
  const setActiveLocation = useCallback(
    async (locationId: string | null) => {
      if (!uid) return;
      const next = locationId ? (locations.find((l) => l.id === locationId) ?? null) : null;
      setLocation(next);
      await persistUserContext(uid, { activeLocationId: next?.id ?? null });
      writeDeviceScope({ activeLocationId: next?.id ?? null });
    },
    [uid, locations]
  );

  /* ── Bootstrap on auth state ─────────────────────────────────────────────── */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setLoading(true);
      try {
        if (!u) {
          // Reset everything on sign-out
          setUid(null);
          setEmail(null);
          setOrg(null);
          setLocation(null);
          setOrgs([]);
          setLocations([]);
          setRole(null);
          setIsAdmin(false);
          setLoading(false);
          return;
        }

        setUid(u.uid);
        setEmail(u.email ?? null);

        const isMaster = (u.email ?? "").toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase();
        let nextOrgs: Org[] = [];
        let nextLocations: LocationRec[] = [];
        let nextRole: Role = null;

        if (isMaster) {
          // Master Admin: all orgs & all locations
          const orgQs = await getDocs(collection(db, "organizations"));
          nextOrgs = orgQs.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Org[];
          const locQs = await getDocs(collection(db, "locations"));
          nextLocations = locQs.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as LocationRec[];
          nextRole = "admin";
        } else {
          // Regular user: derive memberships from orgUsers
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

          // Load locations and restrict volunteers to assigned locationIds
          const locFetches = nextOrgs.map(async (o) => {
            const qs = await getDocs(query(collection(db, "locations"), where("orgId", "==", o.id)));
            const all = qs.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as LocationRec[];
            const allow = allowedLocsByOrg[o.id];
            return allow?.length ? all.filter((l) => allow.includes(l.id)) : all;
          });
          nextLocations = (await Promise.all(locFetches)).flat();

          nextRole = anyAdmin ? "admin" : "volunteer";
        }

        // Load sticky selection (prefer device mirror for instant UX, then reconcile with Firestore)
        const device = readDeviceScope();

        const uref = doc(db, "users", u.uid);
        const usnap = await getDoc(uref);
        if (!usnap.exists()) {
          await setDoc(
            uref,
            { email: u.email ?? "", createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
            { merge: true }
          );
        }
        const data = usnap.data() as any | undefined;
        const stored = {
          activeOrgId: data?.activeOrgId ?? null,
          activeLocationId: data?.activeLocationId ?? null,
        };

        // Resolve initial selection:
        // 1) try device values (fast + per-device),
        // 2) else stored Firestore values,
        // 3) else first allowed org/location.
        const pickOrgId =
          (device.activeOrgId && nextOrgs.find((o) => o.id === device.activeOrgId)?.id) ||
          (stored.activeOrgId && nextOrgs.find((o) => o.id === stored.activeOrgId)?.id) ||
          nextOrgs[0]?.id ||
          null;

        const pickOrg = pickOrgId ? nextOrgs.find((o) => o.id === pickOrgId) ?? null : null;

        const pickLocId =
          (device.activeLocationId &&
            nextLocations.find((l) => l.id === device.activeLocationId && l.orgId === pickOrgId)?.id) ||
          (stored.activeLocationId &&
            nextLocations.find((l) => l.id === stored.activeLocationId && l.orgId === pickOrgId)?.id) ||
          (pickOrgId ? nextLocations.find((l) => l.orgId === pickOrgId)?.id : null) ||
          null;

        const pickLoc = pickLocId ? nextLocations.find((l) => l.id === pickLocId) ?? null : null;

        setOrgs(nextOrgs);
        setLocations(nextLocations);
        setOrg(pickOrg ?? null);
        setLocation(pickLoc ?? null);
        setRole(nextRole);
        setIsAdmin(nextRole === "admin" || isMaster);

        // Persist final decision to both places (avoids drift)
        await persistUserContext(u.uid, {
          activeOrgId: pickOrg?.id ?? null,
          activeLocationId: pickLoc?.id ?? null,
        });
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
      loading,
      setActiveOrg,
      setActiveLocation,
      signOutNow,
    }),
    [uid, email, org, orgs, location, locations, role, isAdmin, loading, setActiveOrg, setActiveLocation, signOutNow]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
