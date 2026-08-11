import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSwitchAliasIndex,
  buildSwitchMacIndex,
  correlatePortsWithLearnedDevices,
  enrichLearnedDevicesWithSwitchPorts,
  findManagedSwitchPort,
  matchPortKeys,
  parseManagedSwitchInventory,
  parseUserDeviceSwitchPorts
} from "../src/lib/fortinet/switch-port-enrichment.ts";

test("parseManagedSwitchInventory reads nested switch ports", () => {
  const refs = parseManagedSwitchInventory({
    results: [
      {
        name: "S524DF4K15000024",
        ports: [
          { name: "port5", sticky_mac: "AA:BB:CC:DD:EE:FF" },
          { name: "port6" }
        ]
      }
    ]
  });

  assert.equal(refs.length, 2);
  assert.equal(refs[0].switchId, "S524DF4K15000024");
  assert.equal(refs[0].portName, "port5");
  assert.equal(refs[0].macAddress, "AA:BB:CC:DD:EE:FF");
});

test("enrichLearnedDevicesWithSwitchPorts maps ARP rows to switch serial/port", () => {
  const enriched = enrichLearnedDevicesWithSwitchPorts(
    [
      {
        interfaceName: "port5",
        ipAddress: "10.1.1.50",
        macAddress: "AA:BB:CC:DD:EE:FF"
      }
    ],
    [{ switchId: "S524DF4K15000024", portName: "port5" }]
  );

  assert.equal(enriched[0].interfaceName, "S524DF4K15000024/port5");
});

test("enrichLearnedDevicesWithSwitchPorts maps by IP when MAC is only on the switch port table", () => {
  const enriched = enrichLearnedDevicesWithSwitchPorts(
    [
      {
        interfaceName: "vlan100",
        ipAddress: "10.1.1.50",
        macAddress: "AA:BB:CC:DD:EE:01"
      }
    ],
    [{ switchId: "S524DF4K15000024", portName: "port5", ipAddress: "10.1.1.50" }]
  );

  assert.equal(enriched[0].interfaceName, "S524DF4K15000024/port5");
});

test("enrichLearnedDevicesWithSwitchPorts maps by MAC when port names differ", () => {
  const enriched = enrichLearnedDevicesWithSwitchPorts(
    [
      {
        interfaceName: "vlan100",
        ipAddress: "10.1.1.50",
        macAddress: "AA:BB:CC:DD:EE:FF"
      }
    ],
    [{ switchId: "S524DF4K15000024", portName: "port5", macAddress: "AA:BB:CC:DD:EE:FF" }]
  );

  assert.equal(enriched[0].interfaceName, "S524DF4K15000024/port5");
});

test("findManagedSwitchPort resolves controller switch id and port name", () => {
  const inventory = {
    results: [
      {
        name: "FSW-A",
        serial: "S108FFTV21013920",
        ports: [{ name: "port8" }]
      }
    ]
  };

  assert.deepEqual(findManagedSwitchPort(inventory, "S108FFTV21013920", "port8"), {
    switchId: "S108FFTV21013920",
    port: "port8"
  });
});

test("correlatePortsWithLearnedDevices joins ARP rows when switch name and serial differ", () => {
  const inventory = {
    results: [
      {
        name: "FSW-A",
        serial: "S108FFTV21013920",
        ports: [{ name: "port8" }]
      }
    ]
  };
  const aliases = buildSwitchAliasIndex(inventory);
  const portRefs = parseManagedSwitchInventory(inventory);
  const portInfo = correlatePortsWithLearnedDevices(
    portRefs,
    [
      {
        interfaceName: "vlan100",
        ipAddress: "10.1.1.50",
        macAddress: "AA:BB:CC:DD:EE:FF"
      }
    ],
    aliases
  );

  assert.equal(portInfo.get("S108FFTV21013920/port8")?.macAddress, undefined);

  const portInfoWithLiveMac = correlatePortsWithLearnedDevices(
    [{ switchId: "FSW-A", portName: "port8", macAddress: "AA:BB:CC:DD:EE:FF" }],
    [
      {
        interfaceName: "vlan100",
        ipAddress: "10.1.1.50",
        macAddress: "AA:BB:CC:DD:EE:FF"
      }
    ],
    aliases
  );

  assert.equal(portInfoWithLiveMac.get("S108FFTV21013920/port8")?.macAddress, "AA:BB:CC:DD:EE:FF");
  assert.equal(portInfoWithLiveMac.get("S108FFTV21013920/port8")?.ipAddress, "10.1.1.50");
});

test("parseUserDeviceSwitchPorts maps detected_interface via master switch MAC", () => {
  const inventory = {
    results: [{ name: "FSW-A", serial: "S108FFTV21013920", mac: "11:22:33:44:55:66" }]
  };
  const parsed = parseUserDeviceSwitchPorts(
    {
      results: [
        {
          mac: "aa:bb:cc:dd:ee:ff",
          ipv4_address: "10.1.1.50",
          hostname: "phone-1",
          detected_interface: "port8",
          master_mac: "11:22:33:44:55:66"
        }
      ]
    },
    {
      switchMacIndex: buildSwitchMacIndex(inventory),
      switchAliasIndex: buildSwitchAliasIndex(inventory)
    }
  );

  assert.equal(parsed.devices[0]?.interfaceName, "S108FFTV21013920/port8");
  assert.equal(parsed.devices[0]?.ipAddress, "10.1.1.50");
});

test("matchPortKeys treats port name variants as equal", () => {
  const aliases = buildSwitchAliasIndex({
    results: [{ name: "FSW-A", serial: "S108FFTV21013920" }]
  });
  assert.equal(matchPortKeys("FSW-A/Port8", "S108FFTV21013920/port8", aliases), true);
});

test("parseUserDeviceSwitchPorts maps Device Inventory rows to switch/port", () => {
  const parsed = parseUserDeviceSwitchPorts({
    results: [
      {
        mac: "aa:bb:cc:dd:ee:ff",
        ip: "10.1.1.50",
        hostname: "phone-1",
        interface: "S108FFTV21013920/port8"
      }
    ]
  });

  assert.equal(parsed.devices.length, 1);
  assert.equal(parsed.devices[0].interfaceName, "S108FFTV21013920/port8");
  assert.equal(parsed.portRefs[0]?.switchId, "S108FFTV21013920");
  assert.equal(parsed.portRefs[0]?.portName, "port8");
});
