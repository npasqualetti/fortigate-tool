import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFortinetPoeCliCommands,
  buildFortinetPoeResetAttempts,
  buildPrimaryPoeResetAttempts,
  isFortinetNotFoundError,
  isFortinetRetryablePoeError,
  parseFortinetPoeTarget,
  validatePoeResetResponse,
  assertFortiManagerScriptSucceeded
} from "../src/lib/fortinet/poe-reset.ts";

test("parseFortinetPoeTarget splits switch serial and port", () => {
  assert.deepEqual(parseFortinetPoeTarget("S524DF4K15000024/port5"), {
    switchId: "S524DF4K15000024",
    port: "port5",
    input: "S524DF4K15000024/port5"
  });
  assert.deepEqual(parseFortinetPoeTarget("S524DF4K15000024:port5"), {
    switchId: "S524DF4K15000024",
    port: "port5",
    input: "S524DF4K15000024:port5"
  });
  assert.deepEqual(parseFortinetPoeTarget("port5"), {
    port: "port5",
    input: "port5"
  });
});

test("buildFortinetPoeResetAttempts includes switch and port bodies", () => {
  const attempts = buildFortinetPoeResetAttempts("/api/v2/monitor/switch-controller/poe-reset", {
    switchId: "FSW1",
    port: "port3",
    input: "FSW1/port3"
  });

  assert.ok(attempts.some((attempt) => attempt.body.switch === "FSW1" && attempt.body.port === "port3"));
  assert.ok(attempts.some((attempt) => attempt.body.port === "FSW1/port3"));
});

test("buildPrimaryPoeResetAttempts uses mkey and both REST paths", () => {
  const attempts = buildPrimaryPoeResetAttempts({
    switchId: "FSW1",
    port: "port8",
    input: "FSW1/port8"
  });
  assert.ok(attempts.length >= 4);
  assert.ok(attempts.some((attempt) => attempt.body.mkey === "FSW1" && attempt.body.port === "port8"));
  assert.ok(attempts.some((attempt) => attempt.path.includes("managed-switch/poe-reset")));
  assert.ok(attempts.some((attempt) => attempt.path.includes("system/fsw/poe-reset")));
});

test("buildFortinetPoeCliCommands includes legacy poe-reset syntax", () => {
  const commands = buildFortinetPoeCliCommands({
    switchId: "S108FFTV21013920",
    port: "port8",
    input: "S108FFTV21013920/port8"
  });
  assert.equal(commands.length, 2);
  assert.match(commands[0], /switch-action poe reset/);
  assert.match(commands[1], /poe-reset S108FFTV21013920 port8/);
});

test("assertFortiManagerScriptSucceeded rejects empty execute payloads", () => {
  assert.throws(
    () => assertFortiManagerScriptSucceeded({}, "execute switch-controller poe-reset FSW port8"),
    /did not return FortiGate output/i
  );
});

test("validatePoeResetResponse rejects empty success payloads", () => {
  assert.throws(() => validatePoeResetResponse({}), /empty response/i);
  assert.throws(() => validatePoeResetResponse({ status: "error", message: "Invalid switch" }), /invalid switch/i);
  assert.doesNotThrow(() => validatePoeResetResponse({ status: "success" }));
  assert.doesNotThrow(() => validatePoeResetResponse({ status: "success", results: {} }));
});

test("isFortinetRetryablePoeError treats invalid url as retryable", () => {
  assert.equal(isFortinetRetryablePoeError(new Error("Invalid url")), true);
  assert.equal(isFortinetRetryablePoeError(new Error("Fortinet request failed: 404 Not Found")), true);
  assert.equal(isFortinetRetryablePoeError(new Error("permission denied")), false);
});

test("isFortinetNotFoundError detects 404 messages", () => {
  assert.equal(isFortinetNotFoundError(new Error("Fortinet request failed: 404 Not Found")), true);
  assert.equal(isFortinetNotFoundError(new Error("timeout")), false);
});
