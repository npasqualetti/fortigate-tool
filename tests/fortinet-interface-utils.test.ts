import assert from "node:assert/strict";
import test from "node:test";
import { findInterfaceByName, formatLinkSpeed, parseInterfaceLinkFields } from "../src/lib/fortinet/interface-utils.ts";

test("parseInterfaceLinkFields formats speed and duplex", () => {
  const parsed = parseInterfaceLinkFields({ speed: 1000, duplex: "full" });
  assert.equal(parsed.speed, "1 Gbps");
  assert.equal(parsed.duplex, "full-duplex");
});

test("findInterfaceByName matches interface name case-insensitively", () => {
  const match = findInterfaceByName(
    [{ name: "npu0_vlink1", status: "up", speed: "100 Mbps", duplex: "full-duplex" }],
    "NPU0_VLINK1"
  );
  assert.equal(match?.name, "npu0_vlink1");
});

test("formatLinkSpeed joins speed and duplex", () => {
  assert.equal(formatLinkSpeed({ speed: "100 Mbps", duplex: "full-duplex" }), "100 Mbps · full-duplex");
});
