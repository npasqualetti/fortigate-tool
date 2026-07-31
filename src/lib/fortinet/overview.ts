import "server-only";

import { listFirewalls } from "@/lib/db";
import { createFortinetClient } from "@/lib/fortinet/create-client";
import { isFirewallApiReady, firewallConnectionLabel } from "@/lib/fortinet/connectivity";
import { formatFortigateModelLabel, isGenericFortigateModel } from "@/lib/fortinet/hardware-label";
import { extractResourceUsagePercent } from "@/lib/fortinet/resource-usage";

export type FirewallRecord = ReturnType<typeof listFirewalls>[number];

export type PublicFirewallRecord = {
  id: number;
  name: string;
  ipAddress: string;
  hostname: string | null;
  model: string | null;
  serialNumber: string | null;
  verifyTls: boolean;
  tokenConfigured: boolean;
  connectionLabel: string;
  fmgDeviceName: string | null;
};

export type FirewallOverview = {
  firewall: PublicFirewallRecord;
  apiStatus: "online" | "offline" | "not_configured";
  error?: string;
  hostname?: string;
  fortiOsVersion?: string;
  platform?: string;
  serialNumber?: string;
  uptime?: string;
  cpuUsage?: string;
  memoryUsage?: string;
  updatedAt: string;
};

export function toPublicFirewall(firewall: FirewallRecord): PublicFirewallRecord {
  return {
    id: firewall.id,
    name: firewall.name,
    ipAddress: firewall.ipAddress,
    hostname: firewall.hostname,
    model: firewall.model,
    serialNumber: firewall.serialNumber,
    verifyTls: firewall.verifyTls,
    tokenConfigured: isFirewallApiReady(firewall),
    connectionLabel: firewallConnectionLabel(firewall),
    fmgDeviceName: firewall.fmgDeviceName
  };
}

export type FirewallLiveHardware = {
  model: string | null;
  serialNumber: string | null;
  hostname: string | null;
  liveModel: string | null;
  liveSerialNumber: string | null;
  liveHostname: string | null;
  apiStatus: "online" | "offline" | "not_configured";
  error?: string;
};

const HARDWARE_HOSTNAME_KEYS = ["hostname", "host_name", "host-name", "sys_hostname", "syshostname"] as const;

const HARDWARE_SERIAL_KEYS = [
  "serial",
  "serial_number",
  "serialnumber",
  "serial_no",
  "serialno",
  "sn",
  "bios_serial",
  "biosserial"
] as const;

export async function getFirewallLiveHardware(firewall: FirewallRecord): Promise<FirewallLiveHardware> {
  if (!isFirewallApiReady(firewall)) {
    return {
      model: firewall.model,
      serialNumber: firewall.serialNumber,
      hostname: firewall.hostname,
      liveModel: null,
      liveSerialNumber: null,
      liveHostname: null,
      apiStatus: "not_configured",
      error: "No FortiManager device mapping or API token configured."
    };
  }

  try {
    const client = createFortinetClient(firewall);
    const [statusResult, globalResult, webUiStateResult] = await Promise.all([
      safeFortinetQuery(() => client.status()),
      safeFortinetQuery(() => client.systemGlobal()),
      safeFortinetQuery(() => client.webUiState())
    ]);
    const apiSources = [statusResult.data || {}, globalResult.data || {}, webUiStateResult.data || {}];
    const hasLiveData = [statusResult, globalResult, webUiStateResult].some((result) => result.data);

    if (!hasLiveData) {
      return {
        model: firewall.model,
        serialNumber: firewall.serialNumber,
        hostname: firewall.hostname,
        liveModel: null,
        liveSerialNumber: null,
        liveHostname: null,
        apiStatus: "offline",
        error: statusResult.error?.message || "Unable to query Fortinet device."
      };
    }

    const liveModel = extractLiveHardwareModel(apiSources);
    const liveSerial = getStringByKeyPriority(apiSources, [...HARDWARE_SERIAL_KEYS]) || null;
    const liveHostname = getStringByKeyPriority(apiSources, [...HARDWARE_HOSTNAME_KEYS]) || null;

    return {
      model: liveModel ?? firewall.model,
      serialNumber: liveSerial ?? firewall.serialNumber,
      hostname: liveHostname ?? firewall.hostname,
      liveModel,
      liveSerialNumber: liveSerial,
      liveHostname,
      apiStatus: "online"
    };
  } catch (caught) {
    return {
      model: firewall.model,
      serialNumber: firewall.serialNumber,
      hostname: firewall.hostname,
      liveModel: null,
      liveSerialNumber: null,
      liveHostname: null,
      apiStatus: "offline",
      error: caught instanceof Error ? caught.message : "Unable to query Fortinet device."
    };
  }
}

export async function getFirewallOverview(firewall: FirewallRecord): Promise<FirewallOverview> {
  const publicFirewall = toPublicFirewall(firewall);
  const baseOverview: FirewallOverview = {
    firewall: publicFirewall,
    apiStatus: isFirewallApiReady(firewall) ? "offline" : "not_configured",
    updatedAt: new Date().toISOString()
  };

  if (!isFirewallApiReady(firewall)) {
    return { ...baseOverview, error: "No FortiManager device mapping or API token configured." };
  }

  try {
    const client = createFortinetClient(firewall);
    const [statusResult, globalResult, resourceResult, webUiStateResult] = await Promise.all([
      safeFortinetQuery(() => client.status()),
      safeFortinetQuery(() => client.systemGlobal()),
      safeFortinetQuery(() => client.resourceStatus()),
      safeFortinetQuery(() => client.webUiState())
    ]);
    const status = statusResult.data || {};
    const systemGlobal = globalResult.data || {};
    const resourceStatus = resourceResult.data || {};
    const webUiState = webUiStateResult.data || {};
    const hasLiveData = [statusResult, globalResult, resourceResult, webUiStateResult].some((result) => result.data);

    if (!hasLiveData) {
      throw statusResult.error || new Error("Unable to query Fortinet device.");
    }

    const apiSources = [status, systemGlobal, resourceStatus, webUiState];

    return {
      ...baseOverview,
      apiStatus: "online",
      hostname: getStringByKeyPriority(apiSources, [...HARDWARE_HOSTNAME_KEYS]),
      fortiOsVersion: getVersion(apiSources),
      platform: extractLiveHardwareModel(apiSources) || getFirstStringDeep(apiSources, ["platform", "platform_full_name"]),
      serialNumber: getStringByKeyPriority(apiSources, [...HARDWARE_SERIAL_KEYS]),
      uptime: getUptime(apiSources, webUiState),
      cpuUsage:
        extractResourceUsagePercent(resourceStatus, "cpu") ||
        getPercent(apiSources, ["cpu", "cpu_usage", "cpu-usage", "cpu_used", "cpu-used"]),
      memoryUsage:
        extractResourceUsagePercent(resourceStatus, "memory") ||
        getPercent(apiSources, ["memory", "mem", "mem_usage", "memory_usage", "memory-used", "mem-used"])
    };
  } catch (caught) {
    return {
      ...baseOverview,
      error: caught instanceof Error ? caught.message : "Unable to query Fortinet device."
    };
  }
}

async function safeFortinetQuery<T>(query: () => Promise<T>): Promise<{ data?: T; error?: Error }> {
  try {
    return { data: await query() };
  } catch (caught) {
    return { error: caught instanceof Error ? caught : new Error("Fortinet request failed.") };
  }
}

function getStringByKeyPriority(sources: unknown[], keys: string[]) {
  for (const key of keys) {
    const value = findDeepValue(sources, [normalizeKey(key)]);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return undefined;
}

function extractLiveHardwareModel(sources: unknown[]) {
  const modelNumber = getStringByKeyPriority(sources, ["model_number", "modelnumber"]);
  if (modelNumber) {
    return formatFortigateModelLabel(modelNumber);
  }

  const modelCode = getStringByKeyPriority(sources, ["model", "model_code", "modelcode"]);
  if (modelCode) {
    const formatted = formatFortigateModelLabel(modelCode);
    if (formatted && !isGenericFortigateModel(formatted)) {
      return formatted;
    }
  }

  const platformFullName = getStringByKeyPriority(sources, [
    "platform_full_name",
    "platformfullname",
    "hardware_model",
    "hardwaremodel",
    "version_hw",
    "versionhw"
  ]);
  if (platformFullName && !isGenericFortigateModel(platformFullName)) {
    return formatFortigateModelLabel(platformFullName);
  }

  const modelName = getStringByKeyPriority(sources, ["model_name", "modelname"]);
  if (modelName && !isGenericFortigateModel(modelName)) {
    return formatFortigateModelLabel(modelName);
  }

  if (modelCode) {
    return formatFortigateModelLabel(modelCode);
  }

  return null;
}

function getFirstStringDeep(sources: unknown[], keys: string[]) {
  const normalizedKeys = keys.map(normalizeKey);
  const value = findDeepValue(sources, normalizedKeys);

  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
}

function getFirstNumberDeep(sources: unknown[], keys: string[]) {
  const normalizedKeys = keys.map(normalizeKey);
  const value = findDeepValue(sources, normalizedKeys);

  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function getVersion(sources: unknown[]) {
  const version = getFirstStringDeep(sources, ["version", "fortios_version", "firmware", "firmware_version"]);
  const build = getFirstStringDeep(sources, ["build", "buildno", "build_number", "build-number"]);
  return [version, build ? `build ${build}` : ""].filter(Boolean).join(" ") || undefined;
}

function getUptime(sources: unknown[], webUiState: Record<string, unknown>) {
  const uptime = findDeepValue(sources, ["uptime", "systemuptime", "sysuptime"]);
  if (typeof uptime === "string") {
    return uptime;
  }
  if (typeof uptime === "number") {
    return formatSeconds(uptime);
  }

  const snapshotTime = parseFortinetTime(webUiState.snapshot_utc_time);
  const lastReboot = parseFortinetTime(webUiState.utc_last_reboot);
  if (snapshotTime && lastReboot && snapshotTime > lastReboot) {
    return formatSeconds(Math.floor((snapshotTime - lastReboot) / 1000));
  }

  return undefined;
}

function getPercent(sources: unknown[], keys: string[]) {
  const value = getFirstNumberDeep(sources, keys);
  if (typeof value !== "number") {
    return undefined;
  }
  return value <= 1 ? `${Math.round(value * 100)}%` : `${Math.round(value)}%`;
}

function findDeepValue(sources: unknown[], normalizedKeys: string[]): unknown {
  const visited = new Set<unknown>();

  function visit(value: unknown): unknown {
    if (!value || typeof value !== "object" || visited.has(value)) {
      return undefined;
    }

    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const match = visit(item);
        if (match !== undefined) {
          return match;
        }
      }
      return undefined;
    }

    for (const [key, childValue] of Object.entries(value)) {
      if (normalizedKeys.includes(normalizeKey(key))) {
        return childValue;
      }
    }

    for (const childValue of Object.values(value)) {
      const match = visit(childValue);
      if (match !== undefined) {
        return match;
      }
    }

    return undefined;
  }

  for (const source of sources) {
    const match = visit(source);
    if (match !== undefined) {
      return match;
    }
  }

  return undefined;
}

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseFortinetTime(value: unknown) {
  if (typeof value === "number") {
    return value < 10_000_000_000 ? value * 1000 : value;
  }

  if (typeof value === "string" && value.trim()) {
    if (!Number.isNaN(Number(value))) {
      return parseFortinetTime(Number(value));
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
}

function formatSeconds(totalSeconds: number) {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}
