import { test } from "node:test";
import assert from "node:assert/strict";
import { ablativeSuffix } from "./turkish.ts";

test("ayrılma eki", () => {
  assert.equal(ablativeSuffix(2026), "dan");
  assert.equal(ablativeSuffix(2027), "den");
  assert.equal(ablativeSuffix(2024), "ten");
  assert.equal(ablativeSuffix(2030), "dan");
  assert.equal(ablativeSuffix(2040), "tan");
  assert.equal(ablativeSuffix(2000), "den");
  assert.equal(ablativeSuffix(2100), "den");
});
