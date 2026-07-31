import "server-only";

import type { FortiManagerJsonRpcResponse, FortiManagerRpcResultBlock, FortiManagerSettings } from "@/lib/fortimanager/types";
import {
  dedupeDeviceRecords,
  flattenExpandMemberDevices,
  flattenRpcDataRecords,
  type ParsedFortiManagerDeviceRecord
} from "@/lib/fortimanager/device-records";
import { formatReadOnlyApiUserHelp, isFortiManagerPermissionError } from "@/lib/fortimanager/errors";
import { assertFortiManagerScriptSucceeded, validatePoeResetResponse } from "@/lib/fortinet/poe-reset";

const DEVICE_FIELDS = [
  "name",
  "sn",
  "ip",
  "hostname",
  "platform_str",
  "os_ver",
  "conn_status",
  "os_type",
  "mgmt_mode"
] as const;

const COMMON_ADOMS = ["root", "rootp", "default"] as const;

type ProxyInit = {
  method?: string;
  body?: string;
  headers?: HeadersInit;
};

export class FortiManagerClient {
  private requestId = 1;

  constructor(private readonly settings: FortiManagerSettings) {}

  get host() {
    return this.settings.host;
  }

  async testConnection() {
    const status = await this.request<{ version?: string; hostname?: string }>({
      method: "get",
      params: [{ url: "/sys/status" }]
    });
    return status;
  }

  async listManagedDevices(preferredAdom?: string) {
    const discovered = await this.discoverAllDevices();
    const trimmedPreferred = preferredAdom?.trim();

    if (!trimmedPreferred) {
      return discovered;
    }

    const matching = discovered.filter((record) => !record.adom || record.adom === trimmedPreferred);
    if (matching.length > 0) {
      return matching;
    }

    if (discovered.length > 0) {
      return discovered.map((record) => ({
        ...record,
        adom: record.adom || trimmedPreferred
      }));
    }

    const { records, permissionDenied } = await this.fetchDeviceRecordsSafe(
      `/dvmdb/adom/${encodeURIComponent(trimmedPreferred)}/device`,
      trimmedPreferred
    );
    if (records.length > 0) {
      return records;
    }

    if (permissionDenied) {
      throw new Error(formatPreferredAdomHelp(trimmedPreferred));
    }

    return [];
  }

  private async discoverAllDevices() {
    const collected: ParsedFortiManagerDeviceRecord[] = [];
    let sawPermissionDenial = false;

    const { records: globalRecords, permissionDenied: globalDenied } = await this.fetchDeviceRecordsSafe(
      "/dvmdb/device",
      undefined,
      { extraInfo: true }
    );
    if (globalDenied) {
      sawPermissionDenial = true;
    }
    collected.push(...globalRecords);

    for (const attempt of [{ url: "/dvmdb/device" }, { url: "/dvmdb/adom/root/device", adom: "root" }]) {
      if (attempt.url === "/dvmdb/device") {
        continue;
      }
      const { records, permissionDenied } = await this.fetchDeviceRecordsSafe(attempt.url, attempt.adom);
      if (permissionDenied) {
        sawPermissionDenial = true;
      }
      collected.push(...records);
    }

    const deduped = dedupeDeviceRecords(collected);
    if (deduped.length > 0) {
      return deduped;
    }

    const accessibleAdoms = await this.listAccessibleAdomNames();
    const adomCandidates = [...new Set([...accessibleAdoms, ...COMMON_ADOMS])];
    for (const adomName of adomCandidates) {
      const { records, permissionDenied } = await this.fetchDeviceRecordsSafe(
        `/dvmdb/adom/${encodeURIComponent(adomName)}/device`,
        adomName
      );
      if (permissionDenied) {
        sawPermissionDenial = true;
      }
      collected.push(...records);
    }

    const expanded = dedupeDeviceRecords(collected);
    if (expanded.length > 0) {
      return expanded;
    }

    const expandRecords = await this.fetchDeviceRecordsFromAllAdomsSafe();
    if (expandRecords.records.length > 0) {
      return expandRecords.records;
    }
    if (expandRecords.permissionDenied) {
      sawPermissionDenial = true;
    }

    if (sawPermissionDenial) {
      throw new Error(formatDiscoveryPermissionHelp());
    }

    return [];
  }

  private async fetchDeviceRecordsSafe(
    url: string,
    adom?: string,
    options?: { extraInfo?: boolean }
  ) {
    try {
      const blocks = await this.request<FortiManagerRpcResultBlock[]>({
        method: "get",
        params: [
          {
            url,
            loadsub: 0,
            fields: [...DEVICE_FIELDS],
            ...(options?.extraInfo ? { option: ["extra info"] } : {})
          }
        ]
      });
      const records = flattenRpcDataRecords(blocks);
      return {
        records: adom ? records.map((record) => ({ ...record, adom: record.adom || adom })) : records,
        permissionDenied: false
      };
    } catch (error) {
      if (isFortiManagerPermissionError(error)) {
        return { records: [], permissionDenied: true };
      }
      throw error;
    }
  }

  private async listAccessibleAdomNames() {
    try {
      const blocks = await this.request<FortiManagerRpcResultBlock[]>({
        method: "get",
        params: [
          {
            url: "/dvmdb/adom",
            loadsub: 0,
            fields: ["name"]
          }
        ]
      });
      return flattenRpcDataRecords(blocks)
        .map((record) => String(record.name || "").trim())
        .filter(Boolean);
    } catch (error) {
      if (isFortiManagerPermissionError(error)) {
        return [];
      }
      throw error;
    }
  }

  private async fetchDeviceRecordsFromAllAdomsSafe() {
    try {
      const blocks = await this.request<FortiManagerRpcResultBlock[]>({
        method: "get",
        params: [
          {
            url: "/dvmdb/adom",
            option: ["no loadsub"],
            fields: ["name"],
            filter: ["restricted_prds", "==", "fos"],
            "expand member": [
              {
                url: "device",
                option: ["no loadsub"],
                fields: [...DEVICE_FIELDS]
              }
            ]
          }
        ]
      });
      return { records: flattenExpandMemberDevices(blocks), permissionDenied: false };
    } catch (error) {
      if (isFortiManagerPermissionError(error)) {
        return { records: [], permissionDenied: true };
      }
      throw error;
    }
  }

  async testDeviceProxyWrite(deviceName: string, adom?: string | null) {
    try {
      await this.proxyFortiGateRequest(
        deviceName,
        "/api/v2/monitor/system/fsw/poe-reset",
        {
          method: "POST",
          body: JSON.stringify({ switch: "INVALID_PROBE", port: "port1" })
        },
        { adom, vdom: "root" }
      );
      return { ok: true, message: "Write proxy accepted by FortiManager." };
    } catch (error) {
      if (isFortiManagerPermissionError(error)) {
        return { ok: false, message: formatReadOnlyApiUserHelp() };
      }
      return {
        ok: true,
        message: "Write proxy reached the FortiGate (FortiManager did not deny POST)."
      };
    }
  }

  async resetPoeViaCliExecute(
    deviceName: string,
    cliAttempt: { path: string; body: Record<string, unknown> },
    adom?: string | null,
    vdom = "root"
  ) {
    const payload = await this.proxyFortiGateRequest(
      deviceName,
      cliAttempt.path,
      {
        method: "POST",
        body: JSON.stringify(cliAttempt.body)
      },
      { adom, vdom }
    );
    validatePoeResetResponse(payload);
    return payload;
  }

  async resetPoeViaScript(
    deviceName: string,
    command: string,
    adom?: string | null,
    vdom = "root"
  ): Promise<{ command: string }> {
    const trimmedAdom = adom?.trim() || "root";
    const scriptName = `bp_poe_${Date.now()}`;
    const content = command;
    const createAttempts = [
      {
        method: "add" as const,
        url: `/dvmdb/adom/${encodeURIComponent(trimmedAdom)}/script`,
        data: { name: scriptName, type: "cli", content, target: "device" }
      },
      {
        method: "set" as const,
        url: `/pm/config/adom/${encodeURIComponent(trimmedAdom)}/obj/fmg/script`,
        data: { name: scriptName, type: "cli", content, target: "devicedb" }
      }
    ];

    let created = false;
    for (const attempt of createAttempts) {
      try {
        await this.request({
          method: attempt.method,
          params: [{ url: attempt.url, data: attempt.data }]
        });
        created = true;
        break;
      } catch {
        continue;
      }
    }

    if (!created) {
      throw new Error("Could not create a FortiManager CLI script for PoE reset.");
    }

    try {
      const scopeAttempts: Array<Array<{ name: string; vdom: string } | string>> = [
        [{ name: deviceName, vdom }],
        [deviceName]
      ];

      let executed = false;
      let lastExecuteError: Error | null = null;
      let executeResult: unknown = null;
      for (const scope of scopeAttempts) {
        try {
          executeResult = await this.request({
            method: "exec",
            params: [
              {
                url: `/dvmdb/adom/${encodeURIComponent(trimmedAdom)}/script/execute`,
                data: {
                  adom: trimmedAdom,
                  scope,
                  script: scriptName
                }
              }
            ]
          });
          executed = true;
          break;
        } catch (error) {
          lastExecuteError = error instanceof Error ? error : lastExecuteError;
        }
      }

      if (!executed) {
        throw lastExecuteError || new Error("FortiManager script execute failed.");
      }

      assertFortiManagerScriptSucceeded(executeResult, command);
      return { command };
    } finally {
      try {
        await this.request({
          method: "delete",
          params: [{ url: `/dvmdb/adom/${encodeURIComponent(trimmedAdom)}/script/${encodeURIComponent(scriptName)}` }]
        });
      } catch {
        // Best-effort cleanup.
      }
    }
  }

  async testDeviceProxy(deviceName: string, adom?: string | null) {
    const payload = await this.proxyFortiGateRequest(
      deviceName,
      "/api/v2/monitor/system/status",
      { method: "GET" },
      { adom, vdom: "root" }
    );
    const results = payload.results ?? payload;
    const hostname =
      typeof results === "object" && results && "hostname" in results
        ? String((results as Record<string, unknown>).hostname || "")
        : "";
    return {
      ok: true,
      message: hostname
        ? `FortiManager proxy OK for ${deviceName} (FortiGate hostname: ${hostname}).`
        : `FortiManager proxy OK for ${deviceName}.`
    };
  }

  async proxyFortiGateRequest(
    deviceName: string,
    resource: string,
    init?: ProxyInit,
    options?: { vdom?: string | null; adom?: string | null }
  ) {
    return this.proxyFortiGateRequestInternal(deviceName, resource, init, options, false);
  }

  async proxyFortiGateRequestOnce(
    deviceName: string,
    resource: string,
    init?: ProxyInit,
    options?: { vdom?: string | null; adom?: string | null }
  ) {
    return this.proxyFortiGateRequestInternal(deviceName, resource, init, options, true);
  }

  private async proxyFortiGateRequestInternal(
    deviceName: string,
    resource: string,
    init?: ProxyInit,
    options?: { vdom?: string | null; adom?: string | null },
    quick = false
  ) {
    const action = normalizeProxyAction(init?.method);
    const payload = parseProxyPayload(init?.body);
    const targets = buildProxyTargets(deviceName, options?.adom);
    const vdomCandidates = buildVdomCandidates(options?.vdom);
    const rpcUrls = quick ? ["/sys/proxy/json"] : ["/sys/proxy/json", "sys/proxy/json"];
    const failures: string[] = [];

    for (const rpcUrl of rpcUrls) {
      for (const target of quick ? targets.slice(0, 1) : targets) {
        for (const vdom of quick ? vdomCandidates.slice(0, 1) : vdomCandidates) {
          const resourcePath = vdom ? appendVdom(resource, vdom) : stripVdomQuery(resource);
          try {
            const blocks = await this.request<FortiManagerRpcResultBlock[]>({
              method: "exec",
              params: [
                {
                  url: rpcUrl,
                  data: {
                    target: [target],
                    action,
                    resource: resourcePath,
                    ...(payload ? { payload } : {})
                  }
                }
              ]
            });

            return unwrapProxyFortiGateResponse(blocks, deviceName, action);
          } catch (error) {
            const message = error instanceof Error ? error.message : "FortiManager proxy failed.";
            failures.push(`target=${target}, vdom=${vdom || "none"}, url=${rpcUrl}: ${message}`);
            if (quick || !isFortiManagerPermissionError(error)) {
              throw error;
            }
          }
        }
      }
    }

    throw new Error(formatProxyFailureSummary(deviceName, action, failures));
  }

  private async request<T>(body: Record<string, unknown>) {
    const id = this.requestId++;
    const response = await fortimanagerFetch(
      this.settings,
      JSON.stringify({
        id,
        ...body
      })
    );

    const parsed = JSON.parse(response) as FortiManagerJsonRpcResponse<T>;
    if (parsed.error) {
      throw new Error(parsed.error.message || `FortiManager JSON-RPC error ${parsed.error.code ?? ""}`.trim());
    }

    const blocks = Array.isArray(parsed.result) ? parsed.result : [parsed.result];
    for (const block of blocks) {
      const status = (block as FortiManagerRpcResultBlock | null)?.status;
      if (status && status.code !== 0) {
        throw new Error(formatFortiManagerRpcError(status.code, status.message, body));
      }
    }

    return parsed.result as T;
  }
}

function normalizeProxyAction(method?: string) {
  const normalized = (method || "GET").toUpperCase();
  if (normalized === "POST") {
    return "post";
  }
  if (normalized === "PUT") {
    return "put";
  }
  if (normalized === "DELETE") {
    return "delete";
  }
  return "get";
}

function parseProxyPayload(body?: string) {
  if (!body?.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function appendVdom(resource: string, vdom: string) {
  if (!vdom || resource.includes("vdom=")) {
    return resource;
  }
  const separator = resource.includes("?") ? "&" : "?";
  return `${resource}${separator}vdom=${encodeURIComponent(vdom)}`;
}

function stripVdomQuery(resource: string) {
  const [path, query = ""] = resource.split("?");
  if (!query) {
    return path;
  }
  const params = query
    .split("&")
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith("vdom="));
  return params.length ? `${path}?${params.join("&")}` : path;
}

function buildVdomCandidates(preferred?: string | null) {
  const seen = new Set<string>();
  const candidates: Array<string | null> = [];
  const add = (value: string | null) => {
    const key = value ?? "";
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push(value);
  };

  if (preferred?.trim()) {
    add(preferred.trim());
  }
  add("root");
  add("global");
  add(null);
  return candidates;
}

function buildProxyTargets(deviceName: string, adom?: string | null) {
  const trimmedName = deviceName.trim();
  const adoms = new Set<string>(["root"]);
  if (adom?.trim()) {
    adoms.add(adom.trim());
  }

  const targets: string[] = [];
  for (const prefix of ["", "/"]) {
    targets.push(`${prefix}device/${trimmedName}`);
    for (const adomName of adoms) {
      targets.push(`${prefix}adom/${adomName}/device/${trimmedName}`);
    }
  }

  return [...new Set(targets)];
}

function formatProxyFailureSummary(deviceName: string, action: string, failures: string[]) {
  const uniqueMessages = [...new Set(failures.map((entry) => entry.split(": ").slice(1).join(": ")))];
  const readOnlyHint =
    action === "post"
      ? ` ${formatReadOnlyApiUserHelp()}`
      : "";
  return (
    `FortiManager could not proxy ${action.toUpperCase()} requests to ${deviceName}. ` +
    `This is enforced by FortiManager (-11), not a FortiGate firewall policy or FortiSwitch version.${readOnlyHint} ` +
    `Attempts: ${failures.length}. Last errors: ${uniqueMessages.slice(-2).join(" | ")}`
  );
}

function formatPreferredAdomHelp(adom: string) {
  return (
    `Could not list devices in ADOM "${adom}", but your FortiManager API user may still see devices globally. ` +
    `Leave the ADOM field blank in Admin → FortiManager connection, save, and sync again. ` +
    `The app will discover devices from the global list and learn each device's ADOM automatically.`
  );
}

function formatDiscoveryPermissionHelp() {
  return (
    "FortiManager denied every device inventory path we tried. Leave the ADOM field blank and sync again — many API users can read the global /dvmdb/device list even when ADOM-specific paths are blocked. " +
    "If it still fails, confirm the REST API admin has JSON API Access enabled and can open Device Manager in the FortiManager GUI."
  );
}

function formatFortiManagerRpcError(code?: number, message?: string, requestBody?: Record<string, unknown>) {
  const base = message || `FortiManager request failed with code ${code ?? "unknown"}.`;
  if (code !== -11 && !/no permission for the resource/i.test(base)) {
    return base;
  }

  const url = extractFortiManagerRequestUrl(requestBody);
  if (url.includes("sys/proxy/json")) {
    const action = extractProxyAction(requestBody);
    if (action === "post" || action === "put" || action === "delete") {
      return `${base} FortiManager denied a write proxy call before it reached the FortiGate. ${formatReadOnlyApiUserHelp()}`;
    }
    return (
      `${base} FortiManager denied a read proxy call to the FortiGate. ` +
      `This is not a FortiGate firewall rule issue. Check adom-access, dev-group, trusthost, and the exact Device Manager name.`
    );
  }

  if (url.includes("/dvmdb/")) {
    return `${base} ${formatDiscoveryPermissionHelp()}`;
  }

  return base;
}

function extractFortiManagerRequestUrl(body?: Record<string, unknown>) {
  const params = body?.params;
  if (!Array.isArray(params) || !params[0] || typeof params[0] !== "object") {
    return "";
  }
  return String((params[0] as Record<string, unknown>).url || "");
}

function extractProxyAction(body?: Record<string, unknown>) {
  const params = body?.params;
  if (!Array.isArray(params) || !params[0] || typeof params[0] !== "object") {
    return "get";
  }
  const data = (params[0] as Record<string, unknown>).data;
  if (!data || typeof data !== "object") {
    return "get";
  }
  return String((data as Record<string, unknown>).action || "get").toLowerCase();
}

function unwrapProxyFortiGateResponse(
  blocks: FortiManagerRpcResultBlock[] | FortiManagerRpcResultBlock | undefined,
  deviceName: string,
  action = "get"
) {
  const list = Array.isArray(blocks) ? blocks : blocks ? [blocks] : [];
  for (const block of list) {
    const data = block?.data;
    const entries = Array.isArray(data) ? data : data ? [data] : [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const status = record.status as { code?: number; message?: string } | undefined;
      if (status && status.code !== 0) {
        throw new Error(
          formatFortiManagerRpcError(
            status.code,
            status.message || `FortiManager proxy ${action} to ${deviceName} failed.`
          )
        );
      }

      const response = record.response;
      if (typeof response === "string") {
        if (!response.trim()) {
          return {};
        }
        try {
          return JSON.parse(response) as Record<string, unknown>;
        } catch {
          throw new Error(`FortiManager proxy returned non-JSON data for ${deviceName}.`);
        }
      }

      if (response && typeof response === "object") {
        return response as Record<string, unknown>;
      }
    }
  }

  return {};
}

async function fortimanagerFetch(settings: FortiManagerSettings, body: string) {
  const host = settings.host.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const url = `https://${host}/jsonrpc`;
  const timeoutMs = Number(process.env.FORTIMANAGER_API_TIMEOUT_MS || process.env.FORTINET_API_TIMEOUT_MS || 10000);

  const previousTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  if (!settings.verifyTls) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store"
    });

    const rawBody = await response.text();
    if (!response.ok) {
      throw new Error(`FortiManager request failed: ${response.status} ${response.statusText}${formatBodyDetail(rawBody)}`);
    }
    return rawBody;
  } finally {
    if (!settings.verifyTls) {
      if (previousTlsSetting === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsSetting;
      }
    }
  }
}

function formatBodyDetail(rawBody: string) {
  if (!rawBody.trim()) {
    return "";
  }
  try {
    const parsed = JSON.parse(rawBody) as FortiManagerJsonRpcResponse;
    const message = parsed.error?.message;
    return message ? `: ${message}` : `: ${rawBody.slice(0, 180)}`;
  } catch {
    return `: ${rawBody.slice(0, 180)}`;
  }
}
