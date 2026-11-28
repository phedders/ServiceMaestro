import test from "node:test";
import assert from "node:assert/strict";
import {
  applyBiblePartRange,
  parseBibleReference,
  parseBibleReferences,
  verseFromPart,
} from "../dist/bible-reference.js";

test("parses Bible references with verse-part suffixes", () => {
  assert.deepEqual(parseBibleReference("1 Corinthians 14:33b-40"), {
    bookName: "1 Corinthians",
    chapter: 14,
    from: 33,
    to: 40,
    fromPart: "b",
    toPart: null,
  });
  assert.deepEqual(parseBibleReference("1 Corinthians 14:33b–40a"), {
    bookName: "1 Corinthians",
    chapter: 14,
    from: 33,
    to: 40,
    fromPart: "b",
    toPart: "a",
  });
  assert.equal(parseBibleReference("1 Corinthians 14")?.from, null);
});

test("splits combined Bible readings joined with and", () => {
  assert.deepEqual(
    parseBibleReferences("Isaiah 7:10-17 and Matthew 1:18-25"),
    [
      {
        bookName: "Isaiah",
        chapter: 7,
        from: 10,
        to: 17,
        fromPart: null,
        toPart: null,
      },
      {
        bookName: "Matthew",
        chapter: 1,
        from: 18,
        to: 25,
        fromPart: null,
        toPart: null,
      },
    ],
  );
  assert.deepEqual(parseBibleReferences("Reading: Isaiah 7:10–17 & Matthew 1:18–25"), [
    {
      bookName: "Isaiah",
      chapter: 7,
      from: 10,
      to: 17,
      fromPart: null,
      toPart: null,
    },
    {
      bookName: "Matthew",
      chapter: 1,
      from: 18,
      to: 25,
      fromPart: null,
      toPart: null,
    },
  ]);
  assert.equal(
    parseBibleReferences("Isaiah 7:10-17 and something else").length,
    0,
  );
});

test("starts a verse at the second sentence when the reference says b", () => {
  const text = "First sentence. Second sentence! Third sentence?";
  assert.equal(verseFromPart(text, "b"), "Second sentence! Third sentence?");
  assert.equal(verseFromPart(text, "c"), "Third sentence?");
  assert.equal(verseFromPart(text, "a"), text);
  assert.equal(verseFromPart("No sentence break", "b"), "No sentence break");

  const commaClause =
    "for God is not [a God] of confusion but of peace, as in all the churches of the saints.";
  assert.equal(
    verseFromPart(commaClause, "b"),
    "as in all the churches of the saints.",
  );

  const verses = applyBiblePartRange(
    [
      { number: 33, text: "First sentence. Second sentence." },
      { number: 34, text: "Whole verse." },
    ],
    "b",
    null,
  );
  assert.equal(verses[0].text, "Second sentence.");
  assert.equal(verses[1].text, "Whole verse.");
});
