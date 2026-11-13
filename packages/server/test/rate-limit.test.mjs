import test from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit, clearRateLimit } from "../dist/rate-limit.js";

test("limits repeated attempts and supports clearing after success", () => {
  const key = `test:${Date.now()}:${Math.random()}`;
  assert.equal(checkRateLimit(key, 2, 60_000).ok, true);
  assert.equal(checkRateLimit(key, 2, 60_000).ok, true);
  const blocked = checkRateLimit(key, 2, 60_000);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterMs > 0);

  clearRateLimit(key);
  assert.equal(checkRateLimit(key, 2, 60_000).ok, true);
});
