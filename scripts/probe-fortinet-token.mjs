import Database from "better-sqlite3";
import { decryptSecret } from "../src/lib/crypto.ts";
import {
  buildFortinetRequestHeaders,
  buildFortinetRequestUrl,
  getFortinetAuthModesToTry
} from "../src/lib/fortinet/api-auth.ts";

const db = new Database("./data/app.db");
const rows = db
  .prepare("SELECT id, name, ip_address, api_token_encrypted, verify_tls FROM firewalls")
  .all();

console.log("FORTINET_API_AUTH=", process.env.FORTINET_API_AUTH || "(default auto)");
console.log("modes to try:", getFortinetAuthModesToTry());

for (const row of rows) {
  const ip = row.ip_address;
  let token = "";
  try {
    token = row.api_token_encrypted ? decryptSecret(row.api_token_encrypted).trim() : "";
  } catch (error) {
    console.log(`\n${row.name}: decrypt failed —`, error.message);
    continue;
  }

  console.log(`\n--- ${row.name} (${ip}) token length=${token.length} verify_tls=${row.verify_tls}`);

  for (const mode of ["bearer", "query"]) {
    const url = buildFortinetRequestUrl(`https://${ip}`, "/api/v2/monitor/system/status", token, mode);
    const headers = buildFortinetRequestHeaders(token, undefined, mode);
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      const body = await res.text();
      console.log(`  ${mode}: ${res.status} ${body.slice(0, 100).replace(/\n/g, " ")}`);
    } catch (error) {
      console.log(`  ${mode}: ERROR ${error.message}`);
    }
  }
}
