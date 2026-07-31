export function formatFortigateModelLabel(value: string) {
  const trimmed = value.trim();
  const fgtMatch = trimmed.match(/^FGT[_-]?(.+)$/i);
  if (fgtMatch?.[1]) {
    return `FortiGate ${fgtMatch[1].replace(/_/g, "")}`;
  }

  if (/^fortigate$/i.test(trimmed)) {
    return null;
  }

  if (/^fortigate[-\s_]/i.test(trimmed)) {
    return trimmed.replace(/^fortigate/i, "FortiGate");
  }

  if (/^[0-9]{1,3}[A-Za-z]?$/i.test(trimmed)) {
    return `FortiGate ${trimmed.toUpperCase()}`;
  }

  return trimmed;
}

export function isGenericFortigateModel(value: string) {
  return /^fortigate$/i.test(value.trim());
}
