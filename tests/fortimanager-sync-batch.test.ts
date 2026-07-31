import assert from "node:assert/strict";
import test from "node:test";
import { getFortiManagerSyncBatchSize, getSyncBatchSlice } from "../src/lib/fortimanager/sync-batch.ts";

test("getSyncBatchSlice returns batches of the requested size", () => {
  const devices = Array.from({ length: 12 }, (_, index) => ({
    name: `FGT${index}`,
    serialNumber: null,
    ipAddress: null,
    hostname: null,
    model: null,
    osVersion: null,
    connectionStatus: null,
    osType: null,
    adom: null
  }));

  const first = getSyncBatchSlice(devices, 0, 5);
  assert.equal(first.batch.length, 5);
  assert.equal(first.processed, 5);
  assert.equal(first.complete, false);
  assert.equal(first.nextOffset, 5);

  const last = getSyncBatchSlice(devices, 10, 5);
  assert.equal(last.batch.length, 2);
  assert.equal(last.processed, 12);
  assert.equal(last.complete, true);
});

test("getFortiManagerSyncBatchSize defaults to 25", () => {
  assert.equal(getFortiManagerSyncBatchSize(), 25);
});
