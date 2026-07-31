"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import {
  deleteFortiManagerSyncSession,
  ensureDefaultFirewallSite,
  getFortiManagerSyncSessionRow,
  saveFortiManagerSyncSession,
  upsertFirewallFromDiscovery,
  writeAudit
} from "@/lib/db";
import { FortiManagerClient } from "@/lib/fortimanager/client";
import { discoverFortiManagerDevices } from "@/lib/fortimanager/devices";
import { getFortiManagerSyncBatchSize, getSyncBatchSlice } from "@/lib/fortimanager/sync-batch";
import {
  createSyncSessionId,
  parseSyncSessionPayload,
  serializeSyncSession
} from "@/lib/fortimanager/sync-session";
import {
  getFortiManagerSettings,
  getPublicFortiManagerSettings,
  readFortiManagerSettingsFromEnvFile,
  saveFortiManagerSettings,
  markFortiManagerSynced
} from "@/lib/fortimanager/settings";
import { resetFortiManagerClientCache } from "@/lib/fortinet/create-client";

export type FortiManagerActionState = {
  error?: string;
  message?: string;
  discoveredCount?: number;
  syncId?: string;
  total?: number;
  processed?: number;
  complete?: boolean;
  batchSize?: number;
} | undefined;

export async function getFortiManagerAdminState() {
  await requireRole(["network_admin"]);
  return {
    settings: getPublicFortiManagerSettings(),
    envDefaults: readFortiManagerSettingsFromEnvFile()
  };
}

export async function testAndSaveFortiManagerConnection(input: {
  host: string;
  apiKey: string;
  verifyTls: boolean;
  adom: string;
}): Promise<FortiManagerActionState> {
  const formData = new FormData();
  formData.set("host", input.host);
  formData.set("apiKey", input.apiKey);
  formData.set("adom", input.adom);
  if (input.verifyTls) {
    formData.set("verifyTls", "on");
  }
  return testFortiManagerAction(undefined, formData);
}

export async function testFortiManagerAction(
  _: FortiManagerActionState,
  formData: FormData
): Promise<FortiManagerActionState> {
  const user = await requireRole(["network_admin"]);
  const host = String(formData.get("host") || "").trim();
  const apiKey = String(formData.get("apiKey") || "").trim();
  const verifyTls = formData.get("verifyTls") === "on";
  const adom = String(formData.get("adom") || "").trim();

  const settings = getFortiManagerSettings();
  const resolvedKey =
    apiKey && apiKey !== "__ENCRYPTED_FORTIMANAGER_API_KEY__" && apiKey !== "Encrypted API key stored"
      ? apiKey
      : settings?.apiKey;

  if (!host || !resolvedKey) {
    return { error: "Enter the FortiManager host/IP and API key before testing." };
  }

  try {
    const client = new FortiManagerClient({ host, apiKey: resolvedKey, verifyTls, adom });
    await client.testConnection();
    const devices = await discoverFortiManagerDevices(client, adom);
    let proxyMessage = "";
    if (devices[0]) {
      try {
        const proxyResult = await client.testDeviceProxy(devices[0].name, devices[0].adom || adom || null);
        proxyMessage = proxyResult.message;
        const writeResult = await client.testDeviceProxyWrite(
          devices[0].name,
          devices[0].adom || adom || null
        );
        if (!writeResult.ok) {
          writeAudit({
            username: user.username,
            action: "admin.fortimanager.test",
            targetType: "fortimanager",
            targetId: host,
            status: "error",
            details: writeResult.message
          });
          return {
            error: `Read proxy OK, but write proxy is blocked: ${writeResult.message}`
          };
        }
        proxyMessage = `${proxyMessage} ${writeResult.message}`.trim();
      } catch (error) {
        proxyMessage = error instanceof Error ? error.message : "FortiManager proxy test failed.";
        writeAudit({
          username: user.username,
          action: "admin.fortimanager.test",
          targetType: "fortimanager",
          targetId: host,
          status: "error",
          details: proxyMessage
        });
        return {
          error: `Found ${devices.length} device(s) in inventory, but proxy to FortiGate failed: ${proxyMessage}`
        };
      }
    }

    writeAudit({
      username: user.username,
      action: "admin.fortimanager.test",
      targetType: "fortimanager",
      targetId: host,
      status: "success",
      details: `FortiManager connection OK. Found ${devices.length} managed FortiGate device(s). ${proxyMessage}`
    });

    try {
      saveFortiManagerSettings({
        host,
        apiKey: apiKey || null,
        verifyTls,
        adom
      });
      resetFortiManagerClientCache();
      writeAudit({
        username: user.username,
        action: "admin.fortimanager.save",
        targetType: "fortimanager",
        targetId: host,
        status: "success",
        details: `Saved FortiManager connection settings for ${host} after successful test.`
      });
    } catch (saveError) {
      const saveMessage = saveError instanceof Error ? saveError.message : "Unable to save FortiManager settings.";
      writeAudit({
        username: user.username,
        action: "admin.fortimanager.save",
        targetType: "fortimanager",
        targetId: host,
        status: "error",
        details: saveMessage
      });
      return {
        error: `Connection test passed but settings could not be saved: ${saveMessage}`
      };
    }

    const deviceSummary =
      devices.length > 0
        ? `Found ${devices.length} managed FortiGate device(s).`
        : "No managed FortiGate devices were returned.";
    const proxySummary = proxyMessage ? ` ${proxyMessage}` : "";

    return {
      message: `Connection successful — settings saved. ${deviceSummary}${proxySummary}`.trim(),
      discoveredCount: devices.length
    };
  } catch (error) {
    writeAudit({
      username: user.username,
      action: "admin.fortimanager.test",
      targetType: "fortimanager",
      targetId: host,
      status: "error",
      details: error instanceof Error ? error.message : "FortiManager test failed."
    });
    return { error: error instanceof Error ? error.message : "FortiManager test failed." };
  }
}

export async function saveFortiManagerAction(
  _: FortiManagerActionState,
  formData: FormData
): Promise<FortiManagerActionState> {
  const user = await requireRole(["network_admin"]);
  const host = String(formData.get("host") || "").trim();
  const apiKey = String(formData.get("apiKey") || "").trim();
  const verifyTls = formData.get("verifyTls") === "on";
  const adom = String(formData.get("adom") || "").trim();

  try {
    saveFortiManagerSettings({
      host,
      apiKey: apiKey || null,
      verifyTls,
      adom
    });
    resetFortiManagerClientCache();
    writeAudit({
      username: user.username,
      action: "admin.fortimanager.save",
      targetType: "fortimanager",
      targetId: host,
      status: "success",
      details: `Saved FortiManager connection settings for ${host}.`
    });
    revalidatePath("/admin");
    return { message: "Saved FortiManager connection settings." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to save FortiManager settings." };
  }
}

function discoveryIpAddress(deviceName: string, ipAddress: string | null) {
  const ipv4Pattern =
    /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
  if (ipAddress && ipv4Pattern.test(ipAddress) && ipAddress !== "0.0.0.0") {
    return ipAddress;
  }
  let hash = 0;
  for (const char of deviceName) {
    hash = (hash + char.charCodeAt(0)) % 200;
  }
  return `10.255.${hash + 1}.1`;
}

function loadSyncSessionForUser(syncId: string, username: string) {
  const row = getFortiManagerSyncSessionRow(syncId);
  if (!row) {
    return { error: "Sync session expired or not found. Start sync again." as const };
  }
  if (row.username !== username) {
    return { error: "This sync session belongs to another admin user." as const };
  }
  const session = parseSyncSessionPayload(row.id, row.username, row.createdAt, row.payloadJson);
  if (!session) {
    deleteFortiManagerSyncSession(syncId);
    return { error: "Sync session data was invalid. Start sync again." as const };
  }
  return { session };
}

function upsertDiscoveredDevice(
  device: Awaited<ReturnType<typeof discoverFortiManagerDevices>>[number],
  siteId: number,
  settings: { verifyTls: boolean; adom: string }
) {
  upsertFirewallFromDiscovery({
    siteId,
    name: device.hostname || device.name,
    ipAddress: discoveryIpAddress(device.name, device.ipAddress),
    hostname: device.hostname,
    model: device.model,
    serialNumber: device.serialNumber,
    fmgDeviceName: device.name,
    adom: device.adom || settings.adom || null,
    verifyTls: settings.verifyTls
  });
}

export async function beginFortiManagerSyncAction(): Promise<FortiManagerActionState> {
  const user = await requireRole(["network_admin"]);
  const settings = getFortiManagerSettings();
  if (!settings) {
    return { error: "Configure FortiManager host and API key first." };
  }

  try {
    const client = new FortiManagerClient(settings);
    const devices = await discoverFortiManagerDevices(client, settings.adom);
    const syncId = createSyncSessionId();
    const batchSize = getFortiManagerSyncBatchSize();

    saveFortiManagerSyncSession({
      id: syncId,
      username: user.username,
      payloadJson: serializeSyncSession({
        id: syncId,
        username: user.username,
        devices,
        verifyTls: settings.verifyTls,
        defaultAdom: settings.adom,
        host: settings.host,
        createdAt: new Date().toISOString()
      })
    });

    writeAudit({
      username: user.username,
      action: "admin.fortimanager.sync_begin",
      targetType: "fortimanager",
      targetId: settings.host,
      status: "success",
      details: `Discovered ${devices.length} FortiGate device(s) from FortiManager. Batch size ${batchSize}.`
    });

    return {
      syncId,
      total: devices.length,
      processed: 0,
      complete: devices.length === 0,
      batchSize,
      discoveredCount: devices.length,
      message:
        devices.length > 0
          ? `Discovered ${devices.length} FortiGate device(s). Importing in batches of ${batchSize}…`
          : "FortiManager returned no managed FortiGate devices."
    };
  } catch (error) {
    writeAudit({
      username: user.username,
      action: "admin.fortimanager.sync_begin",
      targetType: "fortimanager",
      targetId: settings.host,
      status: "error",
      details: error instanceof Error ? error.message : "FortiManager discovery failed."
    });
    return { error: error instanceof Error ? error.message : "FortiManager discovery failed." };
  }
}

export async function processFortiManagerSyncBatchAction(
  syncId: string,
  offset: number
): Promise<FortiManagerActionState> {
  const user = await requireRole(["network_admin"]);
  const loaded = loadSyncSessionForUser(syncId, user.username);
  if ("error" in loaded) {
    return { error: loaded.error };
  }

  const { session } = loaded;
  const batchSize = getFortiManagerSyncBatchSize();
  const slice = getSyncBatchSlice(session.devices, offset, batchSize);
  const defaultSite = ensureDefaultFirewallSite();

  try {
    for (const device of slice.batch) {
      upsertDiscoveredDevice(device, defaultSite.id, {
        verifyTls: session.verifyTls,
        adom: session.defaultAdom
      });
    }

    if (slice.complete) {
      markFortiManagerSynced();
      deleteFortiManagerSyncSession(syncId);
      writeAudit({
        username: user.username,
        action: "admin.fortimanager.sync_devices",
        targetType: "fortimanager",
        targetId: session.host,
        status: "success",
        details: `Synced ${slice.total} FortiGate device(s) from FortiManager in ${Math.ceil(slice.total / batchSize)} batch(es).`
      });
      revalidatePath("/admin");
      revalidatePath("/firewalls");
      return {
        syncId,
        total: slice.total,
        processed: slice.processed,
        complete: true,
        batchSize,
        discoveredCount: slice.total,
        message: `Synced ${slice.total} FortiGate device(s) from FortiManager.`
      };
    }

    return {
      syncId,
      total: slice.total,
      processed: slice.processed,
      complete: false,
      batchSize,
      message: `Imported ${slice.processed} of ${slice.total} FortiGate device(s)…`
    };
  } catch (error) {
    writeAudit({
      username: user.username,
      action: "admin.fortimanager.sync_devices",
      targetType: "fortimanager",
      targetId: session.host,
      status: "error",
      details: error instanceof Error ? error.message : "FortiManager batch sync failed."
    });
    return { error: error instanceof Error ? error.message : "FortiManager batch sync failed." };
  }
}

export async function cancelFortiManagerSyncAction(syncId: string): Promise<FortiManagerActionState> {
  const user = await requireRole(["network_admin"]);
  const loaded = loadSyncSessionForUser(syncId, user.username);
  if ("error" in loaded) {
    return { error: loaded.error };
  }

  deleteFortiManagerSyncSession(syncId);
  writeAudit({
    username: user.username,
    action: "admin.fortimanager.sync_cancel",
    targetType: "fortimanager",
    targetId: loaded.session.host,
    status: "success",
    details: `Cancelled FortiManager sync after partial import (${loaded.session.devices.length} discovered).`
  });
  return { message: "FortiManager sync cancelled. Already-imported devices were kept." };
}

/** @deprecated Use beginFortiManagerSyncAction + processFortiManagerSyncBatchAction from the Admin UI. */
export async function syncFortiManagerDevicesAction(
  _: FortiManagerActionState,
  _formData: FormData
): Promise<FortiManagerActionState> {
  const begin = await beginFortiManagerSyncAction();
  if (begin?.error || !begin?.syncId) {
    return begin;
  }

  let offset = 0;
  let last: NonNullable<FortiManagerActionState> = begin;
  while (!last.complete) {
    last = (await processFortiManagerSyncBatchAction(begin.syncId, offset)) ?? last;
    if (last.error) {
      return last;
    }
    if (last.complete) {
      return last;
    }
    offset = last.processed ?? offset;
  }
  return last;
}
