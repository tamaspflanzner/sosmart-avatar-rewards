const { test } = require("node:test");
const assert = require("node:assert/strict");
const { sqlLimit } = require("../lib/sqlLimit");

test("LIMIT bindings are integer strings accepted by MySQL prepared statements", () => {
  assert.equal(sqlLimit("8", 50, 200), "8");
  assert.equal(sqlLimit(8.9, 50, 200), "8");
  assert.equal(sqlLimit(-10, 50, 200), "1");
  assert.equal(sqlLimit(5000, 50, 200), "200");
});

test("invalid and missing limits use a bounded default", () => {
  for (const input of [undefined, null, "", "invalid", "1; DROP TABLE events", Infinity, NaN]) {
    assert.equal(sqlLimit(input, 50, 200), "50");
  }
});
