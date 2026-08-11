export function parseStoredTimestamp(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(trimmed)) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const sqliteMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?$/);
  if (sqliteMatch) {
    const parsed = new Date(`${sqliteMatch[1]}T${sqliteMatch[2]}${sqliteMatch[3] || ""}Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatStoredTimestamp(value: string | null | undefined) {
  if (!value) {
    return "—";
  }

  const parsed = parseStoredTimestamp(value);
  if (parsed) {
    return parsed.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    });
  }

  return value;
}
