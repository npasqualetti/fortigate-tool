import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFortinetBaseUrl,
  buildFortinetRequestHeaders,
  buildFortinetRequestUrl,
  getFortinetApiAuthMode,
  getFortinetAuthModesToTry
} from "../src/lib/fortinet/api-auth.ts";

const originalAuth = process.env.FORTINET_API_AUTH;
const originalVdom = process.env.FORTINET_API_VDOM;
const originalPort = process.env.FORTINET_API_PORT;

test.after(() => {
  if (originalAuth === undefined) {
    delete process.env.FORTINET_API_AUTH;
  } else {
    process.env.FORTINET_API_AUTH = originalAuth;
  }
  if (originalVdom === undefined) {
    delete process.env.FORTINET_API_VDOM;
  } else {
    process.env.FORTINET_API_VDOM = originalVdom;
  }
  if (originalPort === undefined) {
    delete process.env.FORTINET_API_PORT;
  } else {
    process.env.FORTINET_API_PORT = originalPort;
  }
});

test("buildFortinetBaseUrl uses https and optional FORTINET_API_PORT", () => {
  delete process.env.FORTINET_API_PORT;
  assert.equal(buildFortinetBaseUrl("10.0.0.1"), "https://10.0.0.1");

  process.env.FORTINET_API_PORT = "9443";
  assert.equal(buildFortinetBaseUrl("10.0.0.1"), "https://10.0.0.1:9443");
  assert.equal(buildFortinetBaseUrl("10.0.0.1:9443"), "https://10.0.0.1:9443");
  assert.equal(buildFortinetBaseUrl("https://fg.example/"), "https://fg.example");
});

test("defaults to auto auth for mixed FortiOS versions", () => {
  delete process.env.FORTINET_API_AUTH;
  assert.equal(getFortinetApiAuthMode(), "auto");
  assert.deepEqual(getFortinetAuthModesToTry(), ["bearer", "query"]);
});

test("query mode uses access_token only", () => {
  process.env.FORTINET_API_AUTH = "query";
  assert.equal(getFortinetApiAuthMode(), "query");
  assert.deepEqual(getFortinetAuthModesToTry(), ["query"]);

  const url = buildFortinetRequestUrl(
    "https://10.0.0.1",
    "/api/v2/monitor/system/status",
    "secret-token",
    "query"
  );
  assert.equal(url, "https://10.0.0.1/api/v2/monitor/system/status?access_token=secret-token");
  assert.equal(buildFortinetRequestHeaders("secret-token").Authorization, undefined);
});

test("supports bearer auth when configured", () => {
  process.env.FORTINET_API_AUTH = "bearer";
  assert.deepEqual(getFortinetAuthModesToTry(), ["bearer"]);

  const url = buildFortinetRequestUrl(
    "https://10.0.0.1",
    "/api/v2/monitor/system/status",
    "secret-token",
    "bearer"
  );
  assert.equal(url, "https://10.0.0.1/api/v2/monitor/system/status");
  const headers = buildFortinetRequestHeaders("secret-token", undefined, "bearer");
  const authorization = headers.Authorization || headers.authorization;
  assert.equal(authorization, "Bearer secret-token");
});

test("auto mode tries bearer then query", () => {
  process.env.FORTINET_API_AUTH = "auto";
  assert.equal(getFortinetApiAuthMode(), "auto");
  assert.deepEqual(getFortinetAuthModesToTry(), ["bearer", "query"]);
});

test("preserves existing query parameters when appending access_token", () => {
  delete process.env.FORTINET_API_AUTH;
  const url = buildFortinetRequestUrl(
    "https://10.0.0.1",
    "/api/v2/monitor/system/status?vdom=root",
    "secret-token",
    "query"
  );
  assert.equal(url, "https://10.0.0.1/api/v2/monitor/system/status?vdom=root&access_token=secret-token");
});

test("appends configured vdom when missing from path", () => {
  delete process.env.FORTINET_API_AUTH;
  process.env.FORTINET_API_VDOM = "root";
  const url = buildFortinetRequestUrl(
    "https://10.0.0.1",
    "/api/v2/monitor/system/status",
    "secret-token",
    "query"
  );
  assert.equal(url, "https://10.0.0.1/api/v2/monitor/system/status?vdom=root&access_token=secret-token");
});
