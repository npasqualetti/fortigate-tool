export type AssetIdentityStatus = "active" | "stale";

export type AssetIdentityRecord = {
  id: number;
  firewallId: number;
  firewallName: string;
  firewallIp: string;
  siteNumber: string;
  siteName: string;
  siteCity: string;
  siteState: string;
  macAddress: string;
  ipAddress: string | null;
  interfaceName: string | null;
  switchId: string | null;
  switchPort: string | null;
  deviceName: string | null;
  oui: string | null;
  syncSource: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  status: AssetIdentityStatus;
};

export type AssetSearchResult = {
  items: AssetIdentityRecord[];
  total: number;
  page: number;
  pageSize: number;
};

export type AssetInventoryStats = {
  total: number;
  active: number;
  stale: number;
  retentionDays: number;
  staleDays: number;
  lastFullSyncAt: string | null;
  lastFullSyncBy: string | null;
  lastFullSyncDevices: number;
};

export type AssetSyncSession = {
  id: string;
  username: string;
  firewallIds: number[];
  startedAt: string;
  processed: number;
  ingested: number;
  errors: Array<{ firewallId: number; message: string }>;
};

export type AssetSyncActionState = {
  error?: string;
  message?: string;
  syncId?: string;
  totalFirewalls?: number;
  processed?: number;
  ingested?: number;
  complete?: boolean;
  errors?: Array<{ firewallId: number; message: string }>;
};

export type AssetSearchActionState = AssetSearchResult & {
  error?: string;
  stats?: AssetInventoryStats;
};
