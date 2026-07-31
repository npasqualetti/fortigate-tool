import { z } from "zod";

const importRowSchema = z.object({
  siteNumber: z.string().min(1),
  name: z.string().min(1),
  address1: z.string().min(1),
  address2: z.string().optional().default(""),
  city: z.string().min(1),
  state: z.string().min(1),
  postalCode: z.string().min(1),
  firewallName: z.string().min(1),
  ipAddress: z.string().refine(isIpAddress, "must be a valid IP address"),
  model: z.string().optional().default(""),
  serialNumber: z.string().optional().default("")
});

export type ImportRow = z.infer<typeof importRowSchema>;

export type ImportResult = {
  rows: ImportRow[];
  errors: string[];
};

const headerAliases: Record<string, keyof ImportRow> = {
  "site number": "siteNumber",
  site_number: "siteNumber",
  sitenumber: "siteNumber",
  "site name": "name",
  name: "name",
  address: "address1",
  address1: "address1",
  address2: "address2",
  city: "city",
  state: "state",
  zip: "postalCode",
  postalcode: "postalCode",
  postal_code: "postalCode",
  "firewall name": "firewallName",
  firewallname: "firewallName",
  ip: "ipAddress",
  "ip address": "ipAddress",
  ipaddress: "ipAddress",
  model: "model",
  serial: "serialNumber",
  serialnumber: "serialNumber",
  serial_number: "serialNumber"
};

export function parseSiteCsv(csv: string): ImportResult {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return { rows: [], errors: ["CSV must include a header row and at least one data row."] };
  }

  const headers = splitCsvLine(lines[0]).map((header) => headerAliases[normalizeHeader(header)] || normalizeHeader(header));
  const rows: ImportRow[] = [];
  const errors: string[] = [];
  const seenSites = new Set<string>();
  const seenIps = new Set<string>();

  lines.slice(1).forEach((line, index) => {
    const values = splitCsvLine(line);
    const raw: Record<string, string> = {};
    headers.forEach((header, headerIndex) => {
      raw[header] = values[headerIndex]?.trim() || "";
    });

    const parsed = importRowSchema.safeParse(raw);
    const rowNumber = index + 2;

    if (!parsed.success) {
      errors.push(`Row ${rowNumber}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join(", ")}`);
      return;
    }

    if (seenSites.has(parsed.data.siteNumber)) {
      errors.push(`Row ${rowNumber}: duplicate site number ${parsed.data.siteNumber} in import file.`);
      return;
    }

    if (seenIps.has(parsed.data.ipAddress)) {
      errors.push(`Row ${rowNumber}: duplicate firewall IP ${parsed.data.ipAddress} in import file.`);
      return;
    }

    seenSites.add(parsed.data.siteNumber);
    seenIps.add(parsed.data.ipAddress);
    rows.push(parsed.data);
  });

  return { rows, errors };
}

function normalizeHeader(header: string) {
  return header.toLowerCase().replace(/[^a-z0-9_ ]/g, "").trim();
}

function isIpAddress(value: string) {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => {
      if (!/^\d+$/.test(part)) {
        return false;
      }
      const octet = Number(part);
      return octet >= 0 && octet <= 255 && String(octet) === part.replace(/^0+(?=\d)/, "");
    })
  );
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}
