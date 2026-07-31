export type FortinetApiAuthMode = "query" | "bearer" | "auto";

const AUTH_MODE_LABELS: Record<Exclude<FortinetApiAuthMode, "auto">, string> = {
  query: "access_token query parameter",
  bearer: "Authorization Bearer header"
};

export function getFortinetApiAuthMode(): FortinetApiAuthMode {
  const configured = process.env.FORTINET_API_AUTH?.trim().toLowerCase();
  if (configured === "bearer") {
    return "bearer";
  }
  if (configured === "query") {
    return "query";
  }
  // Default auto: FortiOS 7.2.x (80F) uses ?access_token=; FortiOS 7.4+ (91G lab) uses Bearer.
  return "auto";
}

export function getFortinetAuthModesToTry(): Array<Exclude<FortinetApiAuthMode, "auto">> {
  const mode = getFortinetApiAuthMode();
  if (mode === "auto") {
    // Bearer first: FortiOS 7.4+ (91G lab). Falls back to query for FortiOS 7.2.x (80F prod).
    return ["bearer", "query"];
  }
  return [mode];
}

export function formatFortinetAuthModeLabel(mode: Exclude<FortinetApiAuthMode, "auto">) {
  return AUTH_MODE_LABELS[mode];
}

/** HTTPS base URL for FortiGate REST API (host is usually the firewall IP from inventory). */
export function buildFortinetBaseUrl(host: string) {
  const trimmed = host.trim();
  if (!trimmed) {
    throw new Error("Fortinet host is required.");
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, "");
  }

  const hostHasPort = /:\d+$/.test(trimmed);
  const port = process.env.FORTINET_API_PORT?.trim();
  if (hostHasPort || !port) {
    return `https://${trimmed}`;
  }

  return `https://${trimmed}:${port}`;
}

function appendVdomToPath(path: string) {
  const vdom = process.env.FORTINET_API_VDOM?.trim();
  if (!vdom) {
    return path;
  }

  const [pathname, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  if (!params.has("vdom")) {
    params.set("vdom", vdom);
  }

  const queryString = params.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

export function buildFortinetRequestUrl(
  baseUrl: string,
  path: string,
  token: string | null,
  mode: Exclude<FortinetApiAuthMode, "auto">
) {
  const url = new URL(appendVdomToPath(path), baseUrl);
  if (mode === "query" && token) {
    url.searchParams.set("access_token", token);
  }
  return url.toString();
}

export function buildFortinetRequestHeaders(
  token: string | null,
  initHeaders?: HeadersInit,
  mode: Exclude<FortinetApiAuthMode, "auto"> = "query"
): Record<string, string> {
  const headers = new Headers(initHeaders);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (mode === "bearer" && token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return Object.fromEntries(headers.entries());
}

export function formatFortinet401Help(authModesTried: Array<Exclude<FortinetApiAuthMode, "auto">>) {
  const tried = authModesTried.map((mode) => formatFortinetAuthModeLabel(mode)).join(", then ");
  const triedBoth = authModesTried.length > 1;
  return (
    `Authentication failed (401) using ${tried}. ` +
    (triedBoth
      ? "The FortiGate rejected the stored API token (both methods were tried). "
      : "") +
    "Create or copy a new REST API token under System → Administrators, paste it in Admin → Firewalls, " +
    "and ensure Trusted Hosts includes this app server. " +
    "If you use a non-root VDOM, set FORTINET_API_VDOM=your-vdom in .env."
  );
}
