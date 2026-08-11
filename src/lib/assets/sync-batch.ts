import { getAssetSyncBatchSize } from "@/lib/assets/constants";

export function getAssetSyncFirewallBatch(firewallIds: number[], offset: number, batchSize = getAssetSyncBatchSize()) {
  const safeOffset = Math.max(0, Math.min(offset, firewallIds.length));
  const batch = firewallIds.slice(safeOffset, safeOffset + batchSize);
  const processed = safeOffset + batch.length;
  return {
    batch,
    processed,
    total: firewallIds.length,
    complete: processed >= firewallIds.length,
    nextOffset: processed
  };
}
