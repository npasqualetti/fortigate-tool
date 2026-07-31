import type { FortinetInterface } from "@/lib/fortinet/client";

export function normalizeInterfaceName(name: string) {
  return name.trim().toLowerCase();
}

export function findInterfaceByName(interfaces: FortinetInterface[], name: string) {
  const target = normalizeInterfaceName(name);
  return (
    interfaces.find((item) => normalizeInterfaceName(item.name) === target) ||
    interfaces.find((item) => normalizeInterfaceName(item.alias || "") === target)
  );
}

export function formatLinkSpeed(item: Pick<FortinetInterface, "speed" | "duplex">) {
  const parts = [item.speed, item.duplex].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Unknown";
}

export function parseInterfaceLinkFields(item: Record<string, unknown>) {
  const speedRaw =
    item.speed ??
    item.speed_mbps ??
    item.link_speed ??
    item.linkspeed ??
    item.speed_tx ??
    item.speed_rx;
  const duplexRaw = item.duplex ?? item.link_duplex ?? item.negotiated_duplex;

  return {
    speed: formatSpeedValue(speedRaw),
    duplex: formatDuplexValue(duplexRaw)
  };
}

function formatSpeedValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 1000) {
      return `${value / 1000} Gbps`;
    }
    return `${value} Mbps`;
  }

  if (typeof value === "string" && value.trim()) {
    const normalized = value.trim();
    if (/^\d+$/.test(normalized)) {
      const numeric = Number(normalized);
      return numeric >= 1000 ? `${numeric / 1000} Gbps` : `${numeric} Mbps`;
    }
    return normalized;
  }

  return undefined;
}

function formatDuplexValue(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    const normalized = value.trim().toLowerCase();
    if (normalized === "full" || normalized === "half") {
      return `${normalized}-duplex`;
    }
    return value.trim();
  }

  if (typeof value === "number") {
    return value === 2 ? "full-duplex" : value === 1 ? "half-duplex" : undefined;
  }

  return undefined;
}

export function extractGatewayFromRoute(route: Record<string, unknown>) {
  const gateway = route.gateway || route.gw || route.nexthop || route.next_hop || route["next-hop"];
  if (typeof gateway === "string" && gateway.trim()) {
    return gateway.trim();
  }
  return undefined;
}

export function extractRouteInterface(route: Record<string, unknown>) {
  const iface = route.interface || route.ifname || route.dev || route.iface;
  if (typeof iface === "string" && iface.trim()) {
    return iface.trim();
  }
  return undefined;
}
