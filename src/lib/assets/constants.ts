export function getAssetRetentionDays() {
  const parsed = Number(process.env.ASSET_RETENTION_DAYS || 90);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 90;
  }
  return Math.min(Math.floor(parsed), 365);
}

export function getAssetStaleDays() {
  const parsed = Number(process.env.ASSET_STALE_DAYS || 7);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 7;
  }
  return Math.min(Math.floor(parsed), getAssetRetentionDays());
}

export function getAssetSyncBatchSize() {
  const parsed = Number(process.env.ASSET_SYNC_BATCH_SIZE || 1);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return Math.min(Math.floor(parsed), 5);
}
