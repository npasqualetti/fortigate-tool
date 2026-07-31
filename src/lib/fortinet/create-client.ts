import "server-only";

import type { FortiManagerClient } from "@/lib/fortimanager/client";
import { FortiManagerClient as FortiManagerClientImpl } from "@/lib/fortimanager/client";
import { getFortiManagerSettings } from "@/lib/fortimanager/settings";
import { FortinetClient } from "@/lib/fortinet/client";
import type { Firewall } from "@/lib/types";

let cachedFmgClient: FortiManagerClient | null = null;
let cachedFmgKey: string | null = null;

export function isFortiManagerMode() {
  return Boolean(getFortiManagerSettings());
}

export function getFortiManagerClient() {
  const settings = getFortiManagerSettings();
  if (!settings) {
    return null;
  }

  const cacheKey = `${settings.host}:${settings.apiKey.slice(0, 8)}:${settings.adom}`;
  if (!cachedFmgClient || cachedFmgKey !== cacheKey) {
    cachedFmgClient = new FortiManagerClientImpl(settings);
    cachedFmgKey = cacheKey;
  }
  return cachedFmgClient;
}

export function createFortinetClient(firewall: Firewall, options?: { plainApiToken?: string }) {
  const fmgClient = getFortiManagerClient();
  if (fmgClient && firewall.fmgDeviceName) {
    return new FortinetClient(firewall, { fmgClient });
  }
  return new FortinetClient(firewall, options);
}

export function resetFortiManagerClientCache() {
  cachedFmgClient = null;
  cachedFmgKey = null;
}
