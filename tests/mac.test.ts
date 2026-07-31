import assert from "node:assert/strict";
import test from "node:test";
import { getOuiFromMac, isOuiAllowed, normalizeOui } from "../src/lib/mac";

test("normalizes common OUI formats", () => {
  assert.equal(normalizeOui("aa-bb-cc"), "AA:BB:CC");
  assert.equal(normalizeOui("aabbccddeeff"), "AA:BB:CC");
  assert.equal(getOuiFromMac("aa:bb:cc:dd:ee:ff"), "AA:BB:CC");
});

test("checks whether a MAC address is allowed by OUI", () => {
  assert.equal(isOuiAllowed("AA:BB:CC:11:22:33", ["aa-bb-cc"]), true);
  assert.equal(isOuiAllowed("AA:BB:CD:11:22:33", ["aa-bb-cc"]), false);
});

test("rejects short OUIs", () => {
  assert.throws(() => normalizeOui("abcd"), /at least six/);
});
