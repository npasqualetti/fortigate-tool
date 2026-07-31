import assert from "node:assert/strict";
import test from "node:test";
import {
  extractResourceUsagePercent,
  formatUsagePercent
} from "../src/lib/fortinet/resource-usage.ts";

test("parses FortiOS resource/usage cpu and mem arrays", () => {
  const payload = {
    cpu: [{ current: 12, historical: {} }],
    mem: [{ current: 23, historical: {} }]
  };

  assert.equal(extractResourceUsagePercent(payload, "cpu"), "12%");
  assert.equal(extractResourceUsagePercent(payload, "memory"), "23%");
});

test("formats fractional usage as percent", () => {
  assert.equal(formatUsagePercent(0.42), "42%");
  assert.equal(formatUsagePercent(67), "67%");
});

test("parses flat cpu and memory fields", () => {
  const payload = { cpu_usage: 8, memory_usage: 51 };
  assert.equal(extractResourceUsagePercent(payload, "cpu"), "8%");
  assert.equal(extractResourceUsagePercent(payload, "memory"), "51%");
});
