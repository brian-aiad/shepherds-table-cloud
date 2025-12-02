// src/types/models.ts

// Matches src/auth/roles.ts (AppRole)
export type Role = "admin" | "volunteer" | "manager" | "viewer";

export interface Org {
  id: string;
  name: string;

  // Optional fields that exist in Firestore for many orgs
  slug?: string;
  active?: boolean;
  [key: string]: any;
}

export interface Location {
  id: string;
  name: string;
  orgId: string;

  // Optional extras you already use in AuthProvider / MasterConsole
  address?: string;
  active?: boolean;
  [key: string]: any;
}

export interface Membership {
  uid: string;        // userId in orgUsers
  orgId: string;
  role: Role;

  // Legacy single-location membership (some code may still use this)
  locationId?: string;

  // Newer orgUsers shape uses an array of locations
  locationIds?: string[];

  active?: boolean;
  suspended?: boolean;
  [key: string]: any;
}

export interface UserDoc {
  uid: string;
  email: string | null;
  displayName?: string | null;

  // Scope preferences you’re syncing from useAuth/AuthProvider
  activeOrgId?: string | null;
  activeLocationId?: string | null;

  [key: string]: any;
}

export interface Client {
  id: string;
  firstName: string;
  lastName: string;

  phone?: string;
  householdSize?: number;

  orgId: string;
  locationId: string;

  createdBy: string; // uid
  createdAt?: any;
  updatedAt?: any;

  // USDA / extra flags some collections use
  usdaFirstThisMonth?: boolean;
  [key: string]: any;
}
