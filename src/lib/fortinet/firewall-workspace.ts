import "server-only";

import { type FortinetCableTestResult, type FortinetPingResult } from "@/lib/fortinet/client";
import { createFortinetClient } from "@/lib/fortinet/create-client";
import { isFirewallApiReady } from "@/lib/fortinet/connectivity";
import { findInterfaceByName, formatLinkSpeed } from "@/lib/fortinet/interface-utils";
import { getFirewallOverview, type FirewallRecord } from "@/lib/fortinet/overview";
import { getIspGatewayInterfaceName, getWanLinkDefinitions, type WanLinkDefinition } from "@/lib/fortinet/wan-links";
import { pingHost } from "@/lib/ping";
import { isPingableIpv4 } from "@/lib/ping-utils";

export type WanLinkStatus = {
  definition: WanLinkDefinition;
  status: "up" | "down" | "unknown";
  speedDuplex: string;
  ip?: string;
  mac?: string;
  error?: string;
};

export type IspGatewayStatus = {
  interfaceName: string;
  gateway?: string;
  ping?: FortinetPingResult;
  serverPing?: {
    reachable: boolean;
    latencyMs: number | null;
    error?: string;
  };
  error?: string;
};

export type FirewallWorkspaceSnapshot = {
  overview: Awaited<ReturnType<typeof getFirewallOverview>>;
  wanLinks: WanLinkStatus[];
  ispGateway: IspGatewayStatus;
  cableTestInterfaces: string[];
  error?: string;
};

export async function getFirewallWorkspaceSnapshot(firewall: FirewallRecord): Promise<FirewallWorkspaceSnapshot> {
  const overview = await getFirewallOverview(firewall);
  const wanDefinitions = getWanLinkDefinitions();
  const ispInterfaceName = getIspGatewayInterfaceName();

  if (!isFirewallApiReady(firewall)) {
    return {
      overview,
      wanLinks: wanDefinitions.map((definition) => ({
        definition,
        status: "unknown",
        speedDuplex: "—",
        error: "No API token configured."
      })),
      ispGateway: {
        interfaceName: ispInterfaceName,
        error: "No API token configured."
      },
      cableTestInterfaces: wanDefinitions.map((item) => item.interfaceName),
      error: overview.error
    };
  }

  try {
    const client = createFortinetClient(firewall);
    const [interfaces, gateway] = await Promise.all([
      client.interfaces(),
      client.defaultGatewayForInterface(ispInterfaceName)
    ]);

    const wanLinks = wanDefinitions.map((definition) => {
      const iface = findInterfaceByName(interfaces, definition.interfaceName);
      if (!iface) {
        return {
          definition,
          status: "unknown" as const,
          speedDuplex: "Not found",
          error: "Interface not reported by FortiGate."
        };
      }

      return {
        definition,
        status: iface.status === "up" ? ("up" as const) : iface.status === "down" ? ("down" as const) : ("unknown" as const),
        speedDuplex: formatLinkSpeed(iface),
        ip: iface.ip,
        mac: iface.mac
      };
    });

    const ispGateway: IspGatewayStatus = {
      interfaceName: ispInterfaceName,
      gateway
    };

    if (gateway && isPingableIpv4(gateway)) {
      const fortigatePing = await client.pingHost(gateway, { count: 4, interfaceName: ispInterfaceName });
      ispGateway.ping = fortigatePing;

      if (!fortigatePing.reachable) {
        const serverPing = await pingHost(gateway);
        ispGateway.serverPing = {
          reachable: serverPing.reachable,
          latencyMs: serverPing.latencyMs,
          error: serverPing.error
        };
      }
    } else if (gateway) {
      ispGateway.error = "Gateway address is not a pingable IPv4 address.";
    } else {
      ispGateway.error = "No default gateway found on the broadband interface.";
    }

    const cableTestInterfaces = [
      ...new Set([
        ...wanDefinitions.map((item) => item.interfaceName),
        ...interfaces
          .map((item) => item.name)
          .filter((name) => /^(port|lan|wan|internal|npu)/i.test(name))
          .slice(0, 12)
      ])
    ];

    return {
      overview,
      wanLinks,
      ispGateway,
      cableTestInterfaces
    };
  } catch (caught) {
    return {
      overview,
      wanLinks: wanDefinitions.map((definition) => ({
        definition,
        status: "unknown",
        speedDuplex: "—",
        error: caught instanceof Error ? caught.message : "Unable to query Fortinet device."
      })),
      ispGateway: {
        interfaceName: ispInterfaceName,
        error: caught instanceof Error ? caught.message : "Unable to query Fortinet device."
      },
      cableTestInterfaces: wanDefinitions.map((item) => item.interfaceName),
      error: caught instanceof Error ? caught.message : "Unable to query Fortinet device."
    };
  }
}

export async function runFirewallCableTest(
  firewall: FirewallRecord,
  interfaceName: string
): Promise<FortinetCableTestResult> {
  const client = createFortinetClient(firewall);
  return client.cableTest(interfaceName);
}

export async function runFirewallPing(
  firewall: FirewallRecord,
  host: string,
  options?: { interfaceName?: string; count?: number; allowServerFallback?: boolean }
): Promise<FortinetPingResult> {
  const client = createFortinetClient(firewall);
  const fortigateResult = await client.pingHost(host, {
    count: options?.count ?? 4,
    interfaceName: options?.interfaceName
  });

  if (
    fortigateResult.reachable ||
    fortigateResult.avgRttMs !== undefined ||
    fortigateResult.minRttMs !== undefined ||
    (fortigateResult.packetsReceived ?? 0) > 0
  ) {
    return fortigateResult;
  }

  if ((fortigateResult.packetsSent ?? 0) > 0 || fortigateResult.raw) {
    return {
      ...fortigateResult,
      error: fortigateResult.error || "Host unreachable from FortiGate."
    };
  }

  if (!isPingableIpv4(host)) {
    return {
      ...fortigateResult,
      error: fortigateResult.error || "Enter a pingable IPv4 address."
    };
  }

  if (options?.allowServerFallback === false) {
    return {
      ...fortigateResult,
      error: fortigateResult.error || "FortiGate ping is unavailable for this host."
    };
  }

  const serverPing = await pingHost(host);
  return {
    host,
    reachable: serverPing.reachable,
    avgRttMs: serverPing.latencyMs ?? undefined,
    source: "server",
    error: serverPing.reachable ? undefined : serverPing.error || fortigateResult.error,
    raw: fortigateResult.raw
  };
}
