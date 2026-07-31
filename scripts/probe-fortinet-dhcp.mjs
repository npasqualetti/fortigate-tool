import Database from "better-sqlite3";
import { decryptSecret } from "../src/lib/crypto.ts";
import { buildFortinetRequestHeaders, buildFortinetRequestUrl } from "../src/lib/fortinet/api-auth.ts";

const db = new Database("./data/app.db");
const row = db.prepare("SELECT ip_address, api_token_encrypted FROM firewalls WHERE ip_address=?").get("10.0.0.1");
if (!row?.api_token_encrypted) {
  console.error("No firewall at 10.0.0.1");
  process.exit(1);
}

const token = decryptSecret(row.api_token_encrypted).trim();
const ip = row.ip_address;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const paths = ["/api/v2/monitor/network/arp", "/api/v2/monitor/system/dhcp"];

for (const path of paths) {
  const url = buildFortinetRequestUrl(`https://${ip}`, path, token, "bearer");
  const res = await fetch(url, {
    headers: buildFortinetRequestHeaders(token, undefined, "bearer"),
    signal: AbortSignal.timeout(10000)
  });
  const body = await res.text();
  console.log(`\n=== ${path} (${res.status}) ===`);
  try {
    const json = JSON.parse(body);
    console.log(JSON.stringify(json, null, 2).slice(0, 5000));
    const results = json.results;
    console.log("results type:", Array.isArray(results) ? `array[${results.length}]` : typeof results);
    if (results && typeof results === "object" && !Array.isArray(results)) {
      console.log("results keys:", Object.keys(results).slice(0, 20));
    }
  } catch {
    console.log(body.slice(0, 500));
  }
}
