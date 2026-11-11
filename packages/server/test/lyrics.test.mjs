import test from "node:test";
import assert from "node:assert/strict";
import { addDefaultVerseTags } from "../dist/lyrics.js";

test("adds sequential default verse tags", () => {
  assert.equal(
    addDefaultVerseTags("first line\nsecond line\n\nthird line"),
    "[V1]\nfirst line\nsecond line\n\n[V2]\nthird line",
  );
});

test("keeps existing bracketed section tags", () => {
  const tagged = "[Chorus]\nchorus line\n\n[Bridge]\nbridge line";
  assert.equal(addDefaultVerseTags(tagged), tagged);
});

test("keeps existing bare section headings", () => {
  const tagged = "Verse 1\nfirst line\n\nVerse 2\nsecond line";
  assert.equal(addDefaultVerseTags(tagged), tagged);
});

test("adds one tag to untagged single-stanza lyrics", () => {
  assert.equal(addDefaultVerseTags("one line\nanother line"), "[V1]\none line\nanother line");
});
