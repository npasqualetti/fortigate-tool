import { resolveFortinetMonitorResults } from "@/lib/fortinet/monitor-payload";

export type ParsedFortinetPing = {
  reachable: boolean;
  packetsSent?: number;
  packetsReceived?: number;
  packetLossPercent?: number;
  minRttMs?: number;
  maxRttMs?: number;
  avgRttMs?: number;
};

export function normalizeFortinetPingRaw(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.results) && record.results.length === 0) {
    return {};
  }

  let candidate: unknown = record.results ?? record;

  if (Array.isArray(candidate)) {
    candidate =
      candidate.find((entry) => entry && typeof entry === "object" && Object.keys(entry as object).length > 0) ??
      candidate[0] ??
      {};
  }

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return flattenFortinetKeys(record);
  }

  const objectCandidate = candidate as Record<string, unknown>;
  if (objectCandidate.results && typeof objectCandidate.results === "object") {
    return normalizeFortinetPingRaw(objectCandidate);
  }

  return flattenFortinetKeys({
    ...record,
    ...objectCandidate
  });
}

export function parseFortinetPingPayload(raw: Record<string, unknown>): ParsedFortinetPing {
  const packetsSent =
    toNumber(raw.sent) ??
    toNumber(raw.packets_sent) ??
    toNumber(raw.packet_transmit) ??
    toNumber(raw.packets_transmitted);
  const packetsReceived =
    toNumber(raw.received) ??
    toNumber(raw.packets_received) ??
    toNumber(raw.packet_receive) ??
    toNumber(raw.packets_received);
  const packetLossPercent =
    toNumber(raw.packet_loss) ??
    toNumber(raw.loss) ??
    toNumber(raw.packet_loss_rate) ??
    (packetsSent && packetsReceived !== undefined ? ((packetsSent - packetsReceived) / packetsSent) * 100 : undefined);

  const minRttMs =
    toNumber(raw.min_rtt) ??
    toNumber(raw.min_rtt_ms) ??
    toNumber(raw.rtt_min) ??
    toNumber(raw.rtt_min_ms);
  const maxRttMs =
    toNumber(raw.max_rtt) ??
    toNumber(raw.max_rtt_ms) ??
    toNumber(raw.rtt_max) ??
    toNumber(raw.rtt_max_ms);
  const avgRttMs =
    toNumber(raw.avg_rtt) ??
    toNumber(raw.avg_rtt_ms) ??
    toNumber(raw.rtt_avg) ??
    toNumber(raw.rtt_avg_ms) ??
    toNumber(raw.latency) ??
    toNumber(raw.time) ??
    minRttMs;

  const status = stringifyOptional(raw.status)?.toLowerCase();
  const reachableFromStatus = status ? ["success", "ok", "up", "alive", "reachable"].includes(status) : undefined;
  const reachableFromLoss =
    packetLossPercent !== undefined ? packetLossPercent < 100 : packetsSent !== undefined && packetsReceived !== undefined
      ? packetsReceived > 0
      : undefined;

  let reachable =
    reachableFromStatus ??
    toBoolean(raw.reachable) ??
    toBoolean(raw.success) ??
    reachableFromLoss ??
    (packetsReceived !== undefined ? packetsReceived > 0 : undefined) ??
    (avgRttMs !== undefined ? avgRttMs >= 0 : undefined);

  if (reachable === undefined) {
    reachable = false;
  }

  if (packetsSent !== undefined && packetsReceived === 0) {
    reachable = false;
  }

  return {
    reachable,
    packetsSent,
    packetsReceived,
    packetLossPercent,
    minRttMs: minRttMs ?? undefined,
    maxRttMs: maxRttMs ?? undefined,
    avgRttMs: avgRttMs ?? undefined
  };
}

export function isConclusiveFortinetPingResult(parsed: ParsedFortinetPing, raw: Record<string, unknown>) {
  if (parsed.reachable) {
    return true;
  }
  if (parsed.avgRttMs !== undefined || parsed.minRttMs !== undefined) {
    return true;
  }
  if ((parsed.packetsReceived ?? 0) > 0) {
    return true;
  }
  if ((parsed.packetsSent ?? 0) > 0 && parsed.packetsReceived === 0) {
    return true;
  }
  if (parsed.packetLossPercent !== undefined && parsed.packetLossPercent >= 100) {
    return true;
  }

  const meaningfulKeys = [
    "host",
    "destination",
    "addr",
    "ping",
    "avg_rtt",
    "rtt_avg",
    "min_rtt",
    "rtt_min",
    "packet_receive",
    "packets_received",
    "received",
    "packet_loss",
    "loss",
    "packets_sent",
    "packet_transmit",
    "sent"
  ];
  return meaningfulKeys.some((key) => raw[key] !== undefined && raw[key] !== null && raw[key] !== "");
}

export function parseFortinetPingResponse(payload: Record<string, unknown>) {
  const cliResult = parseFortinetConfigScriptPingResponse(payload);
  if (cliResult.conclusive) {
    return {
      raw: cliResult.raw,
      parsed: cliResult.parsed,
      payload
    };
  }

  const normalizedMonitor = resolveFortinetMonitorResults(payload);
  const raw = normalizeFortinetPingRaw(
    Array.isArray(normalizedMonitor) ? { results: normalizedMonitor } : normalizedMonitor
  );
  const parsed = parseFortinetPingPayload(raw);
  return { raw, parsed, payload };
}

export function extractConfigScriptConsole(payload: Record<string, unknown>) {
  const lines: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string" && value.trim()) {
      lines.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry);
      }
    }
  };

  visit(payload.console);
  const results = payload.results;
  if (results && typeof results === "object" && !Array.isArray(results)) {
    visit((results as Record<string, unknown>).console);
  }

  return lines;
}

export function parseFortinetCliPingOutput(lines: string[]) {
  const text = lines.join("\n");
  const timeMatch = text.match(/time[=<](\d+(?:\.\d+)?)\s*ms/i);
  const receivedMatch = text.match(/(\d+)\s+packets?\s+received/i);
  const transmittedMatch = text.match(/(\d+)\s+packets?\s+transmitted/i);
  const lossMatch = text.match(/(\d+(?:\.\d+)?)\s*%?\s*packet loss/i);
  const rttAvgMatch = text.match(/round-trip min\/avg\/max\s*=\s*[\d.]+\/([\d.]+)\/[\d.]+/i);

  const packetsReceived = receivedMatch ? Number(receivedMatch[1]) : undefined;
  const packetsSent = transmittedMatch ? Number(transmittedMatch[1]) : undefined;
  const packetLossPercent = lossMatch ? Number(lossMatch[1]) : undefined;
  const avgRttMs =
    (rttAvgMatch ? Number(rttAvgMatch[1]) : undefined) ??
    (timeMatch ? Number(timeMatch[1]) : undefined);
  const roundedAvgRttMs = avgRttMs !== undefined ? Math.round(avgRttMs * 10) / 10 : undefined;

  const reachable =
    (packetsReceived ?? 0) > 0 ||
    avgRttMs !== undefined ||
    /bytes from/i.test(text) ||
    /ttl=\d+/i.test(text);

  const conclusive =
    reachable ||
    (packetsSent !== undefined && packetsReceived === 0) ||
    packetLossPercent !== undefined ||
    /100% packet loss/i.test(text) ||
    /Request timeout/i.test(text);

  return {
    conclusive,
    parsed: {
      reachable,
      packetsSent,
      packetsReceived,
      packetLossPercent,
      avgRttMs: roundedAvgRttMs,
      minRttMs: roundedAvgRttMs,
      maxRttMs: roundedAvgRttMs
    } satisfies ParsedFortinetPing,
    raw: { console: lines }
  };
}

export function parseFortinetConfigScriptPingResponse(payload: Record<string, unknown>) {
  const lines = extractConfigScriptConsole(payload);
  if (!lines.length) {
    return {
      conclusive: false,
      parsed: { reachable: false } satisfies ParsedFortinetPing,
      raw: {} as Record<string, unknown>
    };
  }
  return parseFortinetCliPingOutput(lines);
}

function flattenFortinetKeys(record: Record<string, unknown>) {
  const flattened: Record<string, unknown> = { ...record };
  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = key.replace(/-/g, "_");
    if (normalizedKey !== key && flattened[normalizedKey] === undefined) {
      flattened[normalizedKey] = value;
    }
  }
  return flattened;
}

function stringifyOptional(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
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
    if (["true", "1", "yes", "up", "success", "ok", "alive", "reachable"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "down", "fail", "error", "unreachable", "timeout"].includes(normalized)) {
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
