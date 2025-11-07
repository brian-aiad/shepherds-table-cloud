export type AppRole = 'admin' | 'volunteer' | 'manager' | 'viewer';
export const CAPABILITIES: Record<AppRole, string[]> = {
  admin: [
    'dashboard','viewReports','export','manageOrg',
    'createClients','editClients','logVisits',
    'deleteClients','deleteVisits'
  ],
  volunteer: ['dashboard','createClients','editClients','logVisits'],
  manager:   ['dashboard','viewReports','export','createClients','editClients','logVisits'],
  viewer:    ['dashboard','viewReports','export'],
};
export function can(role: string | null | undefined, cap: string) {
  if (!role) return false;
  const caps = CAPABILITIES[role as AppRole];
  return !!caps?.includes(cap);
}
