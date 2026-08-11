import "server-only";

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { isPingableIpv4 } from "@/lib/ping-utils";

const execFileAsync = promisify(execFile);

export { isPingableIpv4 };

export type PingHostResult = {
  ipAddress: string;
  reachable: boolean;
  latencyMs: number | null;
  error?: string;
};

export async function pingHost(ipAddress: string): Promise<PingHostResult> {
  const host = ipAddress.trim();
  if (!isPingableIpv4(host)) {
    return {
      ipAddress: host,
      reachable: false,
      latencyMs: null,
      error: "Not a pingable IPv4 address."
    };
  }

  const isWindows = process.platform === "win32";
  const command = resolvePingCommand();
  const args = isWindows ? ["-n", "1", "-w", "1000", host] : ["-c", "1", "-w", "2", host];

  try {
    const { stdout } = await execFileAsync(command, args, { timeout: 5000, windowsHide: true });
    return interpretPingOutput(host, stdout, isWindows);
  } catch (caught) {
    const stdout =
      caught && typeof caught === "object" && "stdout" in caught
        ? String((caught as { stdout?: Buffer | string }).stdout || "")
        : "";
    const stderr =
      caught && typeof caught === "object" && "stderr" in caught
        ? String((caught as { stderr?: Buffer | string }).stderr || "")
        : "";

    if (stdout.trim()) {
      const parsed = interpretPingOutput(host, stdout, isWindows);
      if (parsed.reachable) {
        return parsed;
      }
    }

    const combined = `${stdout}\n${stderr}`.toLowerCase();
    if (combined.includes("permission denied") || combined.includes("operation not permitted")) {
      return {
        ipAddress: host,
        reachable: false,
        latencyMs: null,
        error: "This server cannot run ping (missing permission)."
      };
    }
    if (combined.includes("name or service not known") || combined.includes("unknown host")) {
      return {
        ipAddress: host,
        reachable: false,
        latencyMs: null,
        error: "Host name could not be resolved."
      };
    }
    return {
      ipAddress: host,
      reachable: false,
      latencyMs: null,
      error: isWindows ? "Request timed out or host unreachable." : "Host unreachable."
    };
  }
}

export async function pingHosts(ipAddresses: string[]) {
  const unique = [...new Set(ipAddresses.map((ip) => ip.trim()).filter(Boolean))];
  const results = await Promise.all(unique.map((ip) => pingHost(ip)));
  return Object.fromEntries(results.map((result) => [result.ipAddress, result]));
}

function resolvePingCommand() {
  if (process.platform === "win32") {
    return "ping";
  }
  for (const candidate of ["/usr/bin/ping", "/bin/ping", "ping"]) {
    if (candidate === "ping" || existsSync(candidate)) {
      return candidate;
    }
  }
  return "ping";
}

function interpretPingOutput(ipAddress: string, output: string, isWindows: boolean): PingHostResult {
  const latencyMs = parsePingLatency(output, isWindows);
  const reachable = latencyMs !== null || /ttl=/i.test(output) || /bytes from/i.test(output);
  return {
    ipAddress,
    reachable,
    latencyMs,
    error: reachable ? undefined : "No reply."
  };
}

function parsePingLatency(output: string, isWindows: boolean) {
  if (isWindows) {
    const match = output.match(/time[=<](\d+)\s*ms/i);
    return match ? Number(match[1]) : null;
  }

  const match = output.match(/time[=<](\d+(?:\.\d+)?)\s*ms/i);
  return match ? Math.round(Number(match[1])) : null;
}
