import "server-only";

import { getAssetRetentionDays } from "@/lib/assets/constants";
import { collectFirewallAssetRows } from "@/lib/assets/collect-firewall-assets";
import { isFirewallApiReady } from "@/lib/fortinet/connectivity";
import {
  getFirewall,
  listFirewalls,
  markAssetFullSyncComplete,
  pruneAssetIdentities,
  upsertAssetIdentities,
  writeAudit
} from "@/lib/db";

export async function runFullAssetSync(username: string) {
  const firewallIds = listFirewalls()
    .filter((firewall) => isFirewallApiReady(firewall))
    .map((firewall) => firewall.id);

  if (firewallIds.length === 0) {
    return { error: "No connected firewalls are available to sync.", ingested: 0, errors: [] as Array<{ firewallId: number; message: string }> };
  }

  let ingested = 0;
  const errors: Array<{ firewallId: number; message: string }> = [];

  for (const firewallId of firewallIds) {
    const firewall = getFirewall(firewallId);
    if (!firewall || !isFirewallApiReady(firewall)) {
      errors.push({ firewallId, message: "Firewall is missing or not connected." });
      continue;
    }

    try {
      const rows = await collectFirewallAssetRows(firewall);
      ingested += upsertAssetIdentities(firewall.id, rows);
    } catch (caught) {
      errors.push({
        firewallId,
        message: caught instanceof Error ? caught.message : "Fortinet sync failed."
      });
    }
  }

  const retentionDays = getAssetRetentionDays();
  pruneAssetIdentities(retentionDays);
  markAssetFullSyncComplete(username, ingested);

  writeAudit({
    username,
    action: "assets.sync_complete",
    targetType: "asset_inventory",
    targetId: "scheduled",
    status: errors.length > 0 ? "error" : "success",
    details: `Synced ${ingested} device record(s) from ${firewallIds.length} firewall(s).`
  });

  return {
    ingested,
    totalFirewalls: firewallIds.length,
    errors,
    message:
      errors.length > 0
        ? `Sync finished with ${errors.length} firewall error(s). Stored ${ingested} device record(s).`
        : `Sync complete. Stored ${ingested} device record(s) with ${retentionDays}-day retention.`
  };
}
