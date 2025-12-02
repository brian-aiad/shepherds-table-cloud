// src/auth/roles.ts
// Shepherds Table Cloud — role → capability map
//
// AppRole is used by AuthProvider (roleForActiveOrg) and ProtectedRoute.
// Master / super-admin is handled separately via Firebase custom claim
// and the isMaster flag in AuthProvider, NOT as an AppRole here.

export type AppRole = "admin" | "volunteer" | "manager" | "viewer";

export const CAPABILITIES: Record<AppRole, string[]> = {
  admin: [
    "dashboard",
    "viewReports",
    "export",
    "manageOrg",
    "createClients",
    "editClients",
    "logVisits",
    "deleteClients",
    "deleteVisits",
  ],
  volunteer: ["dashboard", "createClients", "editClients", "logVisits"],
  manager: ["dashboard", "viewReports", "export", "createClients", "editClients", "logVisits"],
  viewer: ["dashboard", "viewReports", "export"],
};

/** Convenience type for all valid capability strings */
export type Capability = (typeof CAPABILITIES)[AppRole][number];

/**
 * can(role, cap) — simple helper used by AuthProvider.hasCapability()
 *
 * - role is usually an AppRole ("admin" | "volunteer" | "manager" | "viewer")
 * - cap is a string like "viewReports", "createClients", etc.
 */
export function can(role: string | null | undefined, cap: string): boolean {
  if (!role) return false;
  const caps = CAPABILITIES[role as AppRole];
  return !!caps?.includes(cap);
}
