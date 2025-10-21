// src/types/models.ts
export type Role = 'admin' | 'volunteer';

export interface Org {
  id: string;
  name: string;
}

export interface Location {
  id: string;
  name: string;
  orgId: string;
}

export interface Membership {
  uid: string;
  orgId: string;
  role: Role;
  locationId?: string;
}

export interface UserDoc {
  uid: string;
  email: string | null;
  displayName?: string | null;
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
}
