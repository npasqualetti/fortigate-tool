import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "../src/lib/auth/password";

test("hashes and verifies bootstrap admin passwords", () => {
  const hash = hashPassword("ChangeMe123!");

  assert.equal(verifyPassword("ChangeMe123!", hash), true);
  assert.equal(verifyPassword("wrong-password", hash), false);
});
