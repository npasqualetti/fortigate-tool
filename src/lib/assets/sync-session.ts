import "server-only";

import { randomUUID } from "node:crypto";
import type { AssetSyncSession } from "@/lib/assets/types";

export function createAssetSyncSessionId() {
  return randomUUID();
}

export function serializeAssetSyncSession(session: Omit<AssetSyncSession, "id" | "username">) {
  return JSON.stringify(session);
}

export function parseAssetSyncSessionPayload(
  id: string,
  username: string,
  payload: string
): AssetSyncSession | null {
  try {
    const parsed = JSON.parse(payload) as Partial<AssetSyncSession>;
    if (!Array.isArray(parsed.firewallIds)) {
      return null;
    }
    return {
      id,
      username,
      firewallIds: parsed.firewallIds.filter((value): value is number => Number.isInteger(value) && value > 0),
      startedAt: parsed.startedAt || new Date().toISOString(),
      processed: Number(parsed.processed) || 0,
      ingested: Number(parsed.ingested) || 0,
      errors: Array.isArray(parsed.errors) ? parsed.errors : []
    };
  } catch {
    return null;
  }
}
