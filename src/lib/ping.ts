import "server-only";

import { execFile } from "node:child_process";
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
  if (!isPingableIpv4(ipAddress)) {
    return {
      ipAddress,
      reachable: false,
      latencyMs: null,
      error: "Not a pingable IPv4 address."
    };
  }

  const isWindows = process.platform === "win32";
  const args = isWindows ? ["-n", "1", "-w", "1000", ipAddress] : ["-c", "1", "-W", "1", ipAddress];

  try {
    const { stdout } = await execFileAsync("ping", args, { timeout: 4000, windowsHide: true });
    const latencyMs = parsePingLatency(stdout, isWindows);
    const reachable = latencyMs !== null || /ttl=/i.test(stdout);
    return { ipAddress, reachable, latencyMs };
  } catch (caught) {
    const stdout =
      caught && typeof caught === "object" && "stdout" in caught
        ? String((caught as { stdout?: Buffer | string }).stdout || "")
        : "";
    const latencyMs = stdout ? parsePingLatency(stdout, isWindows) : null;
    if (latencyMs !== null) {
      return { ipAddress, reachable: true, latencyMs };
    }
    return {
      ipAddress,
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

function parsePingLatency(output: string, isWindows: boolean) {
  if (isWindows) {
    const match = output.match(/time[=<](\d+)\s*ms/i);
    return match ? Number(match[1]) : null;
  }

  const match = output.match(/time[=<](\d+(?:\.\d+)?)\s*ms/i);
  return match ? Math.round(Number(match[1])) : null;
}
