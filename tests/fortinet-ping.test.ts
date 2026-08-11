import assert from "node:assert/strict";
import test from "node:test";
import {
  isConclusiveFortinetPingResult,
  normalizeFortinetPingRaw,
  parseFortinetCliPingOutput,
  parseFortinetPingPayload,
  parseFortinetPingResponse
} from "../src/lib/fortinet/ping.ts";

test("parseFortinetPingResponse handles standard FortiOS results object", () => {
  const { parsed } = parseFortinetPingResponse({
    status: "success",
    results: {
      host: "10.0.0.25",
      packets_sent: 4,
      packets_received: 4,
      packet_loss: 0,
      min_rtt: 0.4,
      avg_rtt: 0.8,
      max_rtt: 1.1
    }
  });

  assert.equal(parsed.reachable, true);
  assert.equal(parsed.avgRttMs, 0.8);
  assert.equal(parsed.packetsReceived, 4);
});

test("parseFortinetPingResponse handles array results and alternate field names", () => {
  const { parsed } = parseFortinetPingResponse({
    status: "success",
    results: [
      {
        destination: "10.0.0.30",
        packet_transmit: 1,
        packet_receive: 1,
        packet_loss_rate: 0,
        rtt_min: 1.2,
        rtt_avg: 1.2,
        rtt_max: 1.2
      }
    ]
  });

  assert.equal(parsed.reachable, true);
  assert.equal(parsed.avgRttMs, 1.2);
  assert.equal(parsed.packetsReceived, 1);
});

test("parseFortinetCliPingOutput reads execute ping console text", () => {
  const result = parseFortinetCliPingOutput([
    "PING 10.0.0.25 (10.0.0.25): 56 data bytes",
    "64 bytes from 10.0.0.25: icmp_seq=0 ttl=64 time=1.2 ms",
    "",
    "--- 10.0.0.25 ping statistics ---",
    "4 packets transmitted, 4 packets received, 0% packet loss",
    "round-trip min/avg/max = 1.1/1.2/1.3 ms"
  ]);

  assert.equal(result.conclusive, true);
  assert.equal(result.parsed.reachable, true);
  assert.equal(result.parsed.avgRttMs, 1.2);
  assert.equal(result.parsed.packetsReceived, 4);
});

test("empty monitor array is inconclusive", () => {
  const raw = normalizeFortinetPingRaw({ status: "success", results: [] });
  const parsed = parseFortinetPingPayload(raw);
  assert.equal(isConclusiveFortinetPingResult(parsed, raw), false);
});

test("zero replies with sent packets is conclusive unreachable", () => {
  const raw = {
    host: "10.0.0.99",
    packets_sent: 4,
    packets_received: 0,
    packet_loss: 100
  };
  const parsed = parseFortinetPingPayload(raw);
  assert.equal(parsed.reachable, false);
  assert.equal(isConclusiveFortinetPingResult(parsed, raw), true);
});
