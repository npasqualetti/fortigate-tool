import "server-only";

import { decryptSecret } from "@/lib/crypto";
import {
  buildFortinetBaseUrl,
  buildFortinetRequestHeaders,
  buildFortinetRequestUrl,
  formatFortinet401Help,
  getFortinetAuthModesToTry,
  type FortinetApiAuthMode
} from "@/lib/fortinet/api-auth";
import { parseInterfaceLinkFields } from "@/lib/fortinet/interface-utils";
import { resolveFortinetMonitorResults } from "@/lib/fortinet/monitor-payload";
import {
  buildFortinetPoeResetAttempts,
  buildFortinetPoeCliCommands,
  buildPrimaryPoeResetAttempts,
  parseFortinetPoeTarget,
  validatePoeResetResponse,
  type FortinetPoeTarget
} from "@/lib/fortinet/poe-reset";
import type { PoePortRow, PoeResetResult } from "@/lib/fortinet/poe-workspace";
import {
  countMappedSwitchPortDevices,
  enrichLearnedDevicesWithSwitchPorts,
  extractManagedSwitchId,
  findManagedSwitchPort,
  formatSwitchInventoryDiagnostic,
  mergeSwitchPortRefs,
  parseManagedSwitchInventory,
  parseSwitchPortLiveStats,
  parseUserDeviceSwitchPorts,
  switchControllerEnabled,
  type SwitchPortRef
} from "@/lib/fortinet/switch-port-enrichment";
import type { FortiManagerClient } from "@/lib/fortimanager/client";
import { formatReadOnlyApiUserHelp, isFortiManagerPermissionError } from "@/lib/fortimanager/errors";
import type { Firewall } from "@/lib/types";

export type FortinetInterface = {
  name: string;
  alias?: string;
  status?: string;
  speed?: string;
  duplex?: string;
  mac?: string;
  ip?: string;
  gateway?: string;
};

export type FortinetPingResult = {
  host: string;
  reachable: boolean;
  packetsSent?: number;
  packetsReceived?: number;
  packetLossPercent?: number;
  minRttMs?: number;
  maxRttMs?: number;
  avgRttMs?: number;
  raw?: Record<string, unknown>;
  source: "fortigate" | "server";
  error?: string;
};

export type FortinetCableTestResult = {
  interfaceName: string;
  supported: boolean;
  status: "pass" | "fail" | "unknown" | "unsupported";
  summary?: string;
  pairs?: Array<{ pair: string; status: string; lengthMeters?: number }>;
  raw?: Record<string, unknown>;
  error?: string;
};

export type FortinetLearnedDevice = {
  interfaceName: string;
  ipAddress: string;
  macAddress: string;
  deviceName?: string;
};

export type FortinetLearnedDeviceDiagnostic = {
  path: string;
  records: number;
  devices: number;
  error?: string;
  note?: string;
};

/** FortiGate-only defaults; sufficient when no FortiSwitch is managed. */
const FORTIGATE_LEARNED_DEVICE_PATHS: Array<{ path: string; note: string }> = [
  { path: "/api/v2/monitor/network/arp", note: "FortiGate learned ARP/MAC table" },
  { path: "/api/v2/monitor/system/dhcp", note: "FortiGate DHCP lease table" }
];

/** Optional probes; enable with FORTINET_LEARNED_DEVICE_INCLUDE_LEGACY=true */
const LEGACY_LEARNED_DEVICE_PATHS: Array<{ path: string; note: string }> = [
  { path: "/api/v2/monitor/firewall/arp", note: "Legacy path; often 404 on newer FortiOS" },
  { path: "/api/v2/cmdb/system/arp-table", note: "Static ARP config only, not live learned MACs" },
  { path: "/api/v2/monitor/router/ipv4", note: "Routing table; rarely includes MACs" }
];

function defaultLearnedDevicePaths() {
  const paths = [...FORTIGATE_LEARNED_DEVICE_PATHS];
  if (process.env.FORTINET_LEARNED_DEVICE_INCLUDE_LEGACY === "true") {
    paths.push(...LEGACY_LEARNED_DEVICE_PATHS);
  }
  return paths;
}

type FortinetResponse<T> = {
  results?: T;
  status?: string;
  message?: string;
};

export class FortinetClient {
  private readonly baseUrl: string;
  private readonly token: string | null;
  private readonly fmgClient: FortiManagerClient | null;

  constructor(
    private readonly firewall: Firewall,
    options?: { plainApiToken?: string; fmgClient?: FortiManagerClient | null }
  ) {
    this.fmgClient = options?.fmgClient ?? null;
    this.baseUrl = buildFortinetBaseUrl(firewall.ipAddress);
    const plainToken = options?.plainApiToken?.trim();
    this.token =
      plainToken ||
      (firewall.apiTokenEncrypted ? decryptSecret(firewall.apiTokenEncrypted).trim() : null);
  }

  /** Throws if the token cannot read /api/v2/monitor/system/status (tries query then Bearer). */
  static async verifyAccess(ipAddress: string, apiToken: string, verifyTls: boolean) {
    const probeFirewall: Firewall = {
      id: 0,
      siteId: 0,
      name: "probe",
      ipAddress,
      hostname: null,
      model: null,
      serialNumber: null,
      fmgDeviceName: null,
      adom: null,
      vdom: "root",
      apiTokenEncrypted: null,
      verifyTls
    };

    const client = new FortinetClient(probeFirewall, { plainApiToken: apiToken });
    await client.status();
  }

  async status() {
    const payload = await this.readJsonPayload("/api/v2/monitor/system/status");
    return resolveFortinetMonitorResults(payload) as Record<string, unknown>;
  }

  async systemGlobal() {
    return this.request<Record<string, unknown>>("/api/v2/cmdb/system/global");
  }

  async resourceStatus() {
    return this.requestAny<Record<string, unknown>>([
      "/api/v2/monitor/system/resource/usage",
      "/api/v2/monitor/system/resource"
    ]);
  }

  async webUiState() {
    return this.request<Record<string, unknown>>("/api/v2/monitor/web-ui/state");
  }

  async interfaces() {
    const result = await this.request<Record<string, Record<string, unknown>> | Array<Record<string, unknown>>>(
      "/api/v2/monitor/system/interface/select"
    );
    const entries = Array.isArray(result)
      ? result.map((item, index) => [String(index), item] as const)
      : Object.entries(result || {});

    return entries.map(([key, item]) => {
      const linkFields = parseInterfaceLinkFields(item);
      return {
        name: String(item.name || item.interface || item.ifname || item.dev || key),
        alias: stringifyOptional(item.alias),
        status: normalizeInterfaceStatus(item),
        speed: linkFields.speed || stringifyOptional(item.speed || item.speed_tx || item.speed_rx),
        duplex: linkFields.duplex,
        mac: stringifyOptional(item.mac || item.mac_address || item.hwaddr),
        ip: stringifyOptional(item.ip || item.ip_address || item.ipaddr || item.address),
        gateway: stringifyOptional(item.gateway || item.gw || item.default_gateway)
      };
    });
  }

  async interfaceByName(name: string) {
    const interfaces = await this.interfaces();
    const target = name.trim().toLowerCase();
    return (
      interfaces.find((item) => item.name.toLowerCase() === target) ||
      interfaces.find((item) => item.alias?.toLowerCase() === target)
    );
  }

  async defaultGatewayForInterface(interfaceName: string) {
    const iface = await this.interfaceByName(interfaceName);
    if (iface?.gateway) {
      return iface.gateway;
    }

    const routes = await this.routerIpv4Routes();
    const target = interfaceName.trim().toLowerCase();
    const defaultRoute = routes.find((route) => {
      const routeInterface = String(route.interface || route.ifname || route.dev || "")
        .trim()
        .toLowerCase();
      const destination = String(route.dst || route.destination || route.network || "").trim();
      const isDefault = destination === "0.0.0.0/0" || destination === "0.0.0.0" || destination === "default";
      return isDefault && routeInterface === target;
    });

    if (defaultRoute) {
      const gateway = defaultRoute.gateway || defaultRoute.gw || defaultRoute.nexthop || defaultRoute.next_hop;
      if (typeof gateway === "string" && gateway.trim()) {
        return gateway.trim();
      }
    }

    return undefined;
  }

  async routerIpv4Routes(): Promise<Array<Record<string, unknown>>> {
    try {
      const payload = await this.request<unknown>("/api/v2/monitor/router/ipv4");
      return flattenRouteRecords(payload);
    } catch {
      return [];
    }
  }

  async pingHost(host: string, options?: { count?: number; interfaceName?: string }): Promise<FortinetPingResult> {
    const count = options?.count ?? 4;
    const bodies: Array<Record<string, unknown>> = [
      { host, count },
      { ping: host, count: String(count) },
      { addr: host, count: String(count) },
      { destination: host, count }
    ];

    if (options?.interfaceName) {
      bodies.push(
        { host, count, interface: options.interfaceName },
        { ping: host, count: String(count), interface: options.interfaceName }
      );
    }

    const paths = ["/api/v2/monitor/system/ping", "/api/v2/monitor/system/ping/check"];
    let lastError: Error | null = null;

    for (const path of paths) {
      for (const body of bodies) {
        try {
          const raw = await this.request<Record<string, unknown>>(path, {
            method: "POST",
            body: JSON.stringify(body)
          });
          return {
            host,
            ...parseFortinetPingPayload(raw),
            raw,
            source: "fortigate"
          };
        } catch (caught) {
          lastError = caught instanceof Error ? caught : new Error("Fortinet ping failed.");
        }
      }
    }

    return {
      host,
      reachable: false,
      source: "fortigate",
      error: lastError?.message || "FortiGate ping API is not available on this device."
    };
  }

  async cableTest(interfaceName: string): Promise<FortinetCableTestResult> {
    const attempts: Array<{ path: string; body: Record<string, unknown> }> = [
      {
        path: "/api/v2/monitor/system/interface/cable-test",
        body: { interface: interfaceName }
      },
      {
        path: `/api/v2/monitor/system/interface/${encodeURIComponent(interfaceName)}/cable-test`,
        body: {}
      },
      {
        path: "/api/v2/monitor/switch-controller/detect-cable",
        body: { port: interfaceName }
      },
      {
        path: "/api/v2/monitor/switch-controller/port-health",
        body: { port: interfaceName }
      }
    ];

    let lastError: string | undefined;

    for (const attempt of attempts) {
      try {
        const raw = await this.request<Record<string, unknown>>(attempt.path, {
          method: "POST",
          body: JSON.stringify(attempt.body)
        });
        return parseFortinetCableTestPayload(interfaceName, raw);
      } catch (caught) {
        lastError = caught instanceof Error ? caught.message : "Cable test request failed.";
      }
    }

    return {
      interfaceName,
      supported: false,
      status: "unsupported",
      error:
        lastError ||
        "Cable test is not exposed on this FortiOS build. It may require a FortiSwitch-managed port or CLI diagnostics."
    };
  }

  async learnedMac(portName: string, macHint?: string) {
    const normalizedHint = macHint ? normalizeMacAddress(macHint) : null;
    if (normalizedHint) {
      return normalizedHint;
    }

    const result = await this.learnedDevices();
    const exact = result.find((entry) => entry.interfaceName === portName);
    if (exact?.macAddress) {
      return exact.macAddress;
    }

    const target = parseFortinetPoeTarget(portName);
    if (!target.switchId) {
      return null;
    }

    const portToken = target.port.toLowerCase();
    const switchToken = target.switchId.toLowerCase();
    const switchPortMatches = result.filter((entry) => {
      const parsed = parseFortinetPoeTarget(entry.interfaceName);
      if (parsed.switchId && parsed.port) {
        return (
          parsed.port.toLowerCase() === portToken &&
          (parsed.switchId.toLowerCase() === switchToken ||
            parsed.switchId.toLowerCase().includes(switchToken) ||
            switchToken.includes(parsed.switchId.toLowerCase()))
        );
      }
      return entry.interfaceName.toLowerCase().endsWith(`/${portToken}`);
    });

    return switchPortMatches[0]?.macAddress || null;
  }

  /** Prefer FortiSwitch port IDs (serial/port) when the form only has a MAC or VLAN-style interface. */
  async resolvePoePort(portName: string, macHint?: string) {
    const trimmed = portName.trim();
    if (parseFortinetPoeTarget(trimmed).switchId) {
      return trimmed;
    }

    const normalizedHint = macHint ? normalizeMacAddress(macHint) : null;
    if (!normalizedHint) {
      return trimmed;
    }

    const devices = await this.learnedDevices();
    const macMatches = devices.filter((entry) => normalizeMacAddress(entry.macAddress) === normalizedHint);
    const switchBacked = macMatches.find((entry) => entry.interfaceName.includes("/"));
    return switchBacked?.interfaceName || trimmed;
  }

  async learnedDevices(): Promise<FortinetLearnedDevice[]> {
    const result = await this.learnedDeviceSources();
    return result.devices;
  }

  async learnedDeviceSources(): Promise<{
    devices: FortinetLearnedDevice[];
    diagnostics: FortinetLearnedDeviceDiagnostic[];
  }> {
    const configuredPath = process.env.FORTINET_INTERFACE_MAC_PATH;
    const pathEntries = configuredPath
      ? [{ path: configuredPath, note: "Configured override" }]
      : defaultLearnedDevicePaths();
    const devicesByKey = new Map<string, FortinetLearnedDevice>();
    const diagnostics: FortinetLearnedDeviceDiagnostic[] = [];

    const addDevices = (devices: FortinetLearnedDevice[]) => {
      for (const device of devices) {
        const key = `${device.macAddress.toUpperCase()}|${device.interfaceName}|${device.ipAddress}`;
        const existing = devicesByKey.get(key);
        devicesByKey.set(key, existing ? mergeLearnedDevice(existing, device) : device);
      }
    };

    for (const { path, note } of pathEntries) {
      try {
        const result = await this.request<Array<Record<string, unknown>> | Record<string, Record<string, unknown>>>(path);
        const devices = collectDevicesFromPayload(result);
        diagnostics.push({ path, records: devices.length, devices: devices.length, note });

        addDevices(devices);
      } catch (caught) {
        diagnostics.push({
          path,
          records: 0,
          devices: 0,
          note,
          error: caught instanceof Error ? caught.message : "Fortinet request failed."
        });
      }
    }

    let switchPortRefs: SwitchPortRef[] = [];
    if (!configuredPath && switchControllerEnabled()) {
      const managedSwitchResult = await this.collectManagedSwitchPortDevices();
      diagnostics.push(...managedSwitchResult.diagnostics);
      switchPortRefs = managedSwitchResult.portRefs;
      addDevices(managedSwitchResult.devices);
    }

    if (configuredPath && diagnostics[0]?.error) {
      throw new Error(`Fortinet request failed for configured path: ${configuredPath}: ${diagnostics[0].error}`);
    }

    const devicesBeforeMap = Array.from(devicesByKey.values());
    const devices = enrichLearnedDevicesWithSwitchPorts(devicesBeforeMap, switchPortRefs);
    const mappedCount = countMappedSwitchPortDevices(devices);

    if (switchPortRefs.length > 0) {
      diagnostics.push({
        path: "switch-port-correlation",
        records: switchPortRefs.length,
        devices: mappedCount,
        note: `Mapped ${mappedCount} of ${devicesBeforeMap.length} ARP/DHCP device(s) to SwitchSerial/port`
      });
    }

    return { devices, diagnostics };
  }

  private async collectManagedSwitchPortDevices(): Promise<{
    devices: FortinetLearnedDevice[];
    portRefs: SwitchPortRef[];
    diagnostics: FortinetLearnedDeviceDiagnostic[];
  }> {
    const path = "/api/v2/cmdb/switch-controller/managed-switch";
    const devices: FortinetLearnedDevice[] = [];
    const portRefs: SwitchPortRef[] = [];
    const diagnostics: FortinetLearnedDeviceDiagnostic[] = [];
    let switchCount = 0;

    try {
      const inventoryPaths = [
        "/api/v2/cmdb/switch-controller/managed-switch",
        "/api/v2/monitor/switch-controller/managed-switch"
      ];

      let inventory: unknown = null;
      let inventoryError: string | undefined;
      for (const inventoryPath of inventoryPaths) {
        try {
          inventory = await this.request<unknown>(inventoryPath);
          break;
        } catch (caught) {
          inventoryError = caught instanceof Error ? caught.message : "Fortinet request failed.";
        }
      }

      if (!inventory) {
        throw new Error(inventoryError || "Unable to read managed FortiSwitch inventory.");
      }

      const cmdbRefs = parseManagedSwitchInventory(inventory);
      const liveRefs = await this.collectLiveSwitchPortRefs();
      const userDeviceResult = await this.collectUserDeviceSwitchPorts();
      portRefs.push(...mergeSwitchPortRefs(cmdbRefs, liveRefs, userDeviceResult.portRefs));
      devices.push(...userDeviceResult.devices);

      const switchNames = [...new Set(portRefs.map((ref) => ref.switchId))];
      switchCount = switchNames.length;

      if (switchNames.length === 0) {
        const fallbackNames = extractManagedSwitchNames(inventory);
        switchCount = fallbackNames.length;
        for (const switchName of fallbackNames) {
          await this.collectPortsForSwitch(switchName, devices, portRefs);
        }
      } else if (cmdbRefs.length === 0) {
        for (const switchName of switchNames) {
          await this.collectPortsForSwitch(switchName, devices, portRefs);
        }
      }

      const mergedPortRefs = mergeSwitchPortRefs(portRefs);
      switchCount = Math.max(switchCount, [...new Set(mergedPortRefs.map((ref) => ref.switchId))].length);

      const cmdbStats = formatSwitchInventoryDiagnostic(cmdbRefs, switchCount, "cmdb");
      diagnostics.push({
        path,
        records: cmdbStats.records,
        devices: cmdbStats.devices,
        note: cmdbStats.note
      });

      const liveStats = formatSwitchInventoryDiagnostic(liveRefs, switchCount, "live");
      diagnostics.push({
        path: "/api/v2/monitor/switch-controller/managed-switch?port_stats=true",
        records: liveStats.records,
        devices: liveStats.devices,
        note: liveStats.note,
        error: liveRefs.length === 0 ? "No live MAC/IP found in switch port telemetry." : undefined
      });

      const userDeviceStats = formatSwitchInventoryDiagnostic(userDeviceResult.portRefs, switchCount, "user-device");
      diagnostics.push({
        path: "/api/v2/monitor/user/device/query",
        records: userDeviceStats.records,
        devices: userDeviceStats.devices,
        note: userDeviceStats.note,
        error:
          userDeviceResult.portRefs.length === 0
            ? "No switch/port mappings returned. Enable switch-controller network-monitoring if needed."
            : undefined
      });

      return {
        devices,
        portRefs: mergedPortRefs,
        diagnostics
      };
    } catch (caught) {
      diagnostics.push({
        path,
        records: 0,
        devices: 0,
        note: "FortiSwitch port tables (per managed switch)",
        error: caught instanceof Error ? caught.message : "Fortinet request failed."
      });
      return {
        devices: [],
        portRefs: [],
        diagnostics
      };
    }
  }

  private async collectUserDeviceSwitchPorts() {
    const paths = ["/api/v2/monitor/user/device/query", "/api/v2/monitor/user/device"];
    for (const queryPath of paths) {
      try {
        const payload = await this.request<unknown>(queryPath);
        const parsed = parseUserDeviceSwitchPorts(payload);
        if (parsed.portRefs.length > 0) {
          return parsed;
        }
      } catch {
        continue;
      }
    }
    return { portRefs: [], devices: [] };
  }

  private async collectLiveSwitchPortRefs(): Promise<SwitchPortRef[]> {
    const monitorPaths = [
      "/api/v2/monitor/switch-controller/managed-switch?port_stats=true",
      "/api/v2/monitor/switch-controller/managed-switch/status",
      "/api/v2/monitor/switch-controller/managed-switch",
      "/api/v2/monitor/switch-controller/managed-switch/dhcp-snooping"
    ];

    const merged: SwitchPortRef[] = [];
    for (const monitorPath of monitorPaths) {
      try {
        const payload = await this.request<unknown>(monitorPath);
        merged.push(...parseSwitchPortLiveStats(payload));
      } catch {
        // Try the next monitor path.
      }
    }

    return mergeSwitchPortRefs(merged);
  }

  private async collectPortsForSwitch(
    switchName: string,
    devices: FortinetLearnedDevice[],
    portRefs: SwitchPortRef[]
  ) {
    try {
      const portsPayload = await this.request<unknown>(
        `/api/v2/cmdb/switch-controller/managed-switch/${encodeURIComponent(switchName)}/ports`
      );
      portRefs.push(...parseManagedSwitchInventory([{ name: switchName, ports: portsPayload }]));
      devices.push(...collectDevicesFromPayload(portsPayload, `${switchName}/`));
    } catch {
      const switchPayload = await this.request<unknown>(
        `/api/v2/cmdb/switch-controller/managed-switch/${encodeURIComponent(switchName)}`
      );
      portRefs.push(...parseManagedSwitchInventory(switchPayload));
      devices.push(...collectDevicesFromPayload(switchPayload, `${switchName}/`));
    }
  }

  async listPoePorts(): Promise<PoePortRow[]> {
    const managed = await this.collectManagedSwitchPortDevices();
    const learned = await this.learnedDeviceSources();
    const enriched = enrichLearnedDevicesWithSwitchPorts(learned.devices, managed.portRefs);

    const learnedByPortKey = new Map<string, { macAddress?: string; ipAddress?: string }>();
    for (const device of enriched) {
      if (!device.interfaceName.includes("/")) {
        continue;
      }
      learnedByPortKey.set(device.interfaceName, {
        macAddress: device.macAddress,
        ipAddress: device.ipAddress !== "unknown" ? device.ipAddress : undefined
      });
    }

    const rows: PoePortRow[] = [];
    const seen = new Set<string>();
    for (const ref of managed.portRefs) {
      const portKey = `${ref.switchId}/${ref.portName}`;
      if (seen.has(portKey)) {
        continue;
      }
      seen.add(portKey);
      const learnedInfo = learnedByPortKey.get(portKey);
      rows.push({
        switchId: ref.switchId,
        portName: ref.portName,
        portKey,
        macAddress: learnedInfo?.macAddress || ref.macAddress,
        ipAddress: learnedInfo?.ipAddress || ref.ipAddress,
        oui: undefined,
        ouiApproved: false
      });
    }

    return rows.sort((left, right) =>
      `${left.switchId}/${left.portName}`.localeCompare(`${right.switchId}/${right.portName}`, undefined, {
        numeric: true
      })
    );
  }

  async resetPoe(portName: string): Promise<PoeResetResult> {
    let target = parseFortinetPoeTarget(portName);
    target = await this.resolveManagedSwitchTarget(target);

    if (!target.switchId) {
      throw new Error(
        "PoE reset requires a managed FortiSwitch port in SwitchSerial/port8 format."
      );
    }

    let lastError: Error | null = null;

    for (const attempt of buildPrimaryPoeResetAttempts(target)) {
      try {
        const payload = await this.postMonitorAction(attempt.path, attempt.body);
        validatePoeResetResponse(payload);
        return {
          method: "FortiGate REST API",
          command: `${attempt.path} ${JSON.stringify(attempt.body)}`
        };
      } catch (caught) {
        lastError = caught instanceof Error ? caught : lastError;
      }
    }

    if (this.fmgClient && this.firewall.fmgDeviceName) {
      for (const command of buildFortinetPoeCliCommands(target)) {
        try {
          await this.fmgClient.resetPoeViaScript(
            this.firewall.fmgDeviceName,
            command,
            this.firewall.adom,
            this.firewall.vdom || "root"
          );
          return { method: "FortiManager CLI script (fallback)", command };
        } catch (scriptError) {
          lastError = scriptError instanceof Error ? scriptError : lastError;
        }
      }
    }

    if (lastError && isFortiManagerPermissionError(lastError)) {
      throw new Error(`${lastError.message} ${formatReadOnlyApiUserHelp()}`);
    }

    throw new Error(formatPoeResetFailure(target, lastError));
  }

  private async postMonitorAction(path: string, body: Record<string, unknown>) {
    if (this.fmgClient && this.firewall.fmgDeviceName) {
      const payload = await this.fmgClient.proxyFortiGateRequestOnce(
        this.firewall.fmgDeviceName,
        path,
        {
          method: "POST",
          body: JSON.stringify(body)
        },
        {
          vdom: this.firewall.vdom || "root",
          adom: this.firewall.adom
        }
      );
      return payload;
    }

    return this.apiFetch(path, {
      method: "POST",
      body: JSON.stringify(body)
    });
  }

  private async resolveManagedSwitchTarget(target: FortinetPoeTarget) {
    if (!target.switchId) {
      return target;
    }

    const inventoryPaths = [
      "/api/v2/cmdb/switch-controller/managed-switch",
      "/api/v2/monitor/switch-controller/managed-switch"
    ];

    for (const inventoryPath of inventoryPaths) {
      try {
        const inventory = await this.request<unknown>(inventoryPath);
        const resolved = findManagedSwitchPort(inventory, target.switchId, target.port);
        if (resolved) {
          return {
            ...target,
            switchId: resolved.switchId,
            port: resolved.port
          };
        }
      } catch {
        continue;
      }
    }

    return target;
  }

  private async readJsonPayload(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
    return this.apiFetch(path, init);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const payload = await this.apiFetch(path, init);
    if (payload.status && payload.status !== "success") {
      throw new Error(stringifyOptional(payload.message) || "Fortinet API returned a non-success status.");
    }
    if (path.includes("/monitor/")) {
      return resolveFortinetMonitorResults(payload) as T;
    }
    return (payload.results ?? payload) as T;
  }

  private async apiFetch(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
    if (this.fmgClient && this.firewall.fmgDeviceName) {
      try {
        return await this.fmgClient.proxyFortiGateRequest(
          this.firewall.fmgDeviceName,
          path,
          {
            method: init?.method,
            body: typeof init?.body === "string" ? init.body : undefined,
            headers: init?.headers
          },
          {
            vdom: this.firewall.vdom || "root",
            adom: this.firewall.adom
          }
        );
      } catch (error) {
        const isWrite =
          init?.method && ["POST", "PUT", "DELETE", "PATCH"].includes(init.method.toUpperCase());
        if (isWrite && isFortiManagerPermissionError(error) && this.token) {
          // Fall through to direct FortiGate API when FMGR blocks write proxy but a token exists.
        } else {
          throw error;
        }
      }
    }

    if (!this.token) {
      throw new Error("This firewall does not have an API token configured.");
    }

    const timeoutMs = Number(process.env.FORTINET_API_TIMEOUT_MS || 5000);
    const authModes = getFortinetAuthModesToTry();
    let lastResponse: Response | null = null;
    let lastBody = "";
    const modesTried: Array<Exclude<FortinetApiAuthMode, "auto">> = [];

    for (const authMode of authModes) {
      modesTried.push(authMode);
      const response = await fortinetFetch(
        buildFortinetRequestUrl(this.baseUrl, path, this.token, authMode),
        {
          ...init,
          headers: buildFortinetRequestHeaders(this.token, init?.headers, authMode),
          signal: AbortSignal.timeout(timeoutMs),
          cache: "no-store"
        },
        this.firewall.verifyTls
      );

      const rawBody = await response.text();
      if (response.status === 401 && authMode !== authModes[authModes.length - 1]) {
        lastResponse = response;
        lastBody = rawBody;
        continue;
      }

      if (!response.ok) {
        throw new Error(
          formatFortinetHttpError(response.status, response.statusText, rawBody, modesTried)
        );
      }

      if (!rawBody.trim()) {
        return {};
      }

      try {
        return JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        throw new Error("Fortinet API returned a non-JSON response.");
      }
    }

    if (lastResponse) {
      throw new Error(
        formatFortinetHttpError(lastResponse.status, lastResponse.statusText, lastBody, modesTried)
      );
    }

    throw new Error("Fortinet request failed.");
  }

  private async requestAny<T>(paths: string[]): Promise<T> {
    let lastError: Error | null = null;

    for (const path of paths) {
      try {
        return await this.request<T>(path);
      } catch (caught) {
        lastError = caught instanceof Error ? caught : new Error("Fortinet request failed.");
      }
    }

    throw lastError || new Error("Fortinet request failed.");
  }
}

/** When verifyTls is false, FortiGate lab units often use self-signed certs. */
async function fortinetFetch(url: string, init: RequestInit, verifyTls: boolean) {
  if (verifyTls) {
    return fetch(url, init);
  }

  const previousTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  try {
    return await fetch(url, init);
  } finally {
    if (previousTlsSetting === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsSetting;
    }
  }
}

function formatFortinetHttpError(
  status: number,
  statusText: string,
  rawBody: string,
  authModesTried: Array<Exclude<FortinetApiAuthMode, "auto">> = []
) {
  let detail = "";
  if (rawBody.trim()) {
    try {
      const payload = JSON.parse(rawBody) as Record<string, unknown>;
      detail =
        stringifyOptional(payload.message) ||
        stringifyOptional(payload.error) ||
        stringifyOptional(payload.status) ||
        rawBody.slice(0, 240);
    } catch {
      detail = rawBody.slice(0, 240);
    }
  }

  const base = detail
    ? `Fortinet request failed: ${status} ${statusText}: ${detail}`
    : `Fortinet request failed: ${status} ${statusText}`;

  if (status === 401 && authModesTried.length > 0) {
    return `${base}. ${formatFortinet401Help(authModesTried)}`;
  }

  return base;
}

function formatPoeResetFailure(target: FortinetPoeTarget, lastError: Error | null) {
  const hint = target.switchId
    ? `${target.switchId}/${target.port}`
    : "FortiSwitchSerial/port5 (use device finder rows that show the switch serial)";

  const detail = lastError?.message ? ` Last error: ${lastError.message}` : "";
  return (
    `PoE reset failed on all known FortiOS 7.2 paths. Use the switch serial and port from device finder, for example ${hint}.` +
    detail
  );
}

function stringifyOptional(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
}

function normalizeInterfaceStatus(item: Record<string, unknown>) {
  const value = stringifyOptional(item.status || item.link || item.link_status || item.state || item.oper_status);
  if (!value) {
    return undefined;
  }

  const normalized = value.toLowerCase();
  if (["1", "true", "up", "online", "connected"].includes(normalized)) {
    return "up";
  }
  if (["0", "false", "down", "offline", "disconnected"].includes(normalized)) {
    return "down";
  }
  return value;
}

function collectDevicesFromPayload(payload: unknown, interfacePrefix = ""): FortinetLearnedDevice[] {
  const entries = flattenRecords(payload);
  const parsed = parseLearnedEntries(entries, interfacePrefix);
  const harvested = harvestMacAddresses(payload, interfacePrefix);
  const devicesByKey = new Map<string, FortinetLearnedDevice>();

  for (const device of [...parsed, ...harvested]) {
    const key = `${device.macAddress}|${device.interfaceName}|${device.ipAddress}`;
    const existing = devicesByKey.get(key);
    devicesByKey.set(key, existing ? mergeLearnedDevice(existing, device) : device);
  }

  return Array.from(devicesByKey.values());
}

function parseLearnedEntries(
  entries: Array<Record<string, unknown>>,
  interfacePrefix = ""
): FortinetLearnedDevice[] {
  return entries.flatMap((entry) => {
    const macAddress = extractMacFromRecord(entry);
    if (!macAddress) {
      return [];
    }

    const deviceName = extractDeviceName(entry);
    return [
      {
        interfaceName: extractInterfaceName(entry, interfacePrefix, deviceName),
        ipAddress: String(
          entry.ip ||
            entry.ip_address ||
            entry.ipaddr ||
            entry.address ||
            entry.ipv4_address ||
            entry["ip-address"] ||
            entry.client_ip ||
            "unknown"
        ),
        macAddress,
        deviceName
      }
    ];
  });
}

const HOSTNAME_FIELD_KEYS = [
  "hostname",
  "host_name",
  "host-name",
  "client_hostname",
  "client-hostname",
  "device_name",
  "device-name",
  "computer_name",
  "computer-name",
  "fqdn",
  "dns_name",
  "dns-name",
  "lease_hostname",
  "lease-hostname"
] as const;

function mergeLearnedDevice(existing: FortinetLearnedDevice, incoming: FortinetLearnedDevice): FortinetLearnedDevice {
  return {
    ...existing,
    deviceName: existing.deviceName || incoming.deviceName,
    interfaceName: existing.interfaceName !== "unknown" ? existing.interfaceName : incoming.interfaceName
  };
}

function extractDeviceName(entry: Record<string, unknown>) {
  for (const key of HOSTNAME_FIELD_KEYS) {
    const value = stringifyOptional(entry[key]);
    if (value) {
      return value;
    }
  }

  const hasInterfaceField = Boolean(
    entry.interface ||
      entry.intf ||
      entry.port ||
      entry.port_name ||
      entry["port-name"] ||
      entry.ifname ||
      entry.dev ||
      entry.interface_name ||
      entry["interface-name"]
  );
  const name = stringifyOptional(entry.name);
  if (hasInterfaceField && name) {
    return name;
  }

  return undefined;
}

function extractInterfaceName(entry: Record<string, unknown>, interfacePrefix: string, deviceName?: string) {
  const iface = stringifyOptional(
    entry.interface ||
      entry.intf ||
      entry.port ||
      entry.port_name ||
      entry["port-name"] ||
      entry.ifname ||
      entry.dev ||
      entry.interface_name ||
      entry["interface-name"]
  );
  if (iface) {
    return `${interfacePrefix}${iface}`;
  }

  const name = stringifyOptional(entry.name);
  if (name && !deviceName) {
    return `${interfacePrefix}${name}`;
  }

  return `${interfacePrefix}unknown`;
}

function extractMacFromRecord(entry: Record<string, unknown>) {
  for (const key of [
    "mac",
    "mac_address",
    "macaddr",
    "hwaddr",
    "hardware_address",
    "chaddr",
    "client_mac",
    "mac-address",
    "macaddr_cur",
    "lladdr",
    "learned_mac",
    "neighbor_mac"
  ]) {
    const normalized = normalizeMacAddress(entry[key]);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function harvestMacAddresses(payload: unknown, interfacePrefix = ""): FortinetLearnedDevice[] {
  const devices: FortinetLearnedDevice[] = [];

  function visit(candidate: unknown, context: Record<string, string | undefined>) {
    if (!candidate || typeof candidate !== "object") {
      if (typeof candidate === "string") {
        const macAddress = normalizeMacAddress(candidate);
        if (macAddress) {
          devices.push({
            interfaceName: `${interfacePrefix}${context.interface || context.port || context.ifaceName || "unknown"}`,
            ipAddress: context.ip || "unknown",
            macAddress,
            deviceName: context.hostname || undefined
          });
        }
      }
      return;
    }

    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        visit(item, context);
      }
      return;
    }

    const record = candidate as Record<string, unknown>;
    const nextContext = {
      interface: context.interface || stringifyOptional(record.interface || record.intf || record.ifname),
      port: context.port || stringifyOptional(record.port || record["port-name"] || record.port_name),
      ifaceName:
        context.ifaceName ||
        stringifyOptional(
          record.interface || record.intf || record.ifname || record.interface_name || record["interface-name"]
        ),
      hostname: context.hostname || extractDeviceName(record),
      ip:
        context.ip ||
        stringifyOptional(record.ip || record.ip_address || record.ipaddr || record.address || record.client_ip)
    };

    for (const value of Object.values(record)) {
      visit(value, nextContext);
    }
  }

  visit(payload, {});
  return devices;
}

function extractManagedSwitchNames(payload: unknown) {
  const fromInventory = parseManagedSwitchInventory(payload).map((ref) => ref.switchId);
  if (fromInventory.length > 0) {
    return [...new Set(fromInventory)];
  }

  if (Array.isArray(payload)) {
    return payload
      .map((entry) =>
        entry && typeof entry === "object" ? extractManagedSwitchId(entry as Record<string, unknown>) : undefined
      )
      .filter((name): name is string => Boolean(name));
  }

  if (payload && typeof payload === "object") {
    return Object.keys(payload as Record<string, unknown>);
  }

  return [];
}

function normalizeMacAddress(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  const hex = raw.replace(/[^a-fA-F0-9]/g, "");
  if (hex.length !== 12) {
    return null;
  }

  return `${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4, 6)}:${hex.slice(6, 8)}:${hex.slice(8, 10)}:${hex.slice(10, 12)}`.toUpperCase();
}

function flattenRecords(value: unknown): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];

  function visit(candidate: unknown) {
    if (!candidate || typeof candidate !== "object") {
      return;
    }

    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        visit(item);
      }
      return;
    }

    const record = candidate as Record<string, unknown>;
    const hasDeviceFields = [
      "mac",
      "mac_address",
      "macaddr",
      "hwaddr",
      "hardware_address",
      "chaddr",
      "client_mac",
      "mac-address",
      "macaddr_cur",
      "lladdr",
      "learned_mac",
      "neighbor_mac",
      "ip",
      "ip_address",
      "ipaddr",
      "address",
      "client_ip",
      ...HOSTNAME_FIELD_KEYS
    ].some((key) => record[key]);

    if (hasDeviceFields) {
      records.push(record);
    }

    for (const child of Object.values(record)) {
      visit(child);
    }
  }

  visit(value);
  return records;
}

function flattenRouteRecords(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object");
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.routes)) {
    return record.routes.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object");
  }

  return Object.values(record).flatMap((value) => flattenRouteRecords(value));
}

function parseFortinetPingPayload(raw: Record<string, unknown>): Omit<FortinetPingResult, "host" | "source" | "raw"> {
  const reachable =
    toBoolean(raw.reachable) ??
    toBoolean(raw.success) ??
    (typeof raw.packet_loss === "number" ? raw.packet_loss < 100 : undefined) ??
    (typeof raw.loss === "number" ? raw.loss < 100 : undefined) ??
    (typeof raw.received === "number" && raw.received > 0) ??
    (typeof raw.packets_received === "number" && raw.packets_received > 0);

  const avgRttMs =
    toNumber(raw.avg_rtt) ??
    toNumber(raw.avg_rtt_ms) ??
    toNumber(raw.rtt_avg) ??
    toNumber(raw.latency) ??
    toNumber(raw.time);

  return {
    reachable: reachable ?? Boolean(avgRttMs !== undefined),
    packetsSent: toNumber(raw.sent) ?? toNumber(raw.packets_sent),
    packetsReceived: toNumber(raw.received) ?? toNumber(raw.packets_received),
    packetLossPercent: toNumber(raw.packet_loss) ?? toNumber(raw.loss),
    minRttMs: toNumber(raw.min_rtt) ?? toNumber(raw.min_rtt_ms),
    maxRttMs: toNumber(raw.max_rtt) ?? toNumber(raw.max_rtt_ms),
    avgRttMs: avgRttMs ?? undefined
  };
}

function parseFortinetCableTestPayload(interfaceName: string, raw: Record<string, unknown>): FortinetCableTestResult {
  const pairs = collectCablePairs(raw);
  const statusText = stringifyOptional(raw.status || raw.result || raw.state || raw.cable_status)?.toLowerCase();
  const status: FortinetCableTestResult["status"] =
    statusText?.includes("fail") || statusText?.includes("open")
      ? "fail"
      : statusText?.includes("pass") || statusText?.includes("ok") || statusText?.includes("good")
        ? "pass"
        : pairs.length > 0
          ? pairs.every((pair) => pair.status.toLowerCase().includes("ok") || pair.status.toLowerCase().includes("pass"))
            ? "pass"
            : "unknown"
          : "unknown";

  return {
    interfaceName,
    supported: true,
    status,
    summary: stringifyOptional(raw.message || raw.summary || raw.status),
    pairs,
    raw
  };
}

function collectCablePairs(raw: Record<string, unknown>) {
  const pairs: Array<{ pair: string; status: string; lengthMeters?: number }> = [];
  const candidates = Array.isArray(raw.pairs)
    ? raw.pairs
    : Array.isArray(raw.results)
      ? raw.results
      : [];

  for (const entry of candidates) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const pair = stringifyOptional(record.pair || record.name || record.wire);
    const status = stringifyOptional(record.status || record.result || record.state);
    if (!pair || !status) {
      continue;
    }
    pairs.push({
      pair,
      status,
      lengthMeters: toNumber(record.length) ?? toNumber(record.length_m) ?? toNumber(record.length_meters)
    });
  }

  return pairs;
}

function toBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "up", "success", "ok"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "down", "fail", "error"].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return undefined;
}
