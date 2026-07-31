import assert from "node:assert/strict";
import test from "node:test";
import { formatFortigateModelLabel } from "../src/lib/fortinet/hardware-label.ts";

test("formatFortigateModelLabel maps FGT codes to FortiGate labels", () => {
  assert.equal(formatFortigateModelLabel("FGT91G"), "FortiGate 91G");
  assert.equal(formatFortigateModelLabel("FGT_80F"), "FortiGate 80F");
  assert.equal(formatFortigateModelLabel("91G"), "FortiGate 91G");
});

test("formatFortigateModelLabel ignores generic FortiGate name", () => {
  assert.equal(formatFortigateModelLabel("FortiGate"), null);
});
