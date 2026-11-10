import test from "node:test";
import assert from "node:assert/strict";
import { transposeChord, keyDelta, buildPages, renderLine } from "../dist/render.js";

test("transposes simple and slash chords", () => {
  assert.equal(transposeChord("C", 2), "D");
  assert.equal(transposeChord("G/B", 2), "A/C#");
  assert.equal(transposeChord("F#m7", 1), "Gm7");
  assert.equal(transposeChord("N.C.", 2), "N.C.");
});

test("computes the nearest key change", () => {
  assert.equal(keyDelta("G", "A"), 2);
  assert.equal(keyDelta("A", "G"), -2);
  assert.equal(keyDelta("C", "C"), 0);
});

test("renders chord spans and escapes lyrics", () => {
  const html = renderLine("A[C]mazing <grace>", 2);
  assert.match(html, /class="chord"/);
  assert.match(html, /D/);
  assert.match(html, /&lt;grace&gt;/);
});

test("splits sections into pages by max lines", () => {
  const pages = buildPages({
    kind: "song",
    title: "Test",
    lyrics: "[Verse 1]\nline one\nline two\nline three\nline four\nline five",
    key: "G",
    keyOverride: "A",
    transpose: 0,
    maxLines: 4,
  });
  assert.ok(pages.length >= 2);
  assert.match(pages[0].html, /Verse 1/);
  assert.match(pages[0].html, /line one/);
});

test("text blank lines create page breaks", () => {
  const pages = buildPages({
    kind: "text",
    title: "Welcome",
    content: "First page\n\nSecond page",
    transpose: 0,
    maxLines: 4,
  });
  assert.equal(pages.length, 2);
});

test("honours verse order and repeats sections", () => {
  const pages = buildPages({
    kind: "song",
    title: "Order",
    lyrics: "[Verse 1]\nverse one\n\n[Chorus]\nchorus line",
    verseOrder: "C V1 C",
    transpose: 0,
    maxLines: 4,
  });
  assert.equal(pages.length, 3);
  assert.match(pages[0].html, /Chorus/);
  assert.match(pages[1].html, /Verse 1/);
  assert.match(pages[2].html, /Chorus/);
});
