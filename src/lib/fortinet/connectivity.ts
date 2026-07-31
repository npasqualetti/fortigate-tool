import type { Firewall } from "@/lib/types";
import { isFortiManagerMode } from "@/lib/fortinet/create-client";

export function isFirewallApiReady(firewall: Pick<Firewall, "apiTokenEncrypted" | "fmgDeviceName">) {
  if (firewall.fmgDeviceName && isFortiManagerMode()) {
    return true;
  }
  return Boolean(firewall.apiTokenEncrypted);
}

export function firewallConnectionLabel(firewall: Pick<Firewall, "apiTokenEncrypted" | "fmgDeviceName">) {
  if (firewall.fmgDeviceName && isFortiManagerMode()) {
    return "FortiManager";
  }
  return firewall.apiTokenEncrypted ? "Direct API token" : "Not configured";
}
