import { getOuiFromMac } from "@/lib/mac";

export type LearnedDeviceInput = {
  interfaceName: string;
  ipAddress: string;
  macAddress: string;
  deviceName?: string;
};

export type AssetIdentityUpsertRow = {
  macAddress: string;
  ipAddress: string | null;
  interfaceName: string | null;
  switchId: string | null;
  switchPort: string | null;
  deviceName: string | null;
  oui: string | null;
  syncSource: string;
};

function normalizeMacAddress(value: string) {
  const hex = value.replace(/[^a-fA-F0-9]/g, "");
  if (hex.length !== 12) {
    return null;
  }
  return `${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4, 6)}:${hex.slice(6, 8)}:${hex.slice(8, 10)}:${hex.slice(10, 12)}`.toUpperCase();
}

function normalizeIp(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown" || trimmed === "0.0.0.0") {
    return null;
  }
  return trimmed;
}

function parseSwitchPort(interfaceName: string) {
  if (!interfaceName.includes("/")) {
    return { switchId: null, switchPort: null };
  }
  const slash = interfaceName.indexOf("/");
  const switchId = interfaceName.slice(0, slash).trim();
  const portName = interfaceName.slice(slash + 1).trim();
  if (!switchId || !portName) {
    return { switchId: null, switchPort: null };
  }
  return {
    switchId,
    switchPort: `${switchId}/${portName}`
  };
}

export function mapLearnedDevicesToAssetRows(devices: LearnedDeviceInput[]): AssetIdentityUpsertRow[] {
  return mergeAssetIdentityRows(
    devices
      .map((device) => mapSingleLearnedDevice(device))
      .filter((row): row is AssetIdentityUpsertRow => row !== null)
  );
}

function mapSingleLearnedDevice(device: LearnedDeviceInput): AssetIdentityUpsertRow | null {
  const macAddress = normalizeMacAddress(device.macAddress);
  if (!macAddress) {
    return null;
  }

  const { switchId, switchPort } = parseSwitchPort(device.interfaceName);
  let oui: string | null = null;
  try {
    oui = getOuiFromMac(macAddress);
  } catch {
    oui = null;
  }

  return {
    macAddress,
    ipAddress: normalizeIp(device.ipAddress),
    interfaceName: device.interfaceName?.trim() || null,
    switchId,
    switchPort,
    deviceName: device.deviceName?.trim() || null,
    oui,
    syncSource: switchPort ? "switch-correlated" : "fortigate-learned"
  };
}

export type PoePortInput = {
  portKey: string;
  switchId: string;
  portName: string;
  macAddress?: string;
  ipAddress?: string;
};

export function mapPoePortsToAssetRows(ports: PoePortInput[]): AssetIdentityUpsertRow[] {
  const rows: AssetIdentityUpsertRow[] = [];

  for (const port of ports) {
    const macAddress = port.macAddress ? normalizeMacAddress(port.macAddress) : null;
    if (!macAddress) {
      continue;
    }

    let oui: string | null = null;
    try {
      oui = getOuiFromMac(macAddress);
    } catch {
      oui = null;
    }

    rows.push({
      macAddress,
      ipAddress: normalizeIp(port.ipAddress),
      interfaceName: port.portKey,
      switchId: port.switchId,
      switchPort: port.portKey,
      deviceName: null,
      oui,
      syncSource: "switch-port"
    });
  }

  return mergeAssetIdentityRows(rows);
}

export function mergeAssetIdentityRows(...groups: AssetIdentityUpsertRow[][]) {
  const merged = new Map<string, AssetIdentityUpsertRow>();

  for (const row of groups.flat()) {
    const existing = merged.get(row.macAddress);
    if (!existing) {
      merged.set(row.macAddress, row);
      continue;
    }

    merged.set(row.macAddress, {
      macAddress: row.macAddress,
      ipAddress: row.ipAddress || existing.ipAddress,
      interfaceName: row.interfaceName || existing.interfaceName,
      switchId: row.switchId || existing.switchId,
      switchPort: row.switchPort || existing.switchPort,
      deviceName: row.deviceName || existing.deviceName,
      oui: row.oui || existing.oui,
      syncSource: row.switchPort ? row.syncSource : existing.syncSource
    });
  }

  return Array.from(merged.values());
}
