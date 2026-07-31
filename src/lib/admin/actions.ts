"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import {
  addAllowedOui,
  deleteAllowedOui,
  deleteFirewall,
  updateAllowedOui,
  deleteSite,
  listFirewalls,
  listSites,
  siteByNumber,
  updateSite,
  updateSiteTextField,
  updateFirewallApiToken,
  updateFirewallTextField,
  updateFirewallTls,
  upsertFirewall,
  deleteRoleGroup,
  updateRoleGroup,
  upsertRoleGroup,
  upsertSite,
  writeAudit
} from "@/lib/db";
import type { AdSettings } from "@/lib/ad-settings";
import { createFortinetClient, isFortiManagerMode } from "@/lib/fortinet/create-client";
import { FortinetClient } from "@/lib/fortinet/client";
import { isFirewallApiReady } from "@/lib/fortinet/connectivity";
import {
  detectAdSettingsFromHost,
  parseAdSettingsForm,
  readAdSettingsFromEnvFile,
  validateAdSettings,
  writeAdSettingsToEnvFile
} from "@/lib/ad-settings.server";
import { ldapSettingsFromAdSettings, testLdapAuthentication } from "@/lib/auth/ldap";
import { getFirewallLiveHardware } from "@/lib/fortinet/overview";
import { parseSiteCsv } from "@/lib/import-sites";
import type { AppRole } from "@/lib/types";

export type FirewallLiveHardwareRow = {
  id: number;
  model: string | null;
  serialNumber: string | null;
  hostname: string | null;
  storedModel: string | null;
  storedSerialNumber: string | null;
  storedHostname: string | null;
  liveModel: string | null;
  liveSerialNumber: string | null;
  liveHostname: string | null;
  apiStatus: "online" | "offline" | "not_configured";
  error?: string;
};

const encryptedTokenSentinel = "__ENCRYPTED_TOKEN_STORED__";

function isStoredTokenPlaceholder(value: string) {
  return value === encryptedTokenSentinel || value === "Encrypted token stored";
}

export type AdSettingsActionState = {
  error?: string;
  message?: string;
  detected?: Partial<AdSettings>;
  detectionSource?: string[];
  detectionHostname?: string;
  testResult?: {
    displayName: string;
    groupCount: number;
    sampleGroups: string[];
  };
} | undefined;

export async function detectAdSettingsAction(): Promise<AdSettingsActionState> {
  await requireRole(["network_admin"]);
  const detection = detectAdSettingsFromHost();

  if (!detection.source.length) {
    return {
      error:
        "This server is not reporting domain-join details (USERDNSDOMAIN / LOGONSERVER). Enter LDAP settings manually or run this on the domain-joined Windows host."
    };
  }

  return {
    message: `Detected AD settings from ${detection.source.join(", ")} on ${detection.hostname}. Review the values, test sign-in, then save to .env.`,
    detected: detection.settings,
    detectionSource: detection.source,
    detectionHostname: detection.hostname
  };
}

export async function testAdSettingsAction(_: AdSettingsActionState, formData: FormData): Promise<AdSettingsActionState> {
  const user = await requireRole(["network_admin"]);
  const settings = parseAdSettingsForm(formData);
  const validationError = validateAdSettings(settings);
  if (validationError) {
    return { error: validationError };
  }

  const testUsername = String(formData.get("testUsername") || "").trim();
  const testPassword = String(formData.get("testPassword") || "");

  if (!testUsername || !testPassword) {
    return { error: "Enter an AD username and password to test LDAP sign-in." };
  }

  try {
    const result = await testLdapAuthentication(testUsername, testPassword, ldapSettingsFromAdSettings(settings));
    writeAudit({
      username: user.username,
      action: "admin.ad_settings.test",
      targetType: "ad_settings",
      targetId: settings.adUrl,
      status: "success",
      details: `LDAP test succeeded for ${result.username} (${result.groupCount} groups returned).`
    });
    return {
      message: `LDAP test succeeded for ${result.displayName} (${result.username}).`,
      testResult: {
        displayName: result.displayName,
        groupCount: result.groupCount,
        sampleGroups: result.sampleGroups
      }
    };
  } catch (error) {
    writeAudit({
      username: user.username,
      action: "admin.ad_settings.test",
      targetType: "ad_settings",
      targetId: settings.adUrl,
      status: "error",
      details: error instanceof Error ? error.message : "LDAP test failed."
    });
    return { error: error instanceof Error ? error.message : "LDAP test failed." };
  }
}

export async function saveAdSettingsAction(_: AdSettingsActionState, formData: FormData): Promise<AdSettingsActionState> {
  const user = await requireRole(["network_admin"]);
  const settings = parseAdSettingsForm(formData);
  const validationError = validateAdSettings(settings);
  if (validationError) {
    return { error: validationError };
  }

  const confirmed = formData.get("confirmSave") === "on";
  if (!confirmed) {
    return { error: "Check the confirmation box before writing AD settings to the .env file." };
  }

  try {
    writeAdSettingsToEnvFile(settings);
    writeAudit({
      username: user.username,
      action: "admin.ad_settings.save",
      targetType: "ad_settings",
      targetId: settings.adUrl,
      status: "success",
      details: `Updated AD_URL, AD_BASE_DN, and AD_DOMAIN in .env (${settings.adDomain}).`
    });
    revalidatePath("/admin");
    return {
      message:
        "Saved AD settings to .env and reloaded them in this process. Restart start.bat after deployment so future restarts keep the same values."
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to update .env." };
  }
}

type RoleGroupActionState = { error?: string; message?: string } | undefined;

export async function saveRoleGroupAction(_: RoleGroupActionState, formData: FormData): Promise<RoleGroupActionState> {
  const user = await requireRole(["network_admin"]);
  const role = String(formData.get("role")) as AppRole;
  const groupDn = String(formData.get("groupDn") || "").trim();
  const description = String(formData.get("description") || "").trim();

  if (!groupDn) {
    return { error: "Enter the Active Directory group distinguished name." };
  }

  try {
    upsertRoleGroup({ role, groupDn, description });
    writeAudit({
      username: user.username,
      action: "admin.role_group.save",
      targetType: "role_group",
      targetId: groupDn,
      status: "success",
      details: `Mapped ${groupDn} to ${role}.`
    });
    revalidatePath("/admin");
    return { message: `Saved mapping for ${groupDn}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to save role group mapping." };
  }
}

export async function updateRoleGroupAction(_: RoleGroupActionState, formData: FormData): Promise<RoleGroupActionState> {
  const user = await requireRole(["network_admin"]);
  const id = Number(formData.get("roleGroupId"));
  const role = String(formData.get("role")) as AppRole;
  const groupDn = String(formData.get("groupDn") || "").trim();
  const description = String(formData.get("description") || "").trim();

  if (!id) {
    return { error: "Role group mapping not found." };
  }
  if (!groupDn) {
    return { error: "Enter the Active Directory group distinguished name." };
  }

  try {
    updateRoleGroup({ id, role, groupDn, description });
    writeAudit({
      username: user.username,
      action: "admin.role_group.update",
      targetType: "role_group",
      targetId: String(id),
      status: "success",
      details: `Updated mapping ${groupDn} to ${role}.`
    });
    revalidatePath("/admin");
    return { message: `Updated mapping for ${groupDn}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to update role group mapping." };
  }
}

export async function deleteRoleGroupAction(_: RoleGroupActionState, formData: FormData): Promise<RoleGroupActionState> {
  const user = await requireRole(["network_admin"]);
  const id = Number(formData.get("roleGroupId"));
  const groupDn = String(formData.get("groupDn") || "").trim();

  if (!id) {
    return { error: "Role group mapping not found." };
  }

  try {
    deleteRoleGroup(id);
    writeAudit({
      username: user.username,
      action: "admin.role_group.delete",
      targetType: "role_group",
      targetId: String(id),
      status: "success",
      details: `Removed mapping ${groupDn || id}.`
    });
    revalidatePath("/admin");
    return { message: groupDn ? `Removed mapping for ${groupDn}.` : "Removed role group mapping." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to delete role group mapping." };
  }
}

type OuiActionState = { error?: string; message?: string } | undefined;

export async function saveOuiAction(_: OuiActionState, formData: FormData): Promise<OuiActionState> {
  const user = await requireRole(["network_admin"]);
  const teamRole = String(formData.get("teamRole")) as "telecom" | "fuel";
  const oui = String(formData.get("oui") || "").trim();
  const vendor = String(formData.get("vendor") || "").trim();

  try {
    addAllowedOui({ teamRole, oui, vendor });
    writeAudit({
      username: user.username,
      action: "admin.oui.save",
      targetType: "allowed_oui",
      targetId: oui,
      status: "success",
      details: `Added ${oui} for ${teamRole}.`
    });
    revalidatePath("/admin");
    return { message: `Saved OUI ${oui} for ${teamRole}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to save OUI." };
  }
}

export async function updateOuiAction(_: OuiActionState, formData: FormData): Promise<OuiActionState> {
  const user = await requireRole(["network_admin"]);
  const id = Number(formData.get("ouiId"));
  const teamRole = String(formData.get("teamRole")) as "telecom" | "fuel";
  const oui = String(formData.get("oui") || "").trim();
  const vendor = String(formData.get("vendor") || "").trim();

  if (!id) {
    return { error: "OUI record not found." };
  }

  try {
    updateAllowedOui({ id, teamRole, oui, vendor });
    writeAudit({
      username: user.username,
      action: "admin.oui.update",
      targetType: "allowed_oui",
      targetId: String(id),
      status: "success",
      details: `Updated OUI ${oui} for ${teamRole}.`
    });
    revalidatePath("/admin");
    return { message: `Updated OUI ${oui}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to update OUI." };
  }
}

export async function deleteOuiAction(_: OuiActionState, formData: FormData): Promise<OuiActionState> {
  const user = await requireRole(["network_admin"]);
  const id = Number(formData.get("ouiId"));
  const oui = String(formData.get("oui") || "").trim();
  const teamRole = String(formData.get("teamRole") || "").trim();

  if (!id) {
    return { error: "OUI record not found." };
  }

  try {
    deleteAllowedOui(id);
    writeAudit({
      username: user.username,
      action: "admin.oui.delete",
      targetType: "allowed_oui",
      targetId: String(id),
      status: "success",
      details: `Removed ${oui} for ${teamRole}.`
    });
    revalidatePath("/admin");
    return { message: `Removed OUI ${oui}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to delete OUI." };
  }
}

export async function saveSiteAction(
  _: { error?: string; message?: string } | undefined,
  formData: FormData
): Promise<{ error?: string; message?: string }> {
  const user = await requireRole(["network_admin"]);
  const siteNumber = String(formData.get("siteNumber") || "").trim();
  const name = String(formData.get("name") || "").trim();

  if (!siteNumber || !name) {
    return { error: "Site number and site name are required." };
  }

  const existing = siteByNumber(siteNumber);

  try {
    upsertSite({
      siteNumber,
      name,
      address1: String(formData.get("address1") || "").trim(),
      address2: String(formData.get("address2") || "").trim() || null,
      city: String(formData.get("city") || "").trim(),
      state: String(formData.get("state") || "").trim(),
      postalCode: String(formData.get("postalCode") || "").trim(),
      notes: String(formData.get("notes") || "").trim() || null
    });

    writeAudit({
      username: user.username,
      action: "admin.site.save",
      targetType: "site",
      targetId: siteNumber,
      status: "success",
      details: existing ? `Updated site ${siteNumber} from admin modal.` : `Saved site ${siteNumber} from admin modal.`
    });
    revalidatePath("/admin");
    return {
      message: existing ? `Site ${siteNumber} updated.` : `Site ${siteNumber} saved.`
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to save site." };
  }
}

export async function updateSiteAction(_: { error?: string; message?: string } | undefined, formData: FormData) {
  const user = await requireRole(["network_admin"]);
  const id = Number(formData.get("siteId"));
  const siteNumber = String(formData.get("siteNumber") || "").trim();
  const name = String(formData.get("name") || "").trim();

  if (!id || !siteNumber || !name) {
    return { error: "Site ID, site number, and site name are required." };
  }

  updateSite({
    id,
    siteNumber,
    name,
    address1: String(formData.get("address1") || "").trim(),
    address2: String(formData.get("address2") || "").trim() || null,
    city: String(formData.get("city") || "").trim(),
    state: String(formData.get("state") || "").trim(),
    postalCode: String(formData.get("postalCode") || "").trim(),
    notes: String(formData.get("notes") || "").trim() || null
  });

  writeAudit({
    username: user.username,
    action: "admin.site.update",
    targetType: "site",
    targetId: String(id),
    status: "success",
    details: `Updated site ${siteNumber} (${name}).`
  });
  revalidatePath("/admin");
  return { message: `Updated site ${siteNumber}.` };
}

type SiteDeleteActionState = { error?: string; message?: string } | undefined;

export async function deleteSiteAction(_: SiteDeleteActionState, formData: FormData): Promise<SiteDeleteActionState> {
  const user = await requireRole(["network_admin"]);
  const id = Number(formData.get("siteId"));
  const siteNumber = String(formData.get("siteNumber") || id);

  if (!id) {
    return { error: "Site record not found." };
  }

  try {
    deleteSite(id);
    writeAudit({
      username: user.username,
      action: "admin.site.delete",
      targetType: "site",
      targetId: String(id),
      status: "success",
      details: `Removed site ${siteNumber} and associated firewalls.`
    });
    revalidatePath("/admin");
    return { message: `Removed site ${siteNumber} and associated firewalls.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to remove site." };
  }
}

export async function deleteSiteFormAction(formData: FormData) {
  await deleteSiteAction(undefined, formData);
}

export async function bulkDeleteSitesAction(
  _: SiteDeleteActionState,
  formData: FormData
): Promise<SiteDeleteActionState> {
  const user = await requireRole(["network_admin"]);
  const ids = String(formData.get("siteIds") || "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (!ids.length) {
    return { error: "Select at least one site to remove." };
  }

  const siteNumbers = String(formData.get("siteNumbers") || "")
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean);

  try {
    for (const id of ids) {
      deleteSite(id);
    }

    writeAudit({
      username: user.username,
      action: "admin.site.bulk_delete",
      targetType: "site",
      targetId: ids.join(","),
      status: "success",
      details: `Removed ${ids.length} site(s): ${siteNumbers.join(", ") || ids.join(", ")}. Associated firewalls were removed.`
    });
    revalidatePath("/admin");
    return { message: `Removed ${ids.length} selected site${ids.length === 1 ? "" : "s"} and associated firewalls.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to remove selected sites." };
  }
}

export async function bulkUpdateSitesAction(_: { error?: string; message?: string } | undefined, formData: FormData) {
  const user = await requireRole(["network_admin"]);
  const targetField = String(formData.get("targetField") || "") as
    | "siteNumber"
    | "name"
    | "address1"
    | "address2"
    | "city"
    | "state"
    | "postalCode"
    | "notes";
  const formula = String(formData.get("formula") || "").trim();
  const selectedSiteIds = formData
    .getAll("siteIds")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
  const allowedFields = ["siteNumber", "name", "address1", "address2", "city", "state", "postalCode", "notes"] as const;
  const targetLabel = SITE_BULK_FIELD_LABELS[targetField] || "Field";

  if (!allowedFields.includes(targetField)) {
    return { error: "Choose a supported site field to bulk update." };
  }

  if (!formula) {
    return { error: "Enter a formula, for example Site {siteNumber} - {city}." };
  }

  if (selectedSiteIds.length === 0) {
    return { error: "Select at least one site before running a bulk update." };
  }

  const selectedIdSet = new Set(selectedSiteIds);
  const sites = listSites().filter((site) => selectedIdSet.has(site.id));
  for (const site of sites) {
    updateSiteTextField(site.id, targetField, renderSiteFormula(formula, site) || null);
  }

  writeAudit({
    username: user.username,
    action: "admin.site.bulk_update",
    targetType: "site",
    targetId: null,
    status: "success",
    details: `Updated ${targetLabel} for ${sites.length} sites using formula ${formula}.`
  });
  revalidatePath("/admin");
  return { message: `Updated ${targetLabel} for ${sites.length} sites.` };
}

const SITE_BULK_FIELD_LABELS: Record<string, string> = {
  siteNumber: "Site number",
  name: "Site name",
  address1: "Address 1",
  address2: "Address 2",
  city: "City",
  state: "State",
  postalCode: "Postal code",
  notes: "Notes"
};

export async function saveFirewallAction(
  _: { error?: string; message?: string } | undefined,
  formData: FormData
) {
  const user = await requireRole(["network_admin"]);
  const id = Number(formData.get("firewallId") || 0) || undefined;
  const siteId = Number(formData.get("siteId"));
  const plainToken = String(formData.get("apiToken") || "").trim();
  const ipAddress = String(formData.get("ipAddress") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const model = String(formData.get("model") || "").trim() || null;
  const serialNumber = String(formData.get("serialNumber") || "").trim() || null;
  const verifyTls = formData.get("verifyTls") === "on";
  const tokenIsPlaceholder = isStoredTokenPlaceholder(plainToken);
  const newApiToken = plainToken && !tokenIsPlaceholder ? plainToken : null;
  const tokenDetail = newApiToken ? "API token updated" : plainToken ? "API token kept" : "API token not set";
  const ipv4Pattern =
    /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

  if (!ipv4Pattern.test(ipAddress)) {
    return { error: "Enter a valid IPv4 address, for example 10.10.101.1." };
  }

  const existing = id ? listFirewalls().find((firewall) => firewall.id === id) : null;
  const fmgMode = isFortiManagerMode();

  if (newApiToken) {
    try {
      await FortinetClient.verifyAccess(ipAddress, newApiToken, verifyTls);
    } catch (caught) {
      return {
        error:
          caught instanceof Error
            ? `API token test failed for ${ipAddress}: ${caught.message}`
            : `API token test failed for ${ipAddress}.`
      };
    }
  } else if (!fmgMode && !existing?.apiTokenEncrypted && !id) {
    return { error: "Enter the FortiGate REST API token before saving a new firewall, or configure FortiManager." };
  }

  upsertFirewall({
    id,
    siteId,
    name,
    ipAddress,
    hostname: existing?.hostname ?? null,
    model,
    serialNumber,
    fmgDeviceName: existing?.fmgDeviceName ?? null,
    adom: existing?.adom ?? null,
    vdom: existing?.vdom ?? "root",
    apiTokenEncrypted: newApiToken ? encryptSecret(newApiToken) : null,
    verifyTls
  });

  writeAudit({
    username: user.username,
    action: "admin.firewall.save",
    targetType: "firewall",
    targetId: ipAddress,
    status: "success",
    details: `${id ? "Updated" : "Saved"} firewall ${name} (${ipAddress}) for site ID ${siteId}; model ${
      model || "none"
    }; serial ${serialNumber || "none"}; TLS ${verifyTls ? "verify" : "skip"}; ${tokenDetail}.`
  });
  revalidatePath("/admin");
  return { message: id ? "Firewall updated." : "Firewall saved." };
}

type FirewallDeleteActionState = { error?: string; message?: string } | undefined;

export async function deleteFirewallAction(
  _: FirewallDeleteActionState,
  formData: FormData
): Promise<FirewallDeleteActionState> {
  const user = await requireRole(["network_admin"]);
  const id = Number(formData.get("firewallId"));
  const name = String(formData.get("firewallName") || id);

  if (!id) {
    return { error: "Firewall record not found." };
  }

  try {
    deleteFirewall(id);
    writeAudit({
      username: user.username,
      action: "admin.firewall.delete",
      targetType: "firewall",
      targetId: String(id),
      status: "success",
      details: `Removed firewall ${name}.`
    });
    revalidatePath("/admin");
    return { message: `Removed firewall ${name}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to remove firewall." };
  }
}

export async function bulkDeleteFirewallsAction(
  _: FirewallDeleteActionState,
  formData: FormData
): Promise<FirewallDeleteActionState> {
  const user = await requireRole(["network_admin"]);
  const ids = String(formData.get("firewallIds") || "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (!ids.length) {
    return { error: "Select at least one firewall to remove." };
  }

  const names = String(formData.get("firewallNames") || "")
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean);

  try {
    for (const id of ids) {
      deleteFirewall(id);
    }

    writeAudit({
      username: user.username,
      action: "admin.firewall.bulk_delete",
      targetType: "firewall",
      targetId: ids.join(","),
      status: "success",
      details: `Removed ${ids.length} firewall(s): ${names.join(", ") || ids.join(", ")}.`
    });
    revalidatePath("/admin");
    return { message: `Removed ${ids.length} selected firewall${ids.length === 1 ? "" : "s"}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to remove selected firewalls." };
  }
}

export async function bulkUpdateFirewallsAction(
  _: { error?: string; message?: string } | undefined,
  formData: FormData
) {
  const user = await requireRole(["network_admin"]);
  const targetField = String(formData.get("targetField") || "") as
    | "name"
    | "model"
    | "serialNumber"
    | "apiToken"
    | "verifyTls";
  const formula = String(formData.get("formula") || "").trim();
  const selectedFirewallIds = formData
    .getAll("firewallIds")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
  const allowedFields = ["name", "model", "serialNumber", "apiToken", "verifyTls"] as const;
  const targetLabel = FIREWALL_BULK_FIELD_LABELS[targetField] || "Field";

  if (!allowedFields.includes(targetField)) {
    return { error: "Choose a supported field to bulk update." };
  }

  if (targetField === "apiToken" && isFortiManagerMode()) {
    return { error: "API tokens are managed by FortiManager. Remove the apiToken bulk update or disable FortiManager mode." };
  }

  if (!formula) {
    return { error: "Enter a formula, for example FW_{siteNumber}_{ipAddress}." };
  }

  if (selectedFirewallIds.length === 0) {
    return { error: "Select at least one firewall before running a bulk update." };
  }

  const selectedIdSet = new Set(selectedFirewallIds);
  const firewalls = listFirewalls().filter((firewall) => selectedIdSet.has(firewall.id));
  for (const firewall of firewalls) {
    const value = renderFirewallFormula(formula, firewall);
    if (targetField === "apiToken") {
      if (value) {
        try {
          await FortinetClient.verifyAccess(firewall.ipAddress, value, firewall.verifyTls);
        } catch (caught) {
          return {
            error:
              caught instanceof Error
                ? `API token test failed for ${firewall.ipAddress}: ${caught.message}`
                : `API token test failed for ${firewall.ipAddress}.`
          };
        }
      }
      updateFirewallApiToken(firewall.id, value ? encryptSecret(value) : null);
    } else if (targetField === "verifyTls") {
      updateFirewallTls(firewall.id, parseTlsFormulaValue(value));
    } else {
      updateFirewallTextField(firewall.id, targetField, value || null);
    }
  }

  writeAudit({
    username: user.username,
    action: "admin.firewall.bulk_update",
    targetType: "firewall",
    targetId: null,
    status: "success",
    details: `Updated ${targetLabel} for ${firewalls.length} firewalls using formula ${formula}.`
  });
  revalidatePath("/admin");
  return { message: `Updated ${targetLabel} for ${firewalls.length} firewalls.` };
}

const FIREWALL_BULK_FIELD_LABELS: Record<string, string> = {
  name: "Firewall name",
  model: "Model",
  serialNumber: "Serial number",
  apiToken: "API token",
  verifyTls: "TLS setting"
};

export async function importSitesAction(_: { message?: string; errors?: string[] } | undefined, formData: FormData) {
  const user = await requireRole(["network_admin"]);
  const csv = String(formData.get("csv") || "");
  const parsed = parseSiteCsv(csv);

  if (parsed.errors.length > 0) {
    writeAudit({
      username: user.username,
      action: "admin.site_import",
      targetType: "site",
      targetId: null,
      status: "error",
      details: parsed.errors.join("\n")
    });
    return { errors: parsed.errors };
  }

  for (const row of parsed.rows) {
    upsertSite({
      siteNumber: row.siteNumber,
      name: row.name,
      address1: row.address1,
      address2: row.address2 || null,
      city: row.city,
      state: row.state,
      postalCode: row.postalCode,
      notes: null
    });

    const site = siteByNumber(row.siteNumber);
    if (!site) {
      continue;
    }

    upsertFirewall({
      siteId: site.id,
      name: row.firewallName,
      ipAddress: row.ipAddress,
      hostname: null,
      model: row.model || null,
      serialNumber: row.serialNumber || null,
      fmgDeviceName: null,
      adom: null,
      vdom: "root",
      apiTokenEncrypted: null,
      verifyTls: true
    });
  }

  writeAudit({
    username: user.username,
    action: "admin.site_import",
    targetType: "site",
    targetId: null,
    status: "success",
    details: `Imported ${parsed.rows.length} site/firewall rows.`
  });
  revalidatePath("/admin");
  return { message: `Imported ${parsed.rows.length} rows.` };
}

type FormulaFirewall = ReturnType<typeof listFirewalls>[number];
type FormulaSite = ReturnType<typeof listSites>[number];

function renderFirewallFormula(formula: string, firewall: FormulaFirewall) {
  const values: Record<string, string> = {
    id: String(firewall.id),
    name: firewall.name,
    ipAddress: firewall.ipAddress,
    siteNumber: firewall.siteNumber,
    siteName: firewall.siteName,
    model: firewall.model || "",
    serialNumber: firewall.serialNumber || ""
  };

  return formula.replace(/\{([a-zA-Z]+)\}/g, (_, key: string) => values[key] ?? "");
}

function renderSiteFormula(formula: string, site: FormulaSite) {
  const values: Record<string, string> = {
    id: String(site.id),
    siteNumber: site.siteNumber,
    name: site.name,
    address1: site.address1,
    address2: site.address2 || "",
    city: site.city,
    state: site.state,
    postalCode: site.postalCode,
    notes: site.notes || "",
    firewallCount: String(site.firewallCount)
  };

  return formula.replace(/\{([a-zA-Z]+)\}/g, (_, key: string) => values[key] ?? "");
}

function parseTlsFormulaValue(value: string) {
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "y", "on", "verify", "enabled"].includes(normalized);
}

export async function testFirewallApiAction(
  _: { error?: string; message?: string } | undefined,
  formData: FormData
): Promise<{ error?: string; message?: string }> {
  await requireRole(["network_admin"]);
  const ipAddress = String(formData.get("ipAddress") || "").trim();
  const plainToken = String(formData.get("apiToken") || "").trim();
  const verifyTls = formData.get("verifyTls") === "on";
  const firewallId = Number(formData.get("firewallId") || 0) || undefined;
  const ipv4Pattern =
    /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

  if (!ipv4Pattern.test(ipAddress)) {
    return { error: "Enter a valid IPv4 address before testing API access." };
  }

  const existing = firewallId ? listFirewalls().find((firewall) => firewall.id === firewallId) : null;
  if (existing && isFirewallApiReady(existing) && isFortiManagerMode() && existing.fmgDeviceName) {
    try {
      const client = createFortinetClient(existing);
      await client.status();
      return {
        message: `Connection OK for ${existing.fmgDeviceName} (${ipAddress}) via FortiManager.`
      };
    } catch (caught) {
      return {
        error:
          caught instanceof Error
            ? `FortiManager proxy failed for ${existing.fmgDeviceName}: ${caught.message}`
            : `FortiManager proxy failed for ${existing.fmgDeviceName}.`
      };
    }
  }

  if (isFortiManagerMode() && !existing?.fmgDeviceName) {
    return { error: "Sync devices from FortiManager first so this firewall has a managed device name." };
  }

  let tokenToTest = isStoredTokenPlaceholder(plainToken) ? "" : plainToken;
  if (!tokenToTest && firewallId) {
    if (existing?.apiTokenEncrypted) {
      try {
        await FortinetClient.verifyAccess(
          ipAddress,
          decryptSecret(existing.apiTokenEncrypted),
          verifyTls
        );
        return { message: `Connection OK for ${ipAddress} using the stored API token.` };
      } catch (caught) {
        return {
          error:
            caught instanceof Error
              ? `Stored token failed for ${ipAddress}: ${caught.message}`
              : `Stored token failed for ${ipAddress}.`
        };
      }
    }
  }

  if (!tokenToTest) {
    return { error: "Paste an API token to test, or save one on this firewall first." };
  }

  try {
    await FortinetClient.verifyAccess(ipAddress, tokenToTest, verifyTls);
    return { message: `Connection OK for ${ipAddress}.` };
  } catch (caught) {
    return {
      error:
        caught instanceof Error
          ? `API token test failed for ${ipAddress}: ${caught.message}`
          : `API token test failed for ${ipAddress}.`
    };
  }
}

export async function loadFirewallLiveHardwareAction(firewallIds: number[]): Promise<FirewallLiveHardwareRow[]> {
  await requireRole(["network_admin"]);
  const idSet = new Set(firewallIds.filter((id) => Number.isInteger(id) && id > 0));
  const firewalls = listFirewalls().filter((firewall) => idSet.has(firewall.id));

  return Promise.all(
    firewalls.map(async (firewall) => {
      const live = await getFirewallLiveHardware(firewall);
      return {
        id: firewall.id,
        model: live.model,
        serialNumber: live.serialNumber,
        hostname: live.hostname,
        storedModel: firewall.model,
        storedSerialNumber: firewall.serialNumber,
        storedHostname: firewall.hostname,
        liveModel: live.liveModel,
        liveSerialNumber: live.liveSerialNumber,
        liveHostname: live.liveHostname,
        apiStatus: live.apiStatus,
        error: live.error
      };
    })
  );
}

export async function syncFirewallHardwareToDbAction(
  firewallIds: number[]
): Promise<{ error?: string; message?: string; synced?: number }> {
  const user = await requireRole(["network_admin"]);
  const idSet = firewallIds.filter((id) => Number.isInteger(id) && id > 0);

  if (!idSet.length) {
    return { error: "Select at least one firewall in the table before saving live data." };
  }

  const rows = await loadFirewallLiveHardwareAction(idSet);
  let synced = 0;

  for (const row of rows) {
    if (row.apiStatus !== "online") {
      continue;
    }

    const model = row.liveModel;
    const serialNumber = row.liveSerialNumber;
    const hostname = row.liveHostname;
    if (!model && !serialNumber && !hostname) {
      continue;
    }

    if (model && model !== row.storedModel) {
      updateFirewallTextField(row.id, "model", model);
    }
    if (serialNumber && serialNumber !== row.storedSerialNumber) {
      updateFirewallTextField(row.id, "serialNumber", serialNumber);
    }
    if (hostname && hostname !== row.storedHostname) {
      updateFirewallTextField(row.id, "hostname", hostname);
    }

    writeAudit({
      username: user.username,
      action: "admin.firewall.sync_hardware",
      targetType: "firewall",
      targetId: String(row.id),
      status: "success",
      details: `Synced hostname ${hostname || row.storedHostname || "unchanged"}, model ${
        model || row.storedModel || "unchanged"
      }, and serial ${serialNumber || row.storedSerialNumber || "unchanged"} from FortiGate API.`
    });
    synced += 1;
  }

  revalidatePath("/admin");
  return {
    message:
      synced > 0
        ? `Saved FortiGate hostname, model, and serial for ${synced} selected firewall${synced === 1 ? "" : "s"}.`
        : "No selected firewalls returned live hostname, model, or serial data to save.",
    synced
  };
}
