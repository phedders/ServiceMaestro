import test from "node:test";
import assert from "node:assert/strict";
import { inferServiceTimeFromText } from "@sm/shared";

test("infers a service time from a ChurchSuite plan title", () => {
  assert.equal(inferServiceTimeFromText("The 10:30 Service"), "10:30");
  assert.equal(inferServiceTimeFromText("The 10.30am Service"), "10:30");
  assert.equal(inferServiceTimeFromText("9am Morning Worship"), "09:00");
  assert.equal(inferServiceTimeFromText("The 6.30pm Service"), "18:30");
  assert.equal(inferServiceTimeFromText("18:30 Evening Service"), "18:30");
  assert.equal(inferServiceTimeFromText("12am Prayer"), "00:00");
  assert.equal(inferServiceTimeFromText("12pm Service"), "12:00");
});

test("does not invent a time when the title has none", () => {
  assert.equal(inferServiceTimeFromText("Christmas Service"), null);
  assert.equal(inferServiceTimeFromText("Service 2026"), null);
  assert.equal(inferServiceTimeFromText(""), null);
  assert.equal(inferServiceTimeFromText(null), null);
});
