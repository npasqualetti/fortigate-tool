import { isFortigatePingInterface } from "@/lib/ping-utils";

export type FortinetPingAttemptBody = Record<string, unknown> | string[];

export type FortinetPingAttempt = {
  path: string;
  body: FortinetPingAttemptBody;
  kind: "cli" | "monitor";
};

export function buildFortinetPingAttempts(
  host: string,
  count: number,
  options?: { interfaceName?: string; vdom?: string }
) {
  const pingInterface =
    options?.interfaceName && isFortigatePingInterface(options.interfaceName)
      ? options.interfaceName.trim()
      : undefined;
  const vdom = options?.vdom?.trim() || "root";
  const countText = String(count);
  const cliPing = pingInterface
    ? `execute ping-options interface ${pingInterface}\nexecute ping ${host} ${countText}`
    : `execute ping ${host} ${countText}`;

  const attempts: FortinetPingAttempt[] = [
    {
      path: "/api/v2/monitor/system/config-script/execute",
      body: [cliPing],
      kind: "cli"
    },
    {
      path: "/api/v2/monitor/system/config-script/execute",
      body: { script: cliPing },
      kind: "cli"
    },
    { path: "/api/v2/monitor/system/ping", body: { host, count: countText, vdom }, kind: "monitor" },
    { path: "/api/v2/monitor/system/ping", body: { host, count }, kind: "monitor" },
    { path: "/api/v2/monitor/system/ping", body: { ping: host, count: countText, vdom }, kind: "monitor" },
    { path: "/api/v2/monitor/system/ping", body: { addr: host, count: countText, vdom }, kind: "monitor" },
    { path: "/api/v2/monitor/system/ping", body: { destination: host, count, vdom }, kind: "monitor" }
  ];

  if (pingInterface) {
    attempts.push(
      {
        path: "/api/v2/monitor/system/ping",
        body: { host, count: countText, interface: pingInterface, vdom },
        kind: "monitor"
      },
      {
        path: "/api/v2/monitor/system/ping",
        body: { ping: host, count: countText, interface: pingInterface, vdom },
        kind: "monitor"
      }
    );
  }

  return attempts;
}

export function isRetryableFortinetPingError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("invalid url") ||
    message.includes("url not found") ||
    message.includes("not found") ||
    message.includes("unknown monitor") ||
    message.includes("not supported") ||
    message.includes("no permission")
  );
}
