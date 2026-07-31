import "server-only";

import fs from "node:fs";
import path from "node:path";
import {
  dnsDomainToBaseDn,
  type AdSettings,
  type AdSettingsDetection
} from "@/lib/ad-settings";

export type { AdSettings, AdSettingsDetection } from "@/lib/ad-settings";
export { dnsDomainToBaseDn, parseAdSettingsForm, validateAdSettings } from "@/lib/ad-settings";

const AD_ENV_KEYS = [
  "AD_URL",
  "AD_BASE_DN",
  "AD_DOMAIN",
  "AD_USERNAME_ATTRIBUTE",
  "AD_GROUP_ATTRIBUTE",
  "AD_VERIFY_TLS"
] as const;

const DEFAULTS: AdSettings = {
  adUrl: "",
  adBaseDn: "",
  adDomain: "",
  adUsernameAttribute: "sAMAccountName",
  adGroupAttribute: "memberOf",
  adVerifyTls: true
};

function parseVerifyTlsEnv(value: string | undefined, fallback = true) {
  if (value === undefined || value === "") {
    return fallback;
  }
  return value !== "false" && value !== "0" && value.toLowerCase() !== "no";
}

function envFilePath() {
  return path.join(process.cwd(), ".env");
}

function parseEnvLines(content: string) {
  const values: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

export function readAdSettingsFromEnvFile(): AdSettings {
  const filePath = envFilePath();
  const fromFile = fs.existsSync(filePath) ? parseEnvLines(fs.readFileSync(filePath, "utf8")) : {};

  return {
    adUrl: fromFile.AD_URL || process.env.AD_URL || "",
    adBaseDn: fromFile.AD_BASE_DN || process.env.AD_BASE_DN || "",
    adDomain: fromFile.AD_DOMAIN || process.env.AD_DOMAIN || "",
    adUsernameAttribute: fromFile.AD_USERNAME_ATTRIBUTE || process.env.AD_USERNAME_ATTRIBUTE || DEFAULTS.adUsernameAttribute,
    adGroupAttribute: fromFile.AD_GROUP_ATTRIBUTE || process.env.AD_GROUP_ATTRIBUTE || DEFAULTS.adGroupAttribute,
    adVerifyTls: parseVerifyTlsEnv(fromFile.AD_VERIFY_TLS ?? process.env.AD_VERIFY_TLS, DEFAULTS.adVerifyTls)
  };
}

export function detectAdSettingsFromHost(): AdSettingsDetection {
  const source: string[] = [];
  const dnsDomain = process.env.USERDNSDOMAIN?.trim();
  const userDomain = process.env.USERDOMAIN?.trim();
  const logonServer = process.env.LOGONSERVER?.replace(/^\\\\+/i, "").trim();

  const settings: Partial<AdSettings> = {
    adUsernameAttribute: "sAMAccountName",
    adGroupAttribute: "memberOf"
  };

  if (dnsDomain) {
    source.push("USERDNSDOMAIN");
    settings.adBaseDn = dnsDomainToBaseDn(dnsDomain);
    settings.adDomain = (userDomain || dnsDomain.split(".")[0] || "").toUpperCase();

    if (logonServer) {
      source.push("LOGONSERVER");
      const fqdn = `${logonServer.toLowerCase()}.${dnsDomain.toLowerCase()}`;
      settings.adUrl = `ldaps://${fqdn}:636`;
    } else {
      settings.adUrl = `ldap://${dnsDomain}:389`;
    }
  } else if (userDomain) {
    source.push("USERDOMAIN");
    settings.adDomain = userDomain.toUpperCase();
  }

  if (userDomain && !source.includes("USERDOMAIN")) {
    source.push("USERDOMAIN");
    settings.adDomain = userDomain.toUpperCase();
  }

  return {
    settings,
    source,
    hostname: process.env.COMPUTERNAME || process.env.HOSTNAME || "unknown"
  };
}

export function applyAdSettingsToProcessEnv(settings: AdSettings) {
  process.env.AD_URL = settings.adUrl;
  process.env.AD_BASE_DN = settings.adBaseDn;
  process.env.AD_DOMAIN = settings.adDomain;
  process.env.AD_USERNAME_ATTRIBUTE = settings.adUsernameAttribute;
  process.env.AD_GROUP_ATTRIBUTE = settings.adGroupAttribute;
  process.env.AD_VERIFY_TLS = settings.adVerifyTls ? "true" : "false";
}

export function writeAdSettingsToEnvFile(settings: AdSettings) {
  const filePath = envFilePath();
  const updates: Record<string, string> = {
    AD_URL: settings.adUrl,
    AD_BASE_DN: settings.adBaseDn,
    AD_DOMAIN: settings.adDomain,
    AD_USERNAME_ATTRIBUTE: settings.adUsernameAttribute,
    AD_GROUP_ATTRIBUTE: settings.adGroupAttribute,
    AD_VERIFY_TLS: settings.adVerifyTls ? "true" : "false"
  };

  const existingLines = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8").split(/\r?\n/) : [];
  const pending = new Map(Object.entries(updates));
  const output: string[] = [];
  const replaced = new Set<string>();

  for (const line of existingLines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^([A-Z][A-Z0-9_]*)=/);
    if (match && pending.has(match[1])) {
      output.push(`${match[1]}=${pending.get(match[1])}`);
      replaced.add(match[1]);
      continue;
    }
    output.push(line);
  }

  for (const key of AD_ENV_KEYS) {
    if (!replaced.has(key) && pending.has(key)) {
      output.push(`${key}=${pending.get(key)}`);
    }
  }

  const normalized = output.join("\n").replace(/\n*$/, "\n");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, normalized, "utf8");
  applyAdSettingsToProcessEnv(settings);
}
