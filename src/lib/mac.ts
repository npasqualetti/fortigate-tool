export function normalizeOui(value: string): string {
  const hex = value.replace(/[^a-fA-F0-9]/g, "").toUpperCase();

  if (hex.length < 6) {
    throw new Error("OUI must contain at least six hexadecimal characters.");
  }

  return `${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4, 6)}`;
}

export function getOuiFromMac(macAddress: string): string {
  return normalizeOui(macAddress);
}

export function isOuiAllowed(macAddress: string, allowedOuis: string[]): boolean {
  const candidate = getOuiFromMac(macAddress);
  return allowedOuis.map(normalizeOui).includes(candidate);
}
