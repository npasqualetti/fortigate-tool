"use server";

import { getAssetRetentionDays, getAssetStaleDays } from "@/lib/assets/constants";
import { collectFirewallAssetRows } from "@/lib/assets/collect-firewall-assets";
import { getAssetSyncFirewallBatch } from "@/lib/assets/sync-batch";
import {
  createAssetSyncSessionId,
  parseAssetSyncSessionPayload,
  serializeAssetSyncSession
} from "@/lib/assets/sync-session";
import type {
  AssetInventoryStats,
  AssetSearchActionState,
  AssetSearchResult,
  AssetSyncActionState
} from "@/lib/assets/types";
import { requireRole } from "@/lib/auth/session";
import { isFirewallApiReady } from "@/lib/fortinet/connectivity";
import {
  deleteAssetSyncSession,
  getAssetInventoryStats,
  getAssetSyncSessionRow,
  getFirewall,
  listFirewalls,
  markAssetFullSyncComplete,
  pruneAssetIdentities,
  saveAssetSyncSession,
  searchAssetIdentities,
  updateAssetSyncSession,
  upsertAssetIdentities,
  writeAudit
} from "@/lib/db";

const ASSET_TOOL_ROLES = ["network_admin", "help_desk", "telecom", "fuel"] as const;
const ASSET_SYNC_ROLES = ["network_admin", "help_desk"] as const;

function buildStats(): AssetInventoryStats {
  const retentionDays = getAssetRetentionDays();
  const staleDays = getAssetStaleDays();
  return {
    ...getAssetInventoryStats(retentionDays, staleDays),
    retentionDays,
    staleDays
  };
}

export async function searchAssetIdentitiesAction(input: {
  query?: string;
  firewallId?: number;
  siteId?: number;
  status?: "active" | "stale" | "all";
  page?: number;
  pageSize?: number;
}): Promise<AssetSearchActionState> {
  await requireRole([...ASSET_TOOL_ROLES]);

  try {
    const retentionDays = getAssetRetentionDays();
    const staleDays = getAssetStaleDays();
    const result = searchAssetIdentities({
      query: input.query,
      firewallId: input.firewallId,
      siteId: input.siteId,
      status: input.status || "all",
      retentionDays,
      staleDays,
      page: input.page || 1,
      pageSize: input.pageSize || 25
    });

    return {
      items: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      stats: buildStats()
    };
  } catch (error) {
    return {
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
      error: error instanceof Error ? error.message : "Unable to search asset inventory."
    };
  }
}

export async function getAssetInventoryStatsAction(): Promise<AssetInventoryStats> {
  await requireRole([...ASSET_TOOL_ROLES]);
  return buildStats();
}

export async function beginAssetSyncAction(): Promise<AssetSyncActionState> {
  const user = await requireRole([...ASSET_SYNC_ROLES]);
  const firewallIds = listFirewalls()
    .filter((firewall) => isFirewallApiReady(firewall))
    .map((firewall) => firewall.id);

  if (firewallIds.length === 0) {
    return { error: "No connected firewalls are available to sync." };
  }

  const syncId = createAssetSyncSessionId();
  const payload = serializeAssetSyncSession({
    firewallIds,
    startedAt: new Date().toISOString(),
    processed: 0,
    ingested: 0,
    errors: []
  });

  saveAssetSyncSession({
    id: syncId,
    username: user.username,
    payloadJson: payload
  });

  writeAudit({
    username: user.username,
    action: "assets.sync_begin",
    targetType: "asset_inventory",
    targetId: syncId,
    status: "success",
    details: `Started asset sync across ${firewallIds.length} firewall(s).`
  });

  return {
    syncId,
    totalFirewalls: firewallIds.length,
    processed: 0,
    ingested: 0,
    complete: false,
    message: `Queued ${firewallIds.length} firewall(s) for asset inventory sync.`
  };
}

export async function processAssetSyncBatchAction(
  syncId: string,
  offset = 0
): Promise<AssetSyncActionState> {
  const user = await requireRole([...ASSET_SYNC_ROLES]);
  const row = getAssetSyncSessionRow(syncId);
  if (!row) {
    return { error: "Asset sync session expired. Start a new sync." };
  }

  const session = parseAssetSyncSessionPayload(row.id, row.username, row.payloadJson);
  if (!session) {
    deleteAssetSyncSession(syncId);
    return { error: "Asset sync session payload was invalid." };
  }

  const batch = getAssetSyncFirewallBatch(session.firewallIds, offset);
  let ingestedThisBatch = 0;

  for (const firewallId of batch.batch) {
    const firewall = getFirewall(firewallId);
    if (!firewall || !isFirewallApiReady(firewall)) {
      session.errors.push({ firewallId, message: "Firewall is missing or not connected." });
      continue;
    }

    try {
      const rows = await collectFirewallAssetRows(firewall);
      ingestedThisBatch += upsertAssetIdentities(firewall.id, rows);
    } catch (caught) {
      session.errors.push({
        firewallId,
        message: caught instanceof Error ? caught.message : "Fortinet sync failed."
      });
    }
  }

  session.processed = batch.processed;
  session.ingested += ingestedThisBatch;
  updateAssetSyncSession(syncId, serializeAssetSyncSession(session));

  if (batch.complete) {
    const retentionDays = getAssetRetentionDays();
    pruneAssetIdentities(retentionDays);
    markAssetFullSyncComplete(user.username, session.ingested);
    deleteAssetSyncSession(syncId);

    writeAudit({
      username: user.username,
      action: "assets.sync_complete",
      targetType: "asset_inventory",
      targetId: syncId,
      status: session.errors.length > 0 ? "error" : "success",
      details: `Synced ${session.ingested} device record(s) from ${session.firewallIds.length} firewall(s).`
    });

    return {
      syncId,
      totalFirewalls: session.firewallIds.length,
      processed: session.processed,
      ingested: session.ingested,
      complete: true,
      errors: session.errors,
      message:
        session.errors.length > 0
          ? `Sync finished with ${session.errors.length} firewall error(s). Stored ${session.ingested} device record(s).`
          : `Sync complete. Stored ${session.ingested} device record(s) with ${retentionDays}-day retention.`
    };
  }

  return {
    syncId,
    totalFirewalls: session.firewallIds.length,
    processed: session.processed,
    ingested: session.ingested,
    complete: false,
    errors: session.errors,
    message: `Synced ${session.processed}/${session.firewallIds.length} firewall(s)...`
  };
}

export async function cancelAssetSyncAction(syncId: string): Promise<AssetSyncActionState> {
  const user = await requireRole([...ASSET_SYNC_ROLES]);
  deleteAssetSyncSession(syncId);
  writeAudit({
    username: user.username,
    action: "assets.sync_cancel",
    targetType: "asset_inventory",
    targetId: syncId,
    status: "success",
    details: "Cancelled in-progress asset sync."
  });
  return { message: "Asset sync cancelled." };
}

export type AssetSearchInitialData = AssetSearchResult & { stats: AssetInventoryStats };

export async function loadAssetWorkspaceAction(): Promise<AssetSearchInitialData> {
  await requireRole([...ASSET_TOOL_ROLES]);
  const retentionDays = getAssetRetentionDays();
  const staleDays = getAssetStaleDays();
  const result = searchAssetIdentities({
    status: "all",
    retentionDays,
    staleDays,
    page: 1,
    pageSize: 25
  });

  return {
    items: result.items,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    stats: buildStats()
  };
}
