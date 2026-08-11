import "server-only";

import { mergeAssetIdentityRows, mapLearnedDevicesToAssetRows, mapPoePortsToAssetRows } from "@/lib/assets/ingest";
import { createFortinetClient } from "@/lib/fortinet/create-client";
import type { Firewall } from "@/lib/types";

export async function collectFirewallAssetRows(firewall: Firewall) {
  const client = createFortinetClient(firewall);
  const [learned, ports] = await Promise.all([client.learnedDeviceSources(), client.listPoePorts()]);

  return mergeAssetIdentityRows(
    mapLearnedDevicesToAssetRows(learned.devices),
    mapPoePortsToAssetRows(
      ports.map((port) => ({
        portKey: port.portKey,
        switchId: port.switchId,
        portName: port.portName,
        macAddress: port.macAddress,
        ipAddress: port.ipAddress
      }))
    )
  );
}
