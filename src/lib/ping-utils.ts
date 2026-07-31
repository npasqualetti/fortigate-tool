const IPV4_PATTERN =
  /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

export function isPingableIpv4(ip: string) {
  const trimmed = ip.trim();
  if (!IPV4_PATTERN.test(trimmed)) {
    return false;
  }
  if (trimmed === "0.0.0.0" || trimmed === "255.255.255.255") {
    return false;
  }
  return true;
}

export function deviceRowId(device: { interfaceName: string; macAddress: string; ipAddress: string }) {
  return `${device.interfaceName}|${device.macAddress}|${device.ipAddress}`;
}
