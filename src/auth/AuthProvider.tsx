// src/auth/AuthProvider.tsx
// Provides multi-tenant auth context for Shepherds Table Cloud.
// Exposes a named AuthContext and a default AuthProvider component.
// Notes:
// - Master admin (email: csbrianaiad@gmail.com) can see all orgs/locations.
// - For non-master users we read orgUsers to learn memberships/roles.
// - We persist activeOrgId/activeLocationId to users/{uid} so the selection is sticky.
// - Defensive: never crash while loading; return minimal safe values.

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

type Role = "admin" | "volunteer" | null;

export type AuthValue = {
  uid: string | null;
  email: string | null;

  // Active context
  org: any | null;
  location: any | null;

  // Options
  orgs: any[];
  locations: any[];

  // Role flags
  role: Role;
  isAdmin: boolean;

  // State
  loading: boolean;

  // Actions
  setActiveOrg: (orgId: string | null) => Promise<void>;
  setActiveLocation: (locationId: string | null) => Promise<void>;
  signOutNow: () => Promise<void>;
};

// Safe default so consumers don’t explode before provider mounts
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

const MASTER_ADMIN_EMAIL = "csbrianaiad@gmail.com";

async function persistUserContext(uid: string, patch: Partial<{ activeOrgId: string | null; activeLocationId: string | null }>) {
  const uref = doc(db, "users", uid);
  await setDoc(
    uref,
    { ...patch, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [uid, setUid] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Membership-derived state
  const [orgs, setOrgs] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [org, setOrg] = useState<any | null>(null);
  const [location, setLocation] = useState<any | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Sign out
  const signOutNow = useCallback(async () => {
    await signOut(auth);
  }, []);

  // Switch active org (and auto-pick a location)
  const setActiveOrg = useCallback(
    async (orgId: string | null) => {
      if (!uid) return;
      if (!orgId) {
        setOrg(null);
        setLocations([]);
        setLocation(null);
        await persistUserContext(uid, { activeOrgId: null, activeLocationId: null });
        return;
      }
      const nextOrg = orgs.find((o) => o.id === orgId) || null;
      setOrg(nextOrg);

      // Load locations for this org (filter by role if needed)
      let orgLocs = locations.filter((l) => l.orgId === orgId);
      if (!orgLocs.length) {
        // lazy fallback fetch if locations list was not yet populated
        const qs = await getDocs(query(collection(db, "locations"), where("orgId", "==", orgId)));
        orgLocs = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
      }
      setLocations((prev) => {
        // ensure all current + newly-fetched unique
        const map = new Map<string, any>();
        [...prev, ...orgLocs].forEach((l: any) => map.set(l.id, l));
        return Array.from(map.values());
      });

      // Pick a sensible default location for the org
      const nextLoc = orgLocs[0] ?? null;
      setLocation(nextLoc);

      await persistUserContext(uid, {
        activeOrgId: nextOrg?.id ?? null,
        activeLocationId: nextLoc?.id ?? null,
      });
    },
    [uid, orgs, locations]
  );

  // Switch active location
  const setActiveLocation = useCallback(
    async (locationId: string | null) => {
      if (!uid) return;
      const next = locations.find((l) => l.id === locationId) || null;
      setLocation(next);
      await persistUserContext(uid, { activeLocationId: next?.id ?? null });
    },
    [uid, locations]
  );

  // Subscribe to Firebase Auth and hydrate context
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setLoading(true);
      try {
        if (!u) {
          // Reset state on sign-out
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

        const master = (u.email ?? "").toLowerCase() === MASTER_ADMIN_EMAIL;
        let nextOrgs: any[] = [];
        let nextLocations: any[] = [];
        let nextRole: Role = null;

        if (master) {
          // Master admin: load all orgs & all locations
          const orgQs = await getDocs(collection(db, "organizations"));
          nextOrgs = orgQs.docs.map((d) => ({ id: d.id, ...d.data() }));
          const locQs = await getDocs(collection(db, "locations"));
          nextLocations = locQs.docs.map((d) => ({ id: d.id, ...d.data() }));
          nextRole = "admin";
        } else {
          // Regular member: read orgUsers
          const ouQs = await getDocs(
            query(collection(db, "orgUsers"), where("userId", "==", u.uid))
          );

          const orgIds = new Set<string>();
          const byOrgLocIds: Record<string, string[]> = {};
          let anyAdmin = false;

          ouQs.forEach((docu) => {
            const rec: any = docu.data();
            if (!rec?.orgId) return;
            orgIds.add(rec.orgId);
            if (rec?.locationIds?.length) byOrgLocIds[rec.orgId] = rec.locationIds;
            if (rec?.role === "admin") anyAdmin = true;
          });

          // Load organizations by ids
          const orgFetches = Array.from(orgIds).map(async (id) => {
            const d = await getDoc(doc(db, "organizations", id));
            return d.exists() ? { id: d.id, ...d.data() } : null;
          });
          nextOrgs = (await Promise.all(orgFetches)).filter(Boolean) as any[];

          // Load allowed locations for those orgs
          const locFetches = nextOrgs.map(async (o: any) => {
            const qs = await getDocs(query(collection(db, "locations"), where("orgId", "==", o.id)));
            const all = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
            // Volunteers: restrict to assigned locationIds for that org
            const allow = byOrgLocIds[o.id];
            return allow?.length ? all.filter((l) => allow.includes(l.id)) : all;
          });
          nextLocations = (await Promise.all(locFetches)).flat();

          nextRole = anyAdmin ? "admin" : "volunteer";
        }

        // Pull sticky selection from users/{uid}
        const uref = doc(db, "users", u.uid);
        const usnap = await getDoc(uref);
        let activeOrgId: string | null = null;
        let activeLocationId: string | null = null;

        if (usnap.exists()) {
          const data = usnap.data() as any;
          activeOrgId = data?.activeOrgId ?? null;
          activeLocationId = data?.activeLocationId ?? null;
        } else {
          // Create user doc on first login
          await setDoc(
            uref,
            {
              email: u.email ?? "",
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }

        // Choose defaults if stored values are invalid
        const orgById = (id?: string | null) => nextOrgs.find((o) => o.id === id) ?? null;
        const locById = (id?: string | null) => nextLocations.find((l) => l.id === id) ?? null;

        let nextOrg = orgById(activeOrgId) ?? nextOrgs[0] ?? null;
        let nextLoc: any | null = null;

        // When we have an org, prefer a stored matching location in that org, else first location in that org.
        if (nextOrg) {
          nextLoc =
            locById(activeLocationId) ??
            nextLocations.find((l) => l.orgId === nextOrg.id) ??
            null;
        }

        setOrgs(nextOrgs);
        setLocations(nextLocations);
        setOrg(nextOrg);
        setLocation(nextLoc);
        setRole(nextRole);
        setIsAdmin(nextRole === "admin" || master);

        // Persist chosen context if missing
        await persistUserContext(u.uid, {
          activeOrgId: nextOrg?.id ?? null,
          activeLocationId: nextLoc?.id ?? null,
        });
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
