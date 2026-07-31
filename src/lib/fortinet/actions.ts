"use server";

import { createFortinetClient } from "@/lib/fortinet/create-client";
import { firewallConnectionLabel, isFirewallApiReady } from "@/lib/fortinet/connectivity";
import type { PoeResetActionState, PoeWorkspaceState } from "@/lib/fortinet/poe-workspace";
import { requireRole } from "@/lib/auth/session";
import { getFirewall, listAllowedOuis, listFirewalls, writeAudit } from "@/lib/db";
import { getOuiFromMac, isOuiAllowed } from "@/lib/mac";
import {
  getFirewallWorkspaceSnapshot,
  runFirewallCableTest,
  runFirewallPing
} from "@/lib/fortinet/firewall-workspace";
import { getFirewallOverview } from "@/lib/fortinet/overview";

type PoeTeamRole = "telecom" | "fuel";
const FIREWALL_TOOL_ROLES = ["network_admin", "help_desk", "telecom", "fuel"] as const;

export async function loadFirewallOverviewAction(firewallIds: number[]) {
  await requireRole([...FIREWALL_TOOL_ROLES]);
  const requestedIds = new Set(firewallIds.filter((id) => Number.isInteger(id) && id > 0));
  const firewalls = listFirewalls().filter((firewall) => requestedIds.has(firewall.id));
  return Promise.all(firewalls.map(getFirewallOverview));
}

export async function loadFirewallWorkspaceAction(firewallId: number) {
  await requireRole([...FIREWALL_TOOL_ROLES]);
  const firewall = getFirewall(Number(firewallId));
  if (!firewall) {
    return { error: "Firewall not found." };
  }
  return getFirewallWorkspaceSnapshot(firewall);
}

export async function refreshFirewallWorkspaceAction(
  _: { error?: string; snapshot?: Awaited<ReturnType<typeof getFirewallWorkspaceSnapshot>> } | undefined,
  formData: FormData
) {
  await requireRole([...FIREWALL_TOOL_ROLES]);
  const firewallId = Number(formData.get("firewallId"));
  const firewall = getFirewall(firewallId);
  if (!firewall) {
    return { error: "Firewall not found." };
  }

  try {
    const snapshot = await getFirewallWorkspaceSnapshot(firewall);
    return { snapshot };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to refresh firewall workspace." };
  }
}

export async function pingFirewallHostAction(
  _: { error?: string; result?: Awaited<ReturnType<typeof runFirewallPing>> } | undefined,
  formData: FormData
) {
  const user = await requireRole([...FIREWALL_TOOL_ROLES]);
  const firewallId = Number(formData.get("firewallId"));
  const host = String(formData.get("host") || "").trim();
  const interfaceName = String(formData.get("interfaceName") || "").trim() || undefined;
  const firewall = getFirewall(firewallId);

  if (!firewall) {
    return { error: "Firewall not found." };
  }
  if (!host) {
    return { error: "Enter a host or IP address to ping." };
  }

  try {
    const result = await runFirewallPing(firewall, host, { interfaceName });
    writeAudit({
      username: user.username,
      action: "fortinet.ping",
      targetType: "firewall",
      targetId: `${firewall.ipAddress}:${host}`,
      status: result.reachable ? "success" : "error",
      details: `Ping ${host} via ${result.source}: ${result.reachable ? "reachable" : "unreachable"}.`
    });
    return { result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ping failed.";
    writeAudit({
      username: user.username,
      action: "fortinet.ping",
      targetType: "firewall",
      targetId: `${firewall.ipAddress}:${host}`,
      status: "error",
      details: message
    });
    return { error: message };
  }
}

export async function cableTestFirewallInterfaceAction(
  _: { error?: string; result?: Awaited<ReturnType<typeof runFirewallCableTest>> } | undefined,
  formData: FormData
) {
  const user = await requireRole([...FIREWALL_TOOL_ROLES]);
  const firewallId = Number(formData.get("firewallId"));
  const interfaceName = String(formData.get("interfaceName") || "").trim();
  const firewall = getFirewall(firewallId);

  if (!firewall) {
    return { error: "Firewall not found." };
  }
  if (!interfaceName) {
    return { error: "Select an interface for the cable test." };
  }

  try {
    const result = await runFirewallCableTest(firewall, interfaceName);
    writeAudit({
      username: user.username,
      action: "fortinet.cable_test",
      targetType: "firewall_port",
      targetId: `${firewall.ipAddress}:${interfaceName}`,
      status: result.supported && result.status !== "fail" ? "success" : "error",
      details: result.summary || result.error || `Cable test ${result.status}.`
    });
    return { result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cable test failed.";
    writeAudit({
      username: user.username,
      action: "fortinet.cable_test",
      targetType: "firewall_port",
      targetId: `${firewall.ipAddress}:${interfaceName}`,
      status: "error",
      details: message
    });
    return { error: message };
  }
}

export async function cableTestFirewallInterfacesAction(
  _: {
    error?: string;
    message?: string;
    results?: Array<Awaited<ReturnType<typeof runFirewallCableTest>>>;
  } | undefined,
  formData: FormData
) {
  const user = await requireRole([...FIREWALL_TOOL_ROLES]);
  const firewallId = Number(formData.get("firewallId"));
  const firewall = getFirewall(firewallId);

  if (!firewall) {
    return { error: "Firewall not found." };
  }

  const interfaceNames = [
    ...new Set(
      formData
        .getAll("interfaceName")
        .map((value) => String(value).trim())
        .filter(Boolean)
    )
  ];

  if (interfaceNames.length === 0) {
    return { error: "Select at least one device to run a cable test." };
  }

  try {
    const results = await Promise.all(
      interfaceNames.map((interfaceName) => runFirewallCableTest(firewall, interfaceName))
    );
    const failed = results.filter((result) => !result.supported || result.status === "fail").length;

    writeAudit({
      username: user.username,
      action: "fortinet.cable_test",
      targetType: "firewall",
      targetId: firewall.ipAddress,
      status: failed === results.length ? "error" : "success",
      details: `Cable test on ${interfaceNames.length} interface(s): ${results.length - failed} ok, ${failed} failed/unsupported.`
    });

    return {
      message: `Cable test finished for ${interfaceNames.length} interface${interfaceNames.length === 1 ? "" : "s"}.`,
      results
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cable test failed.";
    writeAudit({
      username: user.username,
      action: "fortinet.cable_test",
      targetType: "firewall",
      targetId: firewall.ipAddress,
      status: "error",
      details: message
    });
    return { error: message };
  }
}

function policyRoleForUser(user: Awaited<ReturnType<typeof requireRole>>, formData: FormData): PoeTeamRole {
  return user.roles.includes("network_admin")
    ? (String(formData.get("teamRole") || "telecom") as PoeTeamRole)
    : user.roles.includes("telecom")
      ? "telecom"
      : "fuel";
}

export async function loadPoeWorkspaceAction(
  _: PoeWorkspaceState | undefined,
  formData: FormData
): Promise<PoeWorkspaceState> {
  const user = await requireRole(["network_admin", "telecom", "fuel"]);
  const firewallId = Number(formData.get("firewallId"));
  const firewall = getFirewall(firewallId);

  if (!firewall) {
    return { error: "Firewall not found." };
  }
  if (!isFirewallApiReady(firewall)) {
    return { error: "This firewall is not connected. Configure FortiManager or an API token in Admin." };
  }

  const teamRole = policyRoleForUser(user, formData);
  const allowedOuis = listAllowedOuis(teamRole).map((oui) => oui.oui);
  if (allowedOuis.length === 0) {
    return {
      error: `No allowed OUIs are configured for ${teamRole}. Add OUIs in Admin before loading ports.`
    };
  }

  try {
    const client = createFortinetClient(firewall);
    const ports = (await client.listPoePorts()).map((port) => {
      let oui: string | undefined;
      if (port.macAddress) {
        try {
          oui = getOuiFromMac(port.macAddress);
        } catch {
          oui = undefined;
        }
      }
      return {
        ...port,
        oui,
        ouiApproved: port.macAddress ? isOuiAllowed(port.macAddress, allowedOuis) : false
      };
    });

    writeAudit({
      username: user.username,
      action: "fortinet.poe_workspace",
      targetType: "firewall",
      targetId: firewall.ipAddress,
      status: "success",
      details: `Loaded ${ports.length} managed switch ports on ${firewall.name}.`
    });

    const approvedCount = ports.filter((port) => port.ouiApproved).length;
    return {
      message:
        ports.length > 0
          ? `Loaded ${ports.length} port${ports.length === 1 ? "" : "s"} on ${firewall.name}. ${approvedCount} match ${teamRole} approved OUIs.`
          : `No managed FortiSwitch ports were returned for ${firewall.name}. Confirm switch-controller is enabled and the device is managed.`,
      ports,
      allowedOuis,
      connectionLabel: firewallConnectionLabel(firewall),
      firewallName: firewall.name
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to load switch ports." };
  }
}

export async function poeResetAction(_: PoeResetActionState, formData: FormData): Promise<PoeResetActionState> {
  const user = await requireRole(["network_admin", "telecom", "fuel"]);
  const firewallId = Number(formData.get("firewallId"));
  const portName = String(formData.get("portName") || "").trim();
  const enteredMac = String(formData.get("macAddress") || "").trim();
  const firewall = getFirewall(firewallId);

  if (!firewall) {
    return { error: "Firewall not found." };
  }

  const teamRole = policyRoleForUser(user, formData);

  try {
    const client = createFortinetClient(firewall);
    const resolvedPort = await client.resolvePoePort(portName, enteredMac);
    const learnedMac = enteredMac || (await client.learnedMac(resolvedPort, enteredMac));

    if (!learnedMac) {
      writeAudit({
        username: user.username,
        action: "fortinet.poe_reset",
        targetType: "firewall_port",
        targetId: `${firewall.ipAddress}:${portName}`,
        status: "denied",
        details: "No learned MAC was available for OUI validation."
      });
      return { error: "No learned MAC address was found for that port. Enter the observed MAC or check the port." };
    }

    const allowed = listAllowedOuis(teamRole).map((oui) => oui.oui);
    const observedOui = getOuiFromMac(learnedMac);
    if (!isOuiAllowed(learnedMac, allowed)) {
      writeAudit({
        username: user.username,
        action: "fortinet.poe_reset",
        targetType: "firewall_port",
        targetId: `${firewall.ipAddress}:${portName}`,
        status: "denied",
        details: `Observed OUI ${observedOui} is not allowed for ${teamRole}.`
      });
      return { error: `Blocked. MAC OUI ${observedOui} is not approved for ${teamRole}.` };
    }

    const result = await client.resetPoe(resolvedPort);
    writeAudit({
      username: user.username,
      action: "fortinet.poe_reset",
      targetType: "firewall_port",
      targetId: `${firewall.ipAddress}:${resolvedPort}`,
      status: "success",
      details: `POE reset via ${result.method}. Command: ${result.command || resolvedPort}. MAC ${learnedMac}, OUI ${observedOui}, role ${teamRole}.`
    });
    return {
      message: `PoE reset sent to ${firewall.name} port ${resolvedPort} via ${result.method}.`,
      method: result.method,
      command: result.command,
      portKey: resolvedPort
    };
  } catch (error) {
    writeAudit({
      username: user.username,
      action: "fortinet.poe_reset",
      targetType: "firewall_port",
      targetId: `${firewall.ipAddress}:${portName}`,
      status: "error",
      details: error instanceof Error ? error.message : "Unknown Fortinet error."
    });
    return { error: error instanceof Error ? error.message : "Fortinet request failed." };
  }
}

export async function searchApprovedDevicesAction(
  _: {
    error?: string;
    message?: string;
    devices?: Array<{ interfaceName: string; ipAddress: string; macAddress: string; oui: string }>;
    totalLearned?: number;
    allowedOuis?: string[];
  } | undefined,
  formData: FormData
) {
  const user = await requireRole(["network_admin", "telecom", "fuel"]);
  const firewallId = Number(formData.get("firewallId"));
  const firewall = getFirewall(firewallId);

  if (!firewall) {
    return { error: "Firewall not found." };
  }

  const teamRole = policyRoleForUser(user, formData);
  const allowedOuis = listAllowedOuis(teamRole).map((oui) => oui.oui);

  if (allowedOuis.length === 0) {
    return {
      error: `No allowed OUIs are configured for ${teamRole}. Add OUIs in Admin before searching.`
    };
  }

  try {
    const client = createFortinetClient(firewall);
    const sourceResult = await client.learnedDeviceSources();
    const learned = sourceResult.devices
      .map((device) => {
        try {
          return {
            ...device,
            oui: getOuiFromMac(device.macAddress)
          };
        } catch {
          return null;
        }
      })
      .filter((device): device is NonNullable<typeof device> => Boolean(device));

    const devices = learned.filter((device) => isOuiAllowed(device.macAddress, allowedOuis));

    writeAudit({
      username: user.username,
      action: "fortinet.approved_device_search",
      targetType: "firewall",
      targetId: firewall.ipAddress,
      status: "success",
      details: `Found ${devices.length} of ${learned.length} learned devices matching ${teamRole} allowed OUIs on ${firewall.name} (${firewall.ipAddress}).`
    });

    const allowedLabel = allowedOuis.join(", ");
    return {
      message:
        devices.length > 0
          ? `Found ${devices.length} approved learned device${devices.length === 1 ? "" : "s"}.`
          : learned.length > 0
            ? `Found ${learned.length} learned device${learned.length === 1 ? "" : "s"} on the FortiGate, but none match ${teamRole} allowed OUIs (${allowedLabel}).`
            : `No learned devices were returned from ARP/DHCP or switch telemetry on ${firewall.name}. Use Device finder above to inspect sources.`,
      devices,
      totalLearned: learned.length,
      allowedOuis
    };
  } catch (error) {
    writeAudit({
      username: user.username,
      action: "fortinet.approved_device_search",
      targetType: "firewall",
      targetId: firewall.ipAddress,
      status: "error",
      details: error instanceof Error ? error.message : "Unknown Fortinet search error."
    });
    return { error: error instanceof Error ? error.message : "Fortinet device search failed." };
  }
}

export async function findDevicesByOuiAction(
  _: {
    error?: string;
    message?: string;
    devices?: Array<{
      interfaceName: string;
      ipAddress: string;
      macAddress: string;
      oui: string;
      deviceName?: string;
    }>;
    diagnostics?: Array<{ path: string; records: number; devices: number; error?: string; note?: string }>;
  } | undefined,
  formData: FormData
) {
  const user = await requireRole([...FIREWALL_TOOL_ROLES]);
  const firewallId = Number(formData.get("firewallId"));
  const enteredOui = String(formData.get("ouiPrefix") || "").trim();
  const findAll = formData.get("intent") === "findAll";
  const firewall = getFirewall(firewallId);

  if (!firewall) {
    return { error: "Firewall not found." };
  }

  let targetOui: string | null = null;
  if (!findAll) {
    try {
      targetOui = getOuiFromMac(enteredOui);
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Enter the first 6 hexadecimal characters of the MAC." };
    }
  }

  try {
    const client = createFortinetClient(firewall);
    const sourceResult = await client.learnedDeviceSources();
    const devices = sourceResult.devices
      .map((device) => {
        try {
          return {
            ...device,
            oui: getOuiFromMac(device.macAddress)
          };
        } catch {
          return null;
        }
      })
      .filter((device): device is NonNullable<typeof device> => Boolean(device))
      .filter((device) => (targetOui ? device.oui === targetOui : true));

    writeAudit({
      username: user.username,
      action: "fortinet.device_finder",
      targetType: "firewall",
      targetId: firewall.ipAddress,
      status: "success",
      details: targetOui
        ? `Found ${devices.length} learned devices matching OUI ${targetOui} on ${firewall.name} (${firewall.ipAddress}).`
        : `Found ${devices.length} learned devices on ${firewall.name} (${firewall.ipAddress}).`
    });

    return {
      message: targetOui
        ? `Found ${devices.length} learned device${devices.length === 1 ? "" : "s"} matching ${targetOui}.`
        : `Found ${devices.length} learned device${devices.length === 1 ? "" : "s"}.`,
      devices,
      diagnostics: sourceResult.diagnostics
    };
  } catch (error) {
    writeAudit({
      username: user.username,
      action: "fortinet.device_finder",
      targetType: "firewall",
      targetId: firewall.ipAddress,
      status: "error",
      details: error instanceof Error ? error.message : "Unknown Fortinet device finder error."
    });
    return { error: error instanceof Error ? error.message : "Device finder failed." };
  }
}
