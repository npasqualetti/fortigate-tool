export type WanLinkDefinition = {
  interfaceName: string;
  label: string;
};

/** Primary WAN used to reach the ISP modem (default gateway on this interface). */
export const DEFAULT_ISP_GATEWAY_INTERFACE = "npu0_vlink1";

const DEFAULT_WAN_LINKS: WanLinkDefinition[] = [
  { interfaceName: "npu0_vlink1", label: "Broadband" },
  { interfaceName: "wan2", label: "Cellular" }
];

export function getWanLinkDefinitions(): WanLinkDefinition[] {
  const raw = process.env.FORTINET_WAN_LINKS?.trim();
  if (!raw) {
    return DEFAULT_WAN_LINKS;
  }

  const parsed = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [interfaceName, label] = entry.split(":").map((part) => part.trim());
      if (!interfaceName) {
        return null;
      }
      return {
        interfaceName,
        label: label || interfaceName
      };
    })
    .filter((entry): entry is WanLinkDefinition => Boolean(entry));

  return parsed.length > 0 ? parsed : DEFAULT_WAN_LINKS;
}

export function getIspGatewayInterfaceName() {
  return process.env.FORTINET_ISP_GATEWAY_INTERFACE?.trim() || DEFAULT_ISP_GATEWAY_INTERFACE;
}
