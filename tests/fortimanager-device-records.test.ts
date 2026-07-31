import test from "node:test";
import assert from "node:assert/strict";
import {
  flattenExpandMemberDevices,
  flattenRpcDataRecords
} from "../src/lib/fortimanager/device-records";
import { mapFortiManagerDeviceRecord } from "../src/lib/fortimanager/devices";

test("flattenRpcDataRecords parses array responses", () => {
  const records = flattenRpcDataRecords([
    {
      status: { code: 0, message: "OK" },
      data: [
        { name: "fgt-branch-1", sn: "FGT123", os_type: "fos" },
        { name: "fgt-branch-2", sn: "FGT456", os_type: "fos" }
      ]
    }
  ]);

  assert.equal(records.length, 2);
  assert.equal(records[0]?.name, "fgt-branch-1");
});

test("flattenRpcDataRecords uses object keys as device names", () => {
  const records = flattenRpcDataRecords([
    {
      status: { code: 0, message: "OK" },
      data: {
        "fgt-branch-1": { sn: "FGT123", os_type: "fos" }
      }
    }
  ]);

  assert.equal(records.length, 1);
  assert.equal(records[0]?.name, "fgt-branch-1");
});

test("flattenExpandMemberDevices parses ADOM expand member responses", () => {
  const records = flattenExpandMemberDevices([
    {
      status: { code: 0, message: "OK" },
      data: [
        {
          name: "root",
          "expand member": {
            device: [{ name: "fgt-branch-1", sn: "FGT123", os_type: "fos" }]
          }
        }
      ]
    }
  ]);

  assert.equal(records.length, 1);
  assert.equal(records[0]?.name, "fgt-branch-1");
  assert.equal(records[0]?.adom, "root");
});

test("flattenRpcDataRecords reads ADOM from extra info", () => {
  const records = flattenRpcDataRecords([
    {
      status: { code: 0, message: "OK" },
      data: [
        {
          name: "fgt-branch-1",
          sn: "FGT123",
          "extra info": { adom: "root" }
        }
      ]
    }
  ]);

  assert.equal(records.length, 1);
  assert.equal(records[0]?.adom, "root");
});

test("mapFortiManagerDeviceRecord keeps FortiGate devices and drops analyzers", () => {
  assert.equal(mapFortiManagerDeviceRecord({ name: "fgt-1", os_type: "fos" })?.name, "fgt-1");
  assert.equal(mapFortiManagerDeviceRecord({ name: "faz-1", os_type: "faz" }), null);
  assert.equal(mapFortiManagerDeviceRecord({ name: "fgt-2" })?.name, "fgt-2");
});
