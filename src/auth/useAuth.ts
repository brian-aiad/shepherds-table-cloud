// src/auth/useAuth.ts
// Shepherds Table Cloud — Enhanced useAuth hook (Nov 2025)
//
// What this adds (drop-in safe):
// • Reads Firebase custom claims once per UID (light in-memory throttle)
// • Exposes: claims, claimsLoading, isMaster (claims.master === true only; no hardcoded emails)
// • Capability-based role helpers for the ACTIVE ORG:
//     - roleForActiveOrg
//     - isAdminForActiveOrg
//     - hasCapability(cap)
//     - convenience booleans:
//         canAccessDashboard, canCreateClients, canEditClients, canLogVisits,
//         canDeleteClients, canDeleteVisits, canViewReports, canManageOrg
// • Convenience ids: activeOrgId, activeLocationId
// • Device-local scope helpers: setActiveOrgLocal, setActiveLocationLocal
// • saveDeviceDefaultScope(): persists current (or device) scope to Firestore
//
// Compatibility:
// • Keeps BOTH named and default exports
// • Does NOT change AuthContext shape; it only enriches what the hook returns

import { useContext, useEffect, useMemo, useState, useCallback } from "react";
import { getIdTokenResult } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { AuthContext } from "./AuthProvider";
import { auth, db } from "../lib/firebase";
import { can } from "./roles";

/* ──────────────────────────────────────────────────────────────────────────────
   Device-scope (per-device mirror in localStorage)
────────────────────────────────────────────────────────────────────────────── */
const LS_KEY = "stc_scope";

type DeviceScope = {
  activeOrgId: string | null;
  activeLocationId: string | null;
};

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
    /* ignore storage errors */
  }
}

/* ──────────────────────────────────────────────────────────────────────────────
   Tiny in-memory throttle for claims fetches (per UID)
   Prevents re-calling getIdTokenResult on every mount/rerender.
────────────────────────────────────────────────────────────────────────────── */
type Claims = Record<string, any>;
const CLAIMS_CACHE: {
  uid?: string;
  claims?: Claims | null;
  fetchedAt?: number;
} = { uid: undefined, claims: undefined, fetchedAt: 0 };

// Only refresh claims if UID changed or cache older than TTL.
const CLAIMS_TTL_MS = 60_000; // 1 minute is enough for UI perf without being stale-prone

/* ──────────────────────────────────────────────────────────────────────────────
   Base: read context
────────────────────────────────────────────────────────────────────────────── */
function useAuthBase() {
  return useContext(AuthContext);
}

/* ──────────────────────────────────────────────────────────────────────────────
   Hook
────────────────────────────────────────────────────────────────────────────── */
type ExtendedAuth = ReturnType<typeof useAuthBase> & {
  /** Firebase custom claims on the ID token */
  claims: Claims | null;
  /** Loading state while we fetch claims */
  claimsLoading: boolean;
  /** True only when { master:true } is present on the token (no email fallback) */
  isMaster: boolean;

  /** Capability-based role helpers (ACTIVE ORG ONLY) */
  roleForActiveOrg: string | null;
  isAdminForActiveOrg: boolean;
  hasCapability: (cap: string) => boolean;

  /** Convenience booleans (ACTIVE ORG ONLY) */
  canAccessDashboard: boolean;
  canCreateClients: boolean;
  canEditClients: boolean;
  canLogVisits: boolean;
  canDeleteClients: boolean;
  canDeleteVisits: boolean;
  canViewReports: boolean;
  canManageOrg: boolean;

  /** Convenience: derived ids for current scope */
  activeOrgId: string | null;
  activeLocationId: string | null;

  /** Local-only scope setters (no Firestore writes) */
  setActiveOrgLocal: (orgId: string | null) => void;
  setActiveLocationLocal: (locationId: string | null) => void;

  /** Persist current (or device) scope to users/{uid} */
  saveDeviceDefaultScope: () => Promise<void>;
};

export function useAuth(): ExtendedAuth {
  const ctx = useAuthBase();

  const [claims, setClaims] = useState<Claims | null>(null);
  const [claimsLoading, setClaimsLoading] = useState<boolean>(true);

  // Load custom claims with a tiny per-UID throttle
  useEffect(() => {
    let mounted = true;

    async function loadClaims() {
      setClaimsLoading(true);
      try {
        const u = auth.currentUser;
        if (!u) {
          if (mounted) setClaims(null);
          return;
        }

        const now = Date.now();
        const sameUid = CLAIMS_CACHE.uid === u.uid;
        const fresh = sameUid && now - (CLAIMS_CACHE.fetchedAt || 0) < CLAIMS_TTL_MS;

        if (fresh) {
          if (mounted) setClaims(CLAIMS_CACHE.claims ?? {});
          return;
        }

        // Avoid forcing a refresh; UI can live with eventual consistency here.
        const res = await getIdTokenResult(u).catch(() => null);
        if (mounted) {
          const nextClaims = res?.claims ?? {};
          setClaims(nextClaims);
          CLAIMS_CACHE.uid = u.uid;
          CLAIMS_CACHE.claims = nextClaims;
          CLAIMS_CACHE.fetchedAt = Date.now();
        }
      } finally {
        if (mounted) setClaimsLoading(false);
      }
    }

    loadClaims();
    return () => {
      mounted = false;
    };
  }, [ctx?.uid]);

  // Master flag is claim-only per security model (no hardcoded email)
  const isMaster = useMemo(() => claims?.master === true, [claims]);

  // Convenience ids from context
  const activeOrgId = ctx?.org?.id ?? null;
  const activeLocationId = ctx?.location?.id ?? null;

  // ────────────────────────────────────────────────────────────
  // Role & Capability (ACTIVE ORG)
  // We derive the role for the active org using best-effort fallbacks so we
  // remain drop-in compatible with current context shapes.
  // Priority:
  //   1) ctx.roleForActiveOrg (if already exposed by AuthProvider)
  //   2) ctx.role (single-role apps)
  //   3) claims.rolesByOrg[activeOrgId]
  //   4) ctx.isAdmin ? 'admin' : null
  // ────────────────────────────────────────────────────────────
  const roleForActiveOrg: string | null = useMemo(() => {
    // 1) direct value from context (preferred)
    const r1 = (ctx as any)?.roleForActiveOrg;
    if (r1) return String(r1);

    // 2) single-role on context
    const r2 = (ctx as any)?.role;
    if (r2) return String(r2);

    // 3) rolesByOrg on claims (common pattern for multi-tenant apps)
    const byOrg = (claims as any)?.rolesByOrg;
    if (byOrg && activeOrgId && typeof byOrg === "object") {
      const r3 = byOrg[activeOrgId];
      if (r3) return String(r3);
    }

    // 4) legacy: boolean admin
    if ((ctx as any)?.isAdmin) return "admin";

    return null;
  }, [ctx, claims, activeOrgId]);

  const isAdminForActiveOrg = useMemo(
    () => roleForActiveOrg === "admin",
    [roleForActiveOrg]
  );

  const hasCapability = useCallback(
    (cap: string) => {
      if (!cap) return false;
      if (isAdminForActiveOrg) return true; // admin = full control
      return can(roleForActiveOrg, cap);
    },
    [isAdminForActiveOrg, roleForActiveOrg]
  );

  // Convenience booleans (ACTIVE ORG)
  const canAccessDashboard = hasCapability("dashboard");
  const canCreateClients = hasCapability("createClients");
  const canEditClients = hasCapability("editClients");
  const canLogVisits = hasCapability("logVisits");
  const canDeleteClients = hasCapability("deleteClients");
  const canDeleteVisits = hasCapability("deleteVisits");
  const canViewReports = hasCapability("viewReports");
  const canManageOrg = hasCapability("manageOrg");

  // Local-only scope (no Firestore writes)
  const setActiveOrgLocal = useCallback((orgId: string | null) => {
    writeDeviceScope({ activeOrgId: orgId ?? null });
  }, []);

  const setActiveLocationLocal = useCallback((locationId: string | null) => {
    writeDeviceScope({ activeLocationId: locationId ?? null });
  }, []);

  // Persist current (or device) scope to Firestore for this user
  const saveDeviceDefaultScope = useCallback(async () => {
    const uid = ctx?.uid;
    if (!uid) return;

    // Prefer explicit device mirror; fall back to current in-memory scope
    const scope = readDeviceScope();
    const finalOrgId = scope.activeOrgId ?? activeOrgId ?? null;
    const finalLocId = scope.activeLocationId ?? activeLocationId ?? null;

    // Mirror back to device to keep them in sync
    writeDeviceScope({ activeOrgId: finalOrgId, activeLocationId: finalLocId });

    // Persist to users/{uid}
    const uref = doc(db, "users", uid);
    await setDoc(
      uref,
      {
        activeOrgId: finalOrgId,
        activeLocationId: finalLocId,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }, [ctx?.uid, activeOrgId, activeLocationId]);

  return {
    ...ctx,

    // claims
    claims,
    claimsLoading,
    isMaster,

    // active-org role/capabilities
    roleForActiveOrg,
    isAdminForActiveOrg,
    hasCapability,

    // convenience caps
    canAccessDashboard,
    canCreateClients,
    canEditClients,
    canLogVisits,
    canDeleteClients,
    canDeleteVisits,
    canViewReports,
    canManageOrg,

    // scope convenience
    activeOrgId,
    activeLocationId,

    // device-scope helpers
    setActiveOrgLocal,
    setActiveLocationLocal,
    saveDeviceDefaultScope,
  } as ExtendedAuth;
}

export default useAuth;
