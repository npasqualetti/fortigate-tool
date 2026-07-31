export type FortinetPoeTarget = {
  /** FortiSwitch device ID / serial as shown in switch-controller. */
  switchId?: string;
  /** Port name on the managed switch, e.g. port5. */
  port: string;
  /** Raw value from the form. */
  input: string;
};

export function parseFortinetPoeTarget(portName: string): FortinetPoeTarget {
  const input = portName.trim();
  if (!input) {
    return { port: "", input };
  }

  const slash = input.indexOf("/");
  if (slash > 0) {
    return {
      switchId: input.slice(0, slash).trim(),
      port: input.slice(slash + 1).trim(),
      input
    };
  }

  const colon = input.indexOf(":");
  if (colon > 0) {
    return {
      switchId: input.slice(0, colon).trim(),
      port: input.slice(colon + 1).trim(),
      input
    };
  }

  return { port: input, input };
}

export function buildFortinetPoeResetAttempts(
  path: string,
  target: FortinetPoeTarget
): Array<{ path: string; body: Record<string, unknown> }> {
  const { switchId, port, input } = target;
  const attempts: Array<{ path: string; body: Record<string, unknown> }> = [];

  if (switchId) {
    attempts.push(
      { path, body: { switch: switchId, port } },
      { path, body: { fortiswitch_id: switchId, port } },
      { path, body: { serial: switchId, port } },
      { path, body: { switch_id: switchId, port } },
      { path, body: { device: switchId, port } },
      { path, body: { action: "poe-reset", switch: switchId, port } },
      { path, body: { action: "poe", subaction: "reset", switch: switchId, port } }
    );
  }

  if (switchId && path.includes("/switch-controller/switch-action")) {
    attempts.unshift(
      { path, body: { action: "poe", subaction: "reset", switch: switchId, port } },
      { path, body: { action: "poe-reset", switch: switchId, port } }
    );
  }

  attempts.push(
    { path, body: { port: input } },
    { path, body: { port } },
    { path, body: { interface: input } },
    { path, body: { interface: port } }
  );

  const seen = new Set<string>();
  return attempts.filter((attempt) => {
    const key = `${attempt.path}|${JSON.stringify(attempt.body)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export const DEFAULT_FORTINET_POE_RESET_PATHS = [
  "/api/v2/monitor/switch-controller/managed-switch/poe-reset",
  "/api/v2/monitor/system/fsw/poe-reset"
] as const;

/** Minimal REST attempts for FortiOS 7.x switch-controller PoE reset. */
export function buildPrimaryPoeResetAttempts(target: FortinetPoeTarget) {
  if (!target.switchId) {
    return [];
  }

  const bodies = [
    { mkey: target.switchId, port: target.port },
    { switch: target.switchId, port: target.port },
    { fortiswitch_id: target.switchId, port: target.port }
  ];

  const seen = new Set<string>();
  const attempts: Array<{ path: string; body: Record<string, unknown> }> = [];
  for (const path of DEFAULT_FORTINET_POE_RESET_PATHS) {
    for (const body of bodies) {
      const key = `${path}|${JSON.stringify(body)}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      attempts.push({ path, body });
    }
  }
  return attempts;
}

export function buildFortinetPoeCliCommands(target: FortinetPoeTarget) {
  if (!target.switchId) {
    return [`execute switch-controller switch-action poe reset ${target.port}`];
  }
  return [
    `execute switch-controller switch-action poe reset ${target.switchId} ${target.port}`,
    `execute switch-controller poe-reset ${target.switchId} ${target.port}`
  ];
}

export function buildFortinetPoeCliCommand(target: FortinetPoeTarget) {
  return buildFortinetPoeCliCommands(target)[0];
}

export function validatePoeResetResponse(payload: unknown) {
  if (payload === null || payload === undefined) {
    throw new Error("PoE reset returned no response from the FortiGate.");
  }

  if (typeof payload !== "object") {
    return;
  }

  const record = payload as Record<string, unknown>;
  const status = stringifyPoeField(record.status)?.toLowerCase();
  if (status && !["success", "ok"].includes(status)) {
    throw new Error(stringifyPoeField(record.message) || `PoE reset failed with status ${status}.`);
  }

  const message = stringifyPoeField(record.message)?.toLowerCase();
  if (message && /invalid|error|fail|not found|unknown|denied/.test(message)) {
    throw new Error(stringifyPoeField(record.message) || "PoE reset was rejected by the FortiGate.");
  }

  if (status === "success" || status === "ok") {
    return;
  }

  if (Object.keys(record).length === 0) {
    throw new Error("PoE reset returned an empty response; the FortiGate did not confirm the reset.");
  }
}

export function assertFortiManagerScriptSucceeded(result: unknown, command: string) {
  const serialized = JSON.stringify(result ?? "").toLowerCase();
  const failurePatterns = [
    "command fail",
    "entry not found",
    "invalid switch",
    "invalid port",
    "object not found",
    "no object",
    "permission denied",
    "not found",
    "unknown action",
    "syntax error"
  ];

  if (failurePatterns.some((pattern) => serialized.includes(pattern))) {
    throw new Error(`FortiGate rejected PoE reset command "${command}".`);
  }

  if (!serialized || serialized === "{}" || serialized === "[]" || serialized === "null") {
    throw new Error(
      `FortiManager did not return FortiGate output for PoE reset command "${command}". The script may not have reached the device.`
    );
  }
}

function stringifyPoeField(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
}

export function isFortinetNotFoundError(error: unknown) {
  return error instanceof Error && /\b404\b/.test(error.message);
}

export function isFortinetRetryablePoeError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    isFortinetNotFoundError(error) ||
    message.includes("invalid url") ||
    message.includes("url not found") ||
    message.includes("unknown monitor") ||
    message.includes("not supported")
  );
}
