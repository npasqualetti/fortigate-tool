import assert from "node:assert/strict";
import test from "node:test";
import { dnsDomainToBaseDn } from "../src/lib/ad-settings.ts";

test("dnsDomainToBaseDn converts DNS domain to LDAP base DN", () => {
  assert.equal(dnsDomainToBaseDn("corp.example.local"), "DC=corp,DC=example,DC=local");
});
