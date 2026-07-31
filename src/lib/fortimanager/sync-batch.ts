import type { FortiManagerDiscoveredDevice } from "@/lib/fortimanager/types";

export function getFortiManagerSyncBatchSize() {
  const parsed = Number(process.env.FORTIMANAGER_SYNC_BATCH_SIZE || 25);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 25;
  }
  return Math.min(Math.floor(parsed), 100);
}

export function getSyncBatchSlice(
  devices: FortiManagerDiscoveredDevice[],
  offset: number,
  batchSize = getFortiManagerSyncBatchSize()
) {
  const safeOffset = Math.max(0, Math.min(offset, devices.length));
  const batch = devices.slice(safeOffset, safeOffset + batchSize);
  const processed = safeOffset + batch.length;
  return {
    batch,
    processed,
    total: devices.length,
    complete: processed >= devices.length,
    nextOffset: processed
  };
}
