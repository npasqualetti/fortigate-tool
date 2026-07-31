import "server-only";

import fs from "node:fs";
import path from "node:path";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import {
  markFortiManagerSyncedAt,
  readFortiManagerSettingsRow,
  saveFortiManagerSettingsRow
} from "@/lib/db";
import type { FortiManagerSettings } from "@/lib/fortimanager/types";

export const encryptedApiKeySentinel = "__ENCRYPTED_FORTIMANAGER_API_KEY__";

export function isStoredFortiManagerApiKeyPlaceholder(value: string) {
  return value === encryptedApiKeySentinel || value === "Encrypted API key stored";
}

export function getFortiManagerSettings(): FortiManagerSettings | null {
  const fromDb = readFortiManagerSettingsRow();
  const host = fromDb?.host || process.env.FORTIMANAGER_HOST?.trim() || "";
  const apiKey =
    (fromDb?.apiKeyEncrypted ? decryptSecret(fromDb.apiKeyEncrypted) : null) ||
    process.env.FORTIMANAGER_API_KEY?.trim() ||
    "";
  const verifyTls = fromDb ? fromDb.verifyTls : process.env.FORTIMANAGER_VERIFY_TLS !== "false";
  const adom = fromDb?.adom || process.env.FORTIMANAGER_ADOM?.trim() || "";

  if (!host || !apiKey) {
    return null;
  }

  return { host, apiKey, verifyTls, adom };
}

export function getPublicFortiManagerSettings() {
  const settings = getFortiManagerSettings();
  const row = readFortiManagerSettingsRow();
  return {
    configured: Boolean(settings),
    host: row?.host || process.env.FORTIMANAGER_HOST?.trim() || "",
    verifyTls: row?.verifyTls ?? process.env.FORTIMANAGER_VERIFY_TLS !== "false",
    adom: row?.adom || process.env.FORTIMANAGER_ADOM?.trim() || "",
    apiKeyStored: Boolean(row?.apiKeyEncrypted || process.env.FORTIMANAGER_API_KEY?.trim()),
    lastSyncedAt: row?.lastSyncedAt || null
  };
}

export function saveFortiManagerSettings(input: {
  host: string;
  apiKey?: string | null;
  verifyTls: boolean;
  adom: string;
}) {
  const existing = readFortiManagerSettingsRow();
  const host = input.host.trim();
  const apiKeyEncrypted =
    input.apiKey && !isStoredFortiManagerApiKeyPlaceholder(input.apiKey)
      ? encryptSecret(input.apiKey.trim())
      : existing?.apiKeyEncrypted || null;

  if (!host || !apiKeyEncrypted) {
    throw new Error("FortiManager host and API key are required.");
  }

  saveFortiManagerSettingsRow({
    host,
    apiKeyEncrypted,
    verifyTls: input.verifyTls,
    adom: input.adom.trim()
  });
}

export function markFortiManagerSynced() {
  markFortiManagerSyncedAt();
}

export function readFortiManagerSettingsFromEnvFile() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    return {
      host: process.env.FORTIMANAGER_HOST?.trim() || "",
      apiKey: process.env.FORTIMANAGER_API_KEY?.trim() ? encryptedApiKeySentinel : "",
      verifyTls: process.env.FORTIMANAGER_VERIFY_TLS !== "false",
      adom: process.env.FORTIMANAGER_ADOM?.trim() || ""
    };
  }

  const values = Object.fromEntries(
    fs
      .readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        if (index === -1) {
          return [line.trim(), ""];
        }
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      })
  );

  return {
    host: values.FORTIMANAGER_HOST || process.env.FORTIMANAGER_HOST?.trim() || "",
    apiKey: values.FORTIMANAGER_API_KEY ? encryptedApiKeySentinel : "",
    verifyTls: values.FORTIMANAGER_VERIFY_TLS !== "false",
    adom: values.FORTIMANAGER_ADOM || process.env.FORTIMANAGER_ADOM?.trim() || ""
  };
}
