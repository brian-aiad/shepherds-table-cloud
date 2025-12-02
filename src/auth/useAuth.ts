// src/auth/useAuth.ts
// Shepherds Table Cloud — useAuth hook (aligned with AuthProvider, Dec 2025)
//
// What this hook does now:
// • Reads AuthContext (provided by AuthProvider) and returns it.
// • Adds a *lightweight* custom-claims fetch (for debugging / future logic).
// • Exposes: claims, claimsLoading (but DOES NOT override ctx.isMaster).
// • Adds convenience ids: activeOrgId, activeLocationId.
// • Adds device-local scope helpers: setActiveOrgLocal, setActiveLocationLocal.
// • saveDeviceDefaultScope is forwarded from AuthProvider (no extra Firestore writes here).
//
// Important:
// • All *real* auth / role / capability logic lives in AuthProvider.
// • isMaster, roleForActiveOrg, hasCapability, canViewReports, etc. come directly from context.
// • This hook is a thin sugar layer, not a second auth system.

import { useContext, useEffect, useMemo, useState, useCallback } from "react";
import { getIdTokenResult } from "firebase/auth";
import { AuthContext } from "./AuthProvider";
import { auth } from "../lib/firebase";

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

const CLAIMS_TTL_MS = 60_000; // 1 minute

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
  /** Firebase custom claims on the ID token (informational) */
  claims: Claims | null;
  /** Loading state while we fetch claims */
  claimsLoading: boolean;

  /** Convenience: derived ids for current scope */
  activeOrgId: string | null;
  activeLocationId: string | null;

  /** Local-only scope setters (no Firestore writes) */
  setActiveOrgLocal: (orgId: string | null) => void;
  setActiveLocationLocal: (locationId: string | null) => void;
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

        const res = await getIdTokenResult(u).catch(() => null);
        if (!mounted) return;

        const nextClaims = res?.claims ?? {};
        setClaims(nextClaims);
        CLAIMS_CACHE.uid = u.uid;
        CLAIMS_CACHE.claims = nextClaims;
        CLAIMS_CACHE.fetchedAt = Date.now();
      } finally {
        if (mounted) setClaimsLoading(false);
      }
    }

    // Only bother if we have a UID from context
    if (ctx?.uid) {
      loadClaims();
    } else {
      setClaims(null);
      setClaimsLoading(false);
    }

    return () => {
      mounted = false;
    };
  }, [ctx?.uid]);

  // Convenience ids from context
  const activeOrgId = useMemo(() => ctx?.org?.id ?? null, [ctx?.org]);
  const activeLocationId = useMemo(() => ctx?.location?.id ?? null, [ctx?.location]);

  // Local-only scope (no Firestore writes — just device mirror)
  const setActiveOrgLocal = useCallback((orgId: string | null) => {
    writeDeviceScope({ activeOrgId: orgId ?? null });
  }, []);

  const setActiveLocationLocal = useCallback((locationId: string | null) => {
    writeDeviceScope({ activeLocationId: locationId ?? null });
  }, []);

  return {
    ...ctx,
    claims,
    claimsLoading,
    activeOrgId,
    activeLocationId,
    setActiveOrgLocal,
    setActiveLocationLocal,
  } as ExtendedAuth;
}

export default useAuth;
