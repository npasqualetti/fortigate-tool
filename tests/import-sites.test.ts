import assert from "node:assert/strict";
import test from "node:test";
import { parseSiteCsv } from "../src/lib/import-sites";

test("parses valid site CSV rows", () => {
  const result = parseSiteCsv(`siteNumber,name,address1,city,state,postalCode,firewallName,ipAddress
101,Main Office,1 Main St,Atlanta,GA,30301,FGT-101,10.0.0.1`);

  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].siteNumber, "101");
  assert.equal(result.rows[0].ipAddress, "10.0.0.1");
});

test("reports duplicate site numbers and invalid IPs", () => {
  const result = parseSiteCsv(`siteNumber,name,address1,city,state,postalCode,firewallName,ipAddress
101,Main Office,1 Main St,Atlanta,GA,30301,FGT-101,10.0.0.1
101,Branch,2 Main St,Atlanta,GA,30302,FGT-102,not-an-ip`);

  assert.equal(result.rows.length, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /ipAddress/);
});
