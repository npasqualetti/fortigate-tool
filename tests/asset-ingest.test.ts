import assert from "node:assert/strict";
import test from "node:test";
import {
  mapLearnedDevicesToAssetRows,
  mapPoePortsToAssetRows,
  mergeAssetIdentityRows
} from "../src/lib/assets/ingest.ts";

test("mapLearnedDevicesToAssetRows normalizes switch port mappings", () => {
  const rows = mapLearnedDevicesToAssetRows([
    {
      interfaceName: "S108FFTV21013920/port8",
      ipAddress: "10.1.1.50",
      macAddress: "AA:BB:CC:DD:EE:FF",
      deviceName: "phone-1"
    },
    {
      interfaceName: "vlan100",
      ipAddress: "10.1.1.51",
      macAddress: "AA-BB-CC-DD-EE-01"
    }
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].switchPort, "S108FFTV21013920/port8");
  assert.equal(rows[0].oui, "AA:BB:CC");
  assert.equal(rows[1].macAddress, "AA:BB:CC:DD:EE:01");
  assert.equal(rows[1].switchPort, null);
});

test("mergeAssetIdentityRows combines learned devices with switch port telemetry", () => {
  const merged = mergeAssetIdentityRows(
    mapLearnedDevicesToAssetRows([
      {
        interfaceName: "vlan100",
        ipAddress: "unknown",
        macAddress: "AA:BB:CC:DD:EE:FF"
      }
    ]),
    mapPoePortsToAssetRows([
      {
        portKey: "S108FFTV21013920/port8",
        switchId: "S108FFTV21013920",
        portName: "port8",
        macAddress: "AA:BB:CC:DD:EE:FF",
        ipAddress: "10.6.0.2"
      }
    ])
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.ipAddress, "10.6.0.2");
  assert.equal(merged[0]?.switchPort, "S108FFTV21013920/port8");
});
