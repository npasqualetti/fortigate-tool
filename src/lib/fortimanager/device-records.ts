import type { FortiManagerRpcResultBlock } from "@/lib/fortimanager/types";

export type ParsedFortiManagerDeviceRecord = Record<string, unknown> & {
  name: string;
  adom?: string | null;
};

export function flattenRpcDataRecords(
  blocks: FortiManagerRpcResultBlock[] | FortiManagerRpcResultBlock | undefined
): ParsedFortiManagerDeviceRecord[] {
  const list = Array.isArray(blocks) ? blocks : blocks ? [blocks] : [];
  const records: ParsedFortiManagerDeviceRecord[] = [];

  for (const block of list) {
    const data = block?.data;
    if (Array.isArray(data)) {
      for (const entry of data) {
        if (entry && typeof entry === "object") {
          const normalized = normalizeDeviceRecord(entry as Record<string, unknown>);
          if (normalized) {
            records.push(normalized);
          }
        }
      }
      continue;
    }

    if (data && typeof data === "object") {
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          const normalized = normalizeDeviceRecord(value as Record<string, unknown>, key);
          if (normalized) {
            records.push(normalized);
          }
        }
      }
    }
  }

  return dedupeDeviceRecords(records);
}

export function flattenExpandMemberDevices(
  blocks: FortiManagerRpcResultBlock[] | FortiManagerRpcResultBlock | undefined
): ParsedFortiManagerDeviceRecord[] {
  const list = Array.isArray(blocks) ? blocks : blocks ? [blocks] : [];
  const records: ParsedFortiManagerDeviceRecord[] = [];

  for (const block of list) {
    const data = block?.data;
    const entries = Array.isArray(data) ? data : data && typeof data === "object" ? [data] : [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const adomRecord = entry as Record<string, unknown>;
      const adomName = stringifyField(adomRecord.name);
      const expandMember = adomRecord["expand member"];
      if (!expandMember || typeof expandMember !== "object") {
        continue;
      }

      const deviceEntries = (expandMember as Record<string, unknown>).device;
      const devices = Array.isArray(deviceEntries) ? deviceEntries : deviceEntries ? [deviceEntries] : [];
      for (const device of devices) {
        if (!device || typeof device !== "object") {
          continue;
        }
        const normalized = normalizeDeviceRecord(device as Record<string, unknown>);
        if (!normalized) {
          continue;
        }
        records.push({
          ...normalized,
          adom: adomName
        });
      }
    }
  }

  return dedupeDeviceRecords(records);
}

function normalizeDeviceRecord(
  record: Record<string, unknown>,
  fallbackName?: string
): ParsedFortiManagerDeviceRecord | null {
  const name = stringifyField(record.name) || fallbackName;
  if (!name) {
    return null;
  }

  const extraInfo = record["extra info"];
  const adomFromExtra =
    extraInfo && typeof extraInfo === "object"
      ? stringifyField((extraInfo as Record<string, unknown>).adom)
      : null;

  return {
    ...record,
    name,
    adom: adomFromExtra || stringifyField(record.adom)
  };
}

export function dedupeDeviceRecords(records: ParsedFortiManagerDeviceRecord[]) {
  const byName = new Map<string, ParsedFortiManagerDeviceRecord>();
  for (const record of records) {
    byName.set(record.name, { ...byName.get(record.name), ...record });
  }
  return Array.from(byName.values());
}

function stringifyField(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}
