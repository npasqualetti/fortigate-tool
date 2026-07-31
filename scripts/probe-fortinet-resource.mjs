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

const paths = [
  "/api/v2/monitor/system/resource/usage",
  "/api/v2/monitor/system/resource",
  "/api/v2/monitor/system/status"
];

for (const path of paths) {
  const url = buildFortinetRequestUrl(`https://${ip}`, path, token, "bearer");
  const res = await fetch(url, {
    headers: buildFortinetRequestHeaders(token, undefined, "bearer"),
    signal: AbortSignal.timeout(8000)
  });
  const body = await res.text();
  console.log(`\n=== ${path} (${res.status}) ===`);
  try {
    const json = JSON.parse(body);
    if (path.includes("resource/usage") && json.results) {
      const results = json.results;
      console.log("keys:", Object.keys(results));
      for (const [key, value] of Object.entries(results)) {
        if (Array.isArray(value) && value[0]) {
          console.log(`  ${key}[0].current =`, value[0].current);
        }
      }
    } else {
      console.log(JSON.stringify(json, null, 2).slice(0, 1500));
    }
  } catch {
    console.log(body.slice(0, 500));
  }
}
