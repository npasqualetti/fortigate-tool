const CPU_KEYS = ["cpu", "cpuusage", "cpuusagepercent", "cpuused", "cpuusagepct"];
const MEMORY_KEYS = ["mem", "memory", "memusage", "memoryusage", "memused", "memoryused"];

export function extractResourceUsagePercent(
  source: unknown,
  metric: "cpu" | "memory"
): string | undefined {
  const keys = metric === "cpu" ? CPU_KEYS : MEMORY_KEYS;
  const value = findDeepValue(source, keys);
  const parsed = parseUsageCurrent(value);
  if (typeof parsed === "number") {
    return formatUsagePercent(parsed);
  }
  return undefined;
}

export function formatUsagePercent(value: number) {
  const percent = value <= 1 ? Math.round(value * 100) : Math.round(value);
  return `${percent}%`;
}

function parseUsageCurrent(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
    return Number(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parseUsageCurrent(item);
      if (typeof parsed === "number") {
        return parsed;
      }
    }
    return undefined;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("current" in record) {
      return parseUsageCurrent(record.current);
    }
    if ("usage" in record) {
      return parseUsageCurrent(record.usage);
    }
    if ("value" in record) {
      return parseUsageCurrent(record.value);
    }
  }

  return undefined;
}

function findDeepValue(source: unknown, normalizedKeys: string[]): unknown {
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

  return visit(source);
}

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}
