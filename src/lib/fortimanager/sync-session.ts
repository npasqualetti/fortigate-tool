import "server-only";

import { randomUUID } from "node:crypto";
import type { FortiManagerDiscoveredDevice } from "@/lib/fortimanager/types";

export type StoredFortiManagerSyncSession = {
  id: string;
  username: string;
  devices: FortiManagerDiscoveredDevice[];
  verifyTls: boolean;
  defaultAdom: string;
  host: string;
  createdAt: string;
};

export function createSyncSessionId() {
  return randomUUID();
}

export function serializeSyncSession(session: StoredFortiManagerSyncSession) {
  return JSON.stringify({
    devices: session.devices,
    verifyTls: session.verifyTls,
    defaultAdom: session.defaultAdom,
    host: session.host
  });
}

export function parseSyncSessionPayload(
  id: string,
  username: string,
  createdAt: string,
  payload: string
): StoredFortiManagerSyncSession | null {
  try {
    const parsed = JSON.parse(payload) as {
      devices?: FortiManagerDiscoveredDevice[];
      verifyTls?: boolean;
      defaultAdom?: string;
      host?: string;
    };
    if (!Array.isArray(parsed.devices)) {
      return null;
    }
    return {
      id,
      username,
      devices: parsed.devices,
      verifyTls: Boolean(parsed.verifyTls),
      defaultAdom: parsed.defaultAdom || "",
      host: parsed.host || "",
      createdAt
    };
  } catch {
    return null;
  }
}
