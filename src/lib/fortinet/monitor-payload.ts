/** Normalize FortiOS /api/v2/monitor/* JSON for callers. */
export function resolveFortinetMonitorResults(payload: Record<string, unknown>) {
  const results = payload.results;
  if (Array.isArray(results)) {
    return results;
  }
  return mergeMonitorObjectResults(payload);
}

function mergeMonitorObjectResults(payload: Record<string, unknown>) {
  const merged: Record<string, unknown> = {};
  const results = payload.results;

  if (results && typeof results === "object" && !Array.isArray(results)) {
    Object.assign(merged, results as Record<string, unknown>);
  }

  for (const [key, value] of Object.entries(payload)) {
    if (["results", "status", "http_method", "vdom", "path", "name", "mkey"].includes(key)) {
      continue;
    }
    if (merged[key] === undefined) {
      merged[key] = value;
    }
  }

  return merged;
}
