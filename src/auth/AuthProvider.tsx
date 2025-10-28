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

  role: Role;        // coarse (has ANY admin across memberships)
  isAdmin: boolean;  // true only if admin of ACTIVE org, or master
  isMaster: boolean; // explicit master flag (email match)

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

/* ──────────────────────────────────────────────────────────────────────────────
   Branded loading screen (logo + subtle spinner)
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
      {/* highlight accents to match Navbar */}
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
          <svg
            className="h-5 w-5 animate-spin"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
              opacity="0.25"
            />
            <path
              d="M22 12a10 10 0 0 0-10-10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
          </svg>
          <span className="text-base font-medium">Loading…</span>
        </div>
      </div>
    </div>
  );
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [uid, setUid] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [locations, setLocations] = useState<LocationRec[]>([]);
  const [org, setOrg] = useState<Org | null>(null);
  const [location, setLocation] = useState<LocationRec | null>(null);

  const [role, setRole] = useState<Role>(null); // coarse (any admin anywhere)
  const [isMaster, setIsMaster] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  // NEW: per-org role and allowed location maps (for client-side enforcement)
  const [rolesByOrg, setRolesByOrg] = useState<Record<string, Role>>({});
  const [allowedLocsByOrg, setAllowedLocsByOrg] = useState<Record<string, string[]>>({});

  /* ── Derived ─────────────────────────────────────────────────────────────── */
  // isAdmin is scoped to the ACTIVE org (unless master)
  const isAdmin = useMemo(() => {
    if (isMaster) return true;
    const activeOrgId = org?.id || null;
    if (!activeOrgId) return false;
    return rolesByOrg[activeOrgId] === "admin";
  }, [isMaster, org?.id, rolesByOrg]);

  /* ── Actions ─────────────────────────────────────────────────────────────── */
  const signOutNow = useCallback(async () => {
    await signOut(auth);
  }, []);

  // Switch org: update memory + device mirror; pick first VALID location for that org.
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
          // admins can see any location in this org; default to first
          nextLoc = locsForOrg[0] ?? null;
        } else {
          // volunteers limited to explicit allow-list; if none, no selection
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
    [uid, orgs, locations, isMaster, rolesByOrg, allowedLocsByOrg]
  );

  // Switch location within current org: update memory + device mirror.
  // ACCEPTS "" (empty string) as "All locations" for admins of ACTIVE org only.
  const setActiveLocation = useCallback(
    async (locationId: string | null) => {
      if (!uid) return;

      const activeOrgId = org?.id || null;
      if (!activeOrgId) return;

      const adminHere = isMaster || rolesByOrg[activeOrgId] === "admin";

      // Admin-only sentinel: "" = All locations
      if (locationId === "") {
        if (!adminHere) return; // volunteers cannot pick All
        const allPseudo = { id: "", orgId: activeOrgId, name: "All locations" } as LocationRec;
        setLocation(allPseudo);
        writeDeviceScope({ activeLocationId: "" });
        return;
      }

      // Normal single-location selection
      const next = locationId ? (locations.find((l) => l.id === locationId) ?? null) : null;

      // Guard org match
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

      // Volunteers: must be assigned
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
    [uid, org?.id, locations, isMaster, rolesByOrg, allowedLocsByOrg]
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
          setRolesByOrg({});
          setAllowedLocsByOrg({});
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

        // Maps we will commit to state at the end
        let mapRolesByOrg: Record<string, Role> = {};
        let mapAllowedLocsByOrg: Record<string, string[]> = {};

        if (masterNow) {
          // Master: can see all orgs & locations
          const orgQs = await getDocs(collection(db, "organizations"));
          nextOrgs = orgQs.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Org[];

          const locQs = await getDocs(collection(db, "locations"));
          nextLocations = locQs.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as LocationRec[];

          nextRole = "admin";
          mapRolesByOrg = {};            // not needed for master
          mapAllowedLocsByOrg = {};      // not needed for master
        } else {
          // Non-master: memberships from orgUsers
          const ouQs = await getDocs(
            query(collection(db, "orgUsers"), where("userId", "==", u.uid))
          );

          const orgIds = new Set<string>();
          mapRolesByOrg = {};
          mapAllowedLocsByOrg = {};

          ouQs.forEach((row) => {
            const rec = row.data() as any;
            if (!rec?.orgId) return;

            orgIds.add(rec.orgId);

            // role per org
            const r: Role = rec?.role === "admin" ? "admin" : "volunteer";
            mapRolesByOrg[rec.orgId] = r;

            // volunteers: explicit allow-list; admins see all (handled below)
            const locs = Array.isArray(rec?.locationIds) ? rec.locationIds.filter(Boolean) : [];
            mapAllowedLocsByOrg[rec.orgId] = locs;
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

            const roleForOrg = mapRolesByOrg[o.id] || "volunteer";
            if (roleForOrg === "admin") {
              return all; // admin for that org = all its locations
            }

            // volunteer: only explicitly assigned locations; if none assigned, they see none
            const allow = mapAllowedLocsByOrg[o.id] || [];
            return all.filter((l) => allow.includes(l.id));
          });
          nextLocations = (await Promise.all(locFetches)).flat();

          // Coarse UX role: if user is admin in ANY org, mark as admin (UI badge only)
          const hasAnyAdmin = Object.values(mapRolesByOrg).includes("admin");
          nextRole = hasAnyAdmin ? "admin" : "volunteer";
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

        // Location: allow "" (All locations) only for admins of that org (or master)
        let pickLocId: string | null =
          typeof device.activeLocationId !== "undefined" ? device.activeLocationId
          : (typeof storedLocId !== "undefined" ? storedLocId : null);

        if (pickOrg) {
          const locsForOrg = nextLocations.filter((l) => l.orgId === pickOrg.id);
          const adminHere = masterNow || mapRolesByOrg[pickOrg.id] === "admin";

          if (pickLocId === "" && adminHere) {
            setOrg(pickOrg);
            setLocation({ id: "", orgId: pickOrg.id, name: "All locations" } as LocationRec);
            writeDeviceScope({ activeOrgId: pickOrg.id, activeLocationId: "" });
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

  // IMPORTANT: Keep provider mounted; show branded loading screen until init completes.
  if (loading) {
    return (
      <AuthContext.Provider value={value}>
        <BrandedLoading />
      </AuthContext.Provider>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
