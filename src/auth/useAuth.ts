// src/auth/useAuth.ts
// Enhanced hook around AuthContext.
// - Loads Firebase custom claims (exposes `claims`, `claimsLoading`, `isMaster`)
// - Provides device-local scope helpers (no Firestore writes)
// - Provides `saveDeviceDefaultScope()` to explicitly persist the current scope
//
// Keeps BOTH named and default exports for compatibility.

import { useContext, useEffect, useMemo, useState, useCallback } from "react";
import { getIdTokenResult } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { AuthContext } from "./AuthProvider";
import { auth, db } from "../lib/firebase";

/** ONLY owner email is master in rules; we still read claims for completeness/UX */
const MASTER_ADMIN_EMAIL = "csbrianaiad@gmail.com";

/** Local mirror key (per-device) */
const LS_KEY = "stc_scope";

type Claims = Record<string, any>;

type ExtendedAuth = ReturnType<typeof useAuthBase> & {
  /** Firebase custom claims on the ID token */
  claims: Claims | null;
  /** True when { master:true } claim is present OR email is the master email (UX parity) */
  isMaster: boolean;
  /** Loading state while we fetch claims */
  claimsLoading: boolean;

  /** Convenience: derived ids for current scope */
  activeOrgId: string | null;
  activeLocationId: string | null;

  /**
   * Local-only scope setters (do NOT write to Firestore).
   * These update the device mirror so scope changes don’t flip other devices.
   */
  setActiveOrgLocal: (orgId: string | null) => void;
  setActiveLocationLocal: (locationId: string | null) => void;

  /**
   * Explicitly persist the current scope as the default for this device AND in Firestore.
   * Call this from the navbar “Make default on this device” action.
   */
  saveDeviceDefaultScope: () => Promise<void>;
};

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
    // ignore storage errors
  }
}

/** Base hook that reads the context as-is (unchanged) */
function useAuthBase() {
  return useContext(AuthContext);
}

export function useAuth(): ExtendedAuth {
  const ctx = useAuthBase();

  const [claims, setClaims] = useState<Claims | null>(null);
  const [claimsLoading, setClaimsLoading] = useState<boolean>(true);

  // Load custom claims from the current ID token (non-fatal; no force refresh)
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
        // Avoid forcing a refresh; swallow permission errors gracefully.
        const res = await getIdTokenResult(u).catch(() => null);
        if (mounted) setClaims(res?.claims ?? {});
      } finally {
        if (mounted) setClaimsLoading(false);
      }
    }

    loadClaims();
    return () => {
      mounted = false;
    };
  }, [ctx?.uid]);

  // Derive master bit: prefer claims, fallback to email match for UX
  const isMaster = useMemo(() => {
    const byClaim = claims?.master === true;
    const byEmail = (ctx?.email ?? "").toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase();
    return Boolean(byClaim || byEmail);
  }, [claims, ctx?.email]);

  // Derived ids for convenience
  const activeOrgId = ctx?.org?.id ?? null;
  const activeLocationId = ctx?.location?.id ?? null;

  // Local-only updates (no Firestore writes)
  const setActiveOrgLocal = useCallback((orgId: string | null) => {
    writeDeviceScope({ activeOrgId: orgId ?? null });
  }, []);

  const setActiveLocationLocal = useCallback((locationId: string | null) => {
    writeDeviceScope({ activeLocationId: locationId ?? null });
  }, []);

  // Explicit persistence for current scope
  const saveDeviceDefaultScope = useCallback(async () => {
    const uid = ctx?.uid;
    if (!uid) return;
    const scope = readDeviceScope();

    // If nothing in LS, fall back to current in-memory scope
    const finalOrgId = scope.activeOrgId ?? activeOrgId ?? null;
    const finalLocId = scope.activeLocationId ?? activeLocationId ?? null;

    // Mirror to device
    writeDeviceScope({ activeOrgId: finalOrgId, activeLocationId: finalLocId });

    // Persist to Firestore
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
    claims,
    isMaster,
    claimsLoading,
    activeOrgId,
    activeLocationId,
    setActiveOrgLocal,
    setActiveLocationLocal,
    saveDeviceDefaultScope,
  } as ExtendedAuth;
}

export default useAuth;
