import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_TABLE_PAGE_SIZE } from "../src/hooks/use-table-pagination.ts";

test("DEFAULT_TABLE_PAGE_SIZE is 10", () => {
  assert.equal(DEFAULT_TABLE_PAGE_SIZE, 10);
});
