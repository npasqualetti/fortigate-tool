import type { FortiManagerClient } from "@/lib/fortimanager/client";
import type { ParsedFortiManagerDeviceRecord } from "@/lib/fortimanager/device-records";
import type { FortiManagerDiscoveredDevice } from "@/lib/fortimanager/types";

function stringify(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}

const NON_FORTIGATE_OS_TYPES = new Set(["faz", "fsw", "fext", "fml", "fct", "fortianalyzer", "fortiswitch"]);

export function mapFortiManagerDeviceRecord(
  record: ParsedFortiManagerDeviceRecord | Record<string, unknown>
): FortiManagerDiscoveredDevice | null {
  const name = stringify(record.name);
  if (!name) {
    return null;
  }

  const osType = stringify(record.os_type);
  if (osType && NON_FORTIGATE_OS_TYPES.has(osType.toLowerCase())) {
    return null;
  }

  return {
    name,
    serialNumber: stringify(record.sn),
    ipAddress: stringify(record.ip),
    hostname: stringify(record.hostname),
    model: stringify(record.platform_str),
    osVersion: stringify(record.os_ver),
    connectionStatus: stringify(record.conn_status),
    osType,
    adom: stringify(record.adom)
  };
}

export async function discoverFortiManagerDevices(client: FortiManagerClient, adom = "") {
  const records = await client.listManagedDevices(adom);
  return records
    .map((record) => mapFortiManagerDeviceRecord(record))
    .filter((device): device is FortiManagerDiscoveredDevice => Boolean(device));
}
