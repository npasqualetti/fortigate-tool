import assert from "node:assert/strict";
import test from "node:test";
import { deviceRowId, isFortigatePingInterface, isPingableIpv4 } from "../src/lib/ping-utils.ts";

test("isPingableIpv4 accepts normal addresses", () => {
  assert.equal(isPingableIpv4("10.0.0.100"), true);
  assert.equal(isPingableIpv4("192.168.1.1"), true);
});

test("isPingableIpv4 rejects unknown and invalid values", () => {
  assert.equal(isPingableIpv4("unknown"), false);
  assert.equal(isPingableIpv4("not-an-ip"), false);
  assert.equal(isPingableIpv4("999.1.1.1"), false);
});

test("isFortigatePingInterface rejects switch port refs", () => {
  assert.equal(isFortigatePingInterface("internal"), true);
  assert.equal(isFortigatePingInterface("S108FFTV21013920/port8"), false);
  assert.equal(isFortigatePingInterface("unknown"), false);
});

test("deviceRowId is stable", () => {
  assert.equal(
    deviceRowId({ interfaceName: "lan", macAddress: "AA:BB:CC:DD:EE:FF", ipAddress: "10.0.0.1" }),
    "lan|AA:BB:CC:DD:EE:FF|10.0.0.1"
  );
});
