import "server-only";

import { Client } from "ldapts";
import type { AdSettings } from "@/lib/ad-settings";
import { optionalEnv, requiredEnv } from "@/lib/env";

export type LdapUser = {
  username: string;
  displayName: string;
  groups: string[];
};

export type LdapConnectionSettings = {
  url: string;
  baseDn: string;
  domain: string;
  usernameAttribute: string;
  groupAttribute: string;
  verifyTls?: boolean;
};

export type LdapTestResult = {
  bindOk: boolean;
  searchOk: boolean;
  displayName?: string;
  groupCount: number;
  sampleGroups: string[];
};

function resolveLdapSettings(overrides?: Partial<LdapConnectionSettings>): LdapConnectionSettings {
  return {
    url: overrides?.url || requiredEnv("AD_URL"),
    baseDn: overrides?.baseDn || requiredEnv("AD_BASE_DN"),
    domain: overrides?.domain || requiredEnv("AD_DOMAIN"),
    usernameAttribute: overrides?.usernameAttribute || optionalEnv("AD_USERNAME_ATTRIBUTE", "sAMAccountName"),
    groupAttribute: overrides?.groupAttribute || optionalEnv("AD_GROUP_ATTRIBUTE", "memberOf"),
    verifyTls:
      overrides?.verifyTls ??
      (process.env.AD_VERIFY_TLS === undefined ? true : process.env.AD_VERIFY_TLS !== "false")
  };
}

function ldapClientOptions(settings: LdapConnectionSettings) {
  const timeout = Number(process.env.AD_TEST_TIMEOUT_MS || 8000);
  const verifyTls = settings.verifyTls ?? true;
  const useLdaps = /^ldaps:\/\//i.test(settings.url);

  return {
    url: settings.url,
    timeout,
    connectTimeout: timeout,
    tlsOptions: useLdaps && !verifyTls ? { rejectUnauthorized: false as const } : undefined
  };
}

function formatLdapError(error: Error) {
  if (/unable to get (local )?issuer certificate|self signed certificate|certificate/i.test(error.message)) {
    return `${error.message} If your domain controller uses an internal CA or self-signed LDAPS certificate, uncheck "Verify TLS certificate" in Admin → Active Directory connection, save to .env, and restart the app.`;
  }
  return error.message;
}

export function ldapSettingsFromAdSettings(settings: AdSettings): LdapConnectionSettings {
  return {
    url: settings.adUrl,
    baseDn: settings.adBaseDn,
    domain: settings.adDomain,
    usernameAttribute: settings.adUsernameAttribute,
    groupAttribute: settings.adGroupAttribute,
    verifyTls: settings.adVerifyTls
  };
}

function userPrincipalName(username: string, domain: string) {
  if (username.includes("@") || username.includes("\\")) {
    return username;
  }

  return domain ? `${domain}\\${username}` : username;
}

export async function authenticateLdapUser(
  username: string,
  password: string,
  overrides?: Partial<LdapConnectionSettings>
): Promise<LdapUser> {
  const result = await testLdapAuthentication(username, password, overrides);
  return {
    username: result.username,
    displayName: result.displayName,
    groups: result.groups
  };
}

export async function testLdapAuthentication(
  username: string,
  password: string,
  overrides?: Partial<LdapConnectionSettings>
): Promise<LdapUser & LdapTestResult> {
  if (!username || !password) {
    throw new Error("Enter an AD username and password to test LDAP.");
  }

  const settings = resolveLdapSettings(overrides);
  const client = new Client(ldapClientOptions(settings));

  try {
    await client.bind(userPrincipalName(username, settings.domain), password);

    const { searchEntries } = await client.search(settings.baseDn, {
      scope: "sub",
      filter: `(${settings.usernameAttribute}=${escapeFilterValue(username)})`,
      attributes: ["displayName", settings.usernameAttribute, settings.groupAttribute]
    });

    const entry = searchEntries[0];
    if (!entry) {
      throw new Error("Bind succeeded, but the user was not found in the configured search base.");
    }

    const groups = entry[settings.groupAttribute];
    const groupList = Array.isArray(groups) ? groups.map(String) : groups ? [String(groups)] : [];
    const displayName = Array.isArray(entry.displayName)
      ? String(entry.displayName[0])
      : String(entry.displayName || username);

    return {
      username,
      displayName,
      groups: groupList,
      bindOk: true,
      searchOk: true,
      groupCount: groupList.length,
      sampleGroups: groupList.slice(0, 5)
    };
  } catch (caught) {
    if (caught instanceof Error) {
      throw new Error(formatLdapError(caught));
    }
    throw new Error("LDAP test failed.");
  } finally {
    await client.unbind().catch(() => undefined);
  }
}

function escapeFilterValue(value: string) {
  return value.replace(/[\\()*\0]/g, (char) => {
    const code = char.charCodeAt(0).toString(16).padStart(2, "0");
    return `\\${code}`;
  });
}
