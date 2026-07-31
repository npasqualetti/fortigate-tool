export const APP_ROLES = ["network_admin", "telecom", "fuel", "help_desk"] as const;

export type AppRole = (typeof APP_ROLES)[number];

export const ROLE_LABELS: Record<AppRole, string> = {
  network_admin: "Network Admin",
  telecom: "Telecom",
  fuel: "Fuel",
  help_desk: "Help Desk"
};

export type SessionUser = {
  username: string;
  displayName: string;
  groups: string[];
  roles: AppRole[];
  authProvider: "ad" | "local";
  mustChangePassword: boolean;
};

export type RoleGroup = {
  id: number;
  role: AppRole;
  groupDn: string;
  description: string | null;
};

export type AllowedOui = {
  id: number;
  teamRole: Extract<AppRole, "telecom" | "fuel">;
  oui: string;
  vendor: string | null;
};

export type Site = {
  id: number;
  siteNumber: string;
  name: string;
  address1: string;
  address2: string | null;
  city: string;
  state: string;
  postalCode: string;
  notes: string | null;
};

export type Firewall = {
  id: number;
  siteId: number;
  name: string;
  ipAddress: string;
  hostname: string | null;
  model: string | null;
  serialNumber: string | null;
  fmgDeviceName: string | null;
  adom: string | null;
  vdom: string | null;
  apiTokenEncrypted: string | null;
  verifyTls: boolean;
};

export type AuditEvent = {
  id: number;
  username: string;
  action: string;
  targetType: string;
  targetId: string | null;
  status: "success" | "denied" | "error";
  details: string | null;
  createdAt: string;
};

export type LocalUser = {
  id: number;
  username: string;
  displayName: string;
  passwordHash: string;
  role: AppRole;
  mustChangePassword: boolean;
  disabled: boolean;
};
