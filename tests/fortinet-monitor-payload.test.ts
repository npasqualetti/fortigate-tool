import assert from "node:assert/strict";
import test from "node:test";
import { resolveFortinetMonitorResults } from "../src/lib/fortinet/monitor-payload.ts";

test("returns array results for ARP and DHCP monitor endpoints", () => {
  const dhcpPayload = {
    status: "success",
    results: [
      { ip: "10.1.0.10", mac: "10:a5:1d:82:b0:5e", interface: "lan", hostname: "Nick" }
    ]
  };

  const parsed = resolveFortinetMonitorResults(dhcpPayload);
  assert.equal(Array.isArray(parsed), true);
  assert.equal((parsed as Array<Record<string, unknown>>).length, 1);
});

test("merges object results for system status style payloads", () => {
  const statusPayload = {
    status: "success",
    results: { model: "FGT91G", hostname: "Gandalf-91G-01" },
    serial: "FGT91GTK23008352"
  };

  const parsed = resolveFortinetMonitorResults(statusPayload) as Record<string, unknown>;
  assert.equal(parsed.model, "FGT91G");
  assert.equal(parsed.hostname, "Gandalf-91G-01");
  assert.equal(parsed.serial, "FGT91GTK23008352");
});
