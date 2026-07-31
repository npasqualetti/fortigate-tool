export type LearnedDeviceRow = {
  interfaceName: string;
  ipAddress: string;
  macAddress: string;
  deviceName?: string;
};

export type SwitchPortRef = {
  switchId: string;
  portName: string;
  macAddress?: string;
  ipAddress?: string;
};

function stringify(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
}

function normalizeMac(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const hex = String(value).replace(/[^a-fA-F0-9]/g, "");
  if (hex.length !== 12) {
    return undefined;
  }
  return `${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4, 6)}:${hex.slice(6, 8)}:${hex.slice(8, 10)}:${hex.slice(10, 12)}`.toUpperCase();
}

export function extractManagedSwitchId(record: Record<string, unknown>) {
  return stringify(
    record.name ||
      record.switch_id ||
      record["switch-id"] ||
      record.serial ||
      record.device_id ||
      record["device-id"] ||
      record.id
  );
}

export function extractManagedPortName(record: Record<string, unknown>) {
  return stringify(
    record.name ||
      record.port ||
      record.port_name ||
      record["port-name"] ||
      record.interface ||
      record.ifname
  );
}

function extractIpFromRecord(record: Record<string, unknown>) {
  for (const key of [
    "ip",
    "ip_address",
    "ipaddr",
    "client_ip",
    "host_ip",
    "dhcp_ip",
    "addr",
    "address"
  ]) {
    const value = stringify(record[key]);
    if (value && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) && value !== "0.0.0.0") {
      return value;
    }
  }
  return undefined;
}

function extractMacFromRecord(record: Record<string, unknown>) {
  for (const key of [
    "mac",
    "mac_address",
    "macaddr",
    "sticky_mac",
    "sticky-mac",
    "client_mac",
    "mac-address",
    "lladdr",
    "dev_mac",
    "device_mac",
    "endpoint_mac",
    "host_mac",
    "connected_mac",
    "learned_mac",
    "remote_mac"
  ]) {
    const normalized = normalizeMac(record[key]);
    if (normalized) {
      return normalized;
    }
  }

  if (record.host && typeof record.host === "object") {
    return extractMacFromRecord(record.host as Record<string, unknown>);
  }

  if (record.endpoint && typeof record.endpoint === "object") {
    return extractMacFromRecord(record.endpoint as Record<string, unknown>);
  }

  if (record.connected_device && typeof record.connected_device === "object") {
    return extractMacFromRecord(record.connected_device as Record<string, unknown>);
  }

  return undefined;
}

/** Parse managed-switch CMDB/monitor payloads into switch + port references. */
export function parseManagedSwitchInventory(payload: unknown): SwitchPortRef[] {
  const refs: SwitchPortRef[] = [];

  function addPort(switchId: string, portRecord: Record<string, unknown>) {
    const portName = extractManagedPortName(portRecord);
    if (!portName) {
      return;
    }
    refs.push({
      switchId,
      portName,
      macAddress: extractMacFromRecord(portRecord),
      ipAddress: extractIpFromRecord(portRecord)
    });
  }

  function visitSwitch(switchRecord: Record<string, unknown>) {
    const switchId = extractManagedSwitchId(switchRecord);
    if (!switchId) {
      return;
    }

    const ports = switchRecord.ports;
    if (Array.isArray(ports)) {
      for (const port of ports) {
        if (port && typeof port === "object") {
          addPort(switchId, port as Record<string, unknown>);
        }
      }
    }

    if (ports && typeof ports === "object" && !Array.isArray(ports)) {
      for (const [portName, portValue] of Object.entries(ports as Record<string, unknown>)) {
        if (portValue && typeof portValue === "object") {
          addPort(switchId, {
            ...(portValue as Record<string, unknown>),
            name: extractManagedPortName(portValue as Record<string, unknown>) || portName
          });
        } else {
          addPort(switchId, { name: portName });
        }
      }
    }
  }

  if (Array.isArray(payload)) {
    for (const entry of payload) {
      if (entry && typeof entry === "object") {
        visitSwitch(entry as Record<string, unknown>);
      }
    }
    return dedupeSwitchPortRefs(refs);
  }

  if (!payload || typeof payload !== "object") {
    return refs;
  }

  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.results)) {
    return parseManagedSwitchInventory(record.results);
  }

  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      if (Array.isArray(value)) {
        for (const entry of value) {
          if (entry && typeof entry === "object") {
            visitSwitch(entry as Record<string, unknown>);
          }
        }
      } else {
        visitSwitch(value as Record<string, unknown>);
      }
    }
  }

  return dedupeSwitchPortRefs(refs);
}

function findManagedSwitchRecord(payload: unknown, switchHint: string): Record<string, unknown> | null {
  const normalizedHint = switchHint.trim().toLowerCase();
  if (!normalizedHint) {
    return null;
  }

  function matches(record: Record<string, unknown>) {
    const candidates = [
      extractManagedSwitchId(record),
      stringify(record.serial),
      stringify(record.name)
    ]
      .filter(Boolean)
      .map((value) => value!.toLowerCase());
    return candidates.includes(normalizedHint);
  }

  function visit(node: unknown): Record<string, unknown> | null {
    if (!node || typeof node !== "object") {
      return null;
    }

    if (Array.isArray(node)) {
      for (const entry of node) {
        const match = visit(entry);
        if (match) {
          return match;
        }
      }
      return null;
    }

    const record = node as Record<string, unknown>;
    if (matches(record)) {
      return record;
    }

    if (Array.isArray(record.results)) {
      return visit(record.results);
    }

    for (const value of Object.values(record)) {
      const match = visit(value);
      if (match) {
        return match;
      }
    }

    return null;
  }

  return visit(payload);
}

function findPortOnSwitch(switchRecord: Record<string, unknown>, portHint: string) {
  const normalizedHint = portHint.trim().toLowerCase();
  const refs = parseManagedSwitchInventory([switchRecord]);
  const match = refs.find((ref) => ref.portName.toLowerCase() === normalizedHint);
  return match?.portName;
}

export function findManagedSwitchPort(
  payload: unknown,
  switchHint: string,
  portHint: string
): { switchId: string; port: string } | null {
  const normalizedPortHint = portHint.trim().toLowerCase();
  if (!switchHint.trim() || !normalizedPortHint) {
    return null;
  }

  const refs = parseManagedSwitchInventory(payload);
  const direct = refs.find(
    (ref) =>
      ref.switchId.toLowerCase() === switchHint.trim().toLowerCase() &&
      ref.portName.toLowerCase() === normalizedPortHint
  );
  if (direct) {
    return { switchId: direct.switchId, port: direct.portName };
  }

  const switchRecord = findManagedSwitchRecord(payload, switchHint);
  if (!switchRecord) {
    return null;
  }

  const switchId = extractManagedSwitchId(switchRecord);
  if (!switchId) {
    return null;
  }

  return {
    switchId,
    port: findPortOnSwitch(switchRecord, portHint) || portHint.trim()
  };
}

export function mergeSwitchPortRefs(...groups: SwitchPortRef[][]) {
  const merged = new Map<string, SwitchPortRef>();
  for (const ref of groups.flat()) {
    const key = `${ref.switchId}|${ref.portName}`;
    const existing = merged.get(key);
    merged.set(key, {
      switchId: ref.switchId,
      portName: ref.portName,
      macAddress: ref.macAddress || existing?.macAddress,
      ipAddress: ref.ipAddress || existing?.ipAddress
    });
  }
  return Array.from(merged.values());
}

/** Walk monitor port_stats payloads for live MAC/IP learned on switch ports. */
export function parseSwitchPortLiveStats(payload: unknown): SwitchPortRef[] {
  const refs: SwitchPortRef[] = [];

  function maybeAdd(context: { switchId?: string; portName?: string }, record: Record<string, unknown>) {
    const switchId = context.switchId || extractManagedSwitchId(record);
    const portName = context.portName || extractManagedPortName(record);
    if (!switchId || !portName) {
      return;
    }
    const macAddress = extractMacFromRecord(record);
    const ipAddress = extractIpFromRecord(record);
    if (!macAddress && !ipAddress) {
      return;
    }
    refs.push({ switchId, portName, macAddress, ipAddress });
  }

  function visit(node: unknown, context: { switchId?: string; portName?: string }) {
    if (!node || typeof node !== "object") {
      return;
    }

    if (Array.isArray(node)) {
      for (const entry of node) {
        visit(entry, context);
      }
      return;
    }

    const record = node as Record<string, unknown>;
    const switchId = extractManagedSwitchId(record) || context.switchId;
    const portName = extractManagedPortName(record) || context.portName;
    const nextContext = { switchId, portName };

    maybeAdd(nextContext, record);

    if (Array.isArray(record.ports)) {
      for (const port of record.ports) {
        visit(port, { switchId, portName: undefined });
      }
    }

    if (record.ports && typeof record.ports === "object" && !Array.isArray(record.ports)) {
      for (const [name, port] of Object.entries(record.ports as Record<string, unknown>)) {
        visit(port, { switchId, portName: extractManagedPortName(port as Record<string, unknown>) || name });
      }
    }

    if (record.port_stats && typeof record.port_stats === "object") {
      visit(record.port_stats, { switchId, portName: undefined });
    }

    for (const [key, value] of Object.entries(record)) {
      if (["ports", "port_stats", "results", "status"].includes(key)) {
        continue;
      }
      if (value && typeof value === "object") {
        const childPortName = /^port\d+$/i.test(key) ? key : portName;
        visit(value, { switchId, portName: childPortName });
      }
    }
  }

  visit(payload, {});
  return mergeSwitchPortRefs(refs);
}

function dedupeSwitchPortRefs(refs: SwitchPortRef[]) {
  return mergeSwitchPortRefs(refs);
}

function normalizePortToken(value: string) {
  const trimmed = value.trim().toLowerCase();
  const match = trimmed.match(/^(?:port)?(\d+)$/i) || trimmed.match(/port(\d+)/i);
  if (match) {
    return `port${match[1]}`;
  }
  return trimmed;
}

/** Rewrite ARP/DHCP interface names to FortiSwitch serial/port when we can correlate. */
export function enrichLearnedDevicesWithSwitchPorts(
  devices: LearnedDeviceRow[],
  portRefs: SwitchPortRef[]
): LearnedDeviceRow[] {
  if (portRefs.length === 0) {
    return devices;
  }

  const macToRef = new Map<string, SwitchPortRef>();
  const ipToRef = new Map<string, SwitchPortRef>();
  const portTokenToRefs = new Map<string, SwitchPortRef[]>();
  const switchIds = [...new Set(portRefs.map((ref) => ref.switchId))];

  for (const ref of portRefs) {
    if (ref.macAddress) {
      macToRef.set(ref.macAddress, ref);
    }
    if (ref.ipAddress) {
      ipToRef.set(ref.ipAddress, ref);
    }
    const token = normalizePortToken(ref.portName);
    const bucket = portTokenToRefs.get(token) || [];
    bucket.push(ref);
    portTokenToRefs.set(token, bucket);
  }

  const enriched = devices.map((device) => {
    if (device.interfaceName.includes("/")) {
      return device;
    }

    const macRef = macToRef.get(device.macAddress.toUpperCase());
    if (macRef) {
      return {
        ...device,
        interfaceName: `${macRef.switchId}/${macRef.portName}`
      };
    }

    const ip = device.ipAddress.trim();
    if (ip && ip !== "unknown") {
      const ipRef = ipToRef.get(ip);
      if (ipRef) {
        return {
          ...device,
          interfaceName: `${ipRef.switchId}/${ipRef.portName}`
        };
      }
    }

    if (switchIds.length === 1) {
      const token = normalizePortToken(device.interfaceName);
      const matches = portTokenToRefs.get(token);
      if (matches?.length === 1) {
        return {
          ...device,
          interfaceName: `${matches[0].switchId}/${matches[0].portName}`
        };
      }
    }

    return device;
  });

  const existingKeys = new Set(
    enriched.map((device) => `${device.macAddress}|${device.interfaceName}|${device.ipAddress}`)
  );

  for (const ref of portRefs) {
    if (!ref.macAddress) {
      continue;
    }
    const interfaceName = `${ref.switchId}/${ref.portName}`;
    const key = `${ref.macAddress}|${interfaceName}|unknown`;
    if (!existingKeys.has(key)) {
      enriched.push({
        interfaceName,
        ipAddress: "unknown",
        macAddress: ref.macAddress
      });
      existingKeys.add(key);
    }
  }

  return enriched;
}

export function formatSwitchInventoryDiagnostic(
  portRefs: SwitchPortRef[],
  switchCount: number,
  source: "cmdb" | "live" | "user-device" = "cmdb"
) {
  const portsWithMac = portRefs.filter((ref) => ref.macAddress).length;
  const portsWithIp = portRefs.filter((ref) => ref.ipAddress).length;
  if (source === "cmdb") {
    return {
      records: portRefs.length,
      devices: portsWithMac,
      note:
        `CMDB port config: ${portRefs.length} ports on ${switchCount} switch(es). ` +
        `Connected device MACs are not stored in CMDB (expected). ARP/DHCP rows stay on FortiGate interfaces until correlated with live switch telemetry or Device Inventory.`
    };
  }
  if (source === "live") {
    return {
      records: portRefs.length,
      devices: portsWithMac,
      note:
        `Live switch telemetry: ${portsWithMac} ports with MAC, ${portsWithIp} with IP from monitor port_stats/status. ` +
        `These are used to map ARP/DHCP devices to SwitchSerial/port.`
    };
  }
  return {
    records: portRefs.length,
    devices: portRefs.length,
    note:
      `Device Inventory: ${portRefs.length} device(s) with FortiSwitch port mapping from user/device/query. ` +
      `Enable switch-controller network-monitoring on the FortiGate if this stays at 0.`
  };
}

export function parseUserDeviceSwitchPorts(payload: unknown): {
  portRefs: SwitchPortRef[];
  devices: LearnedDeviceRow[];
} {
  const portRefs: SwitchPortRef[] = [];
  const devices: LearnedDeviceRow[] = [];

  function addDevice(switchId: string, portName: string, macAddress: string, ipAddress: string, deviceName?: string) {
    portRefs.push({
      switchId,
      portName,
      macAddress,
      ipAddress: ipAddress !== "unknown" ? ipAddress : undefined
    });
    devices.push({
      interfaceName: `${switchId}/${portName}`,
      ipAddress,
      macAddress,
      deviceName
    });
  }

  function visit(entry: Record<string, unknown>) {
    const macAddress = extractMacFromRecord(entry);
    if (!macAddress) {
      return;
    }

    const ipAddress = extractIpFromRecord(entry) || "unknown";
    const deviceName = stringify(
      entry.hostname || entry.host_name || entry["host-name"] || entry.device_name || entry["device-name"]
    );

    const interfaceValue = stringify(
      entry.interface || entry.intf || entry.parent_intfname || entry["parent-intf-name"] || entry.detected_intf
    );
    if (interfaceValue?.includes("/")) {
      const [switchId, portName] = interfaceValue.split("/", 2);
      if (switchId && portName) {
        addDevice(switchId, portName, macAddress, ipAddress, deviceName);
        return;
      }
    }

    const switchId = stringify(
      entry.switch ||
        entry.switch_id ||
        entry["switch-id"] ||
        entry.fsw ||
        entry.fortiswitch ||
        entry.fortiswitch_name ||
        entry.fsw_serial ||
        entry.serial
    );
    const portName = stringify(
      entry.port || entry.switch_port || entry["switch-port"] || entry.port_name || entry["port-name"] || entry.sw_port
    );
    if (switchId && portName) {
      addDevice(switchId, portName, macAddress, ipAddress, deviceName);
    }
  }

  function walk(node: unknown) {
    if (!node || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      for (const entry of node) {
        walk(entry);
      }
      return;
    }

    const record = node as Record<string, unknown>;
    if (extractMacFromRecord(record)) {
      visit(record);
    }

    if (Array.isArray(record.results)) {
      walk(record.results);
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === "object") {
        walk(value);
      }
    }
  }

  walk(payload);
  return {
    portRefs: mergeSwitchPortRefs(portRefs),
    devices: dedupeLearnedDeviceRows(devices)
  };
}

function dedupeLearnedDeviceRows(rows: LearnedDeviceRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.macAddress}|${row.interfaceName}|${row.ipAddress}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}


export function countMappedSwitchPortDevices(devices: LearnedDeviceRow[]) {
  return devices.filter((device) => device.interfaceName.includes("/")).length;
}

export function switchControllerEnabled() {
  if (process.env.FORTINET_DISABLE_SWITCH_CONTROLLER === "true") {
    return false;
  }
  if (process.env.FORTINET_ENABLE_SWITCH_CONTROLLER === "false") {
    return false;
  }
  return true;
}
