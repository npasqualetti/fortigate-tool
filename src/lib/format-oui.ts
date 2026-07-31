export function formatOuiInput(value: string) {
  const hex = value.replace(/[^a-fA-F0-9]/g, "").slice(0, 6).toUpperCase();
  if (hex.length <= 2) {
    return hex;
  }
  if (hex.length <= 4) {
    return `${hex.slice(0, 2)}:${hex.slice(2)}`;
  }
  return `${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4)}`;
}
