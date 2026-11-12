import test from "node:test";
import assert from "node:assert/strict";
import {
  simplifySongPageIds,
  songPageNameCandidates,
  songPageOrder,
} from "@sm/shared";

test("suggests compact page IDs and shortens arbitrary page names", () => {
  assert.equal(
    simplifySongPageIds("[Verse 1]\nline\n\n[Chorus]\nline\n\n[Opening Prayer]\nline").lyrics,
    "[v1]\nline\n\n[c]\nline\n\n[op]\nline",
  );
});

test("uses configured shortcuts and keeps per-song IDs unique", () => {
  const simplified = simplifySongPageIds(
    "[Verse 1]\nline\n\n[Chorus]\nline",
    "V1 C",
    { "Verse 1": "vs1", Chorus: "vs1" },
  );
  assert.equal(simplified.lyrics, "[vs1]\nline\n\n[vs1_2]\nline");
  assert.equal(simplified.verseOrder, "vs1 vs1_2");
  assert.deepEqual(simplified.changes, [
    { from: "Verse 1", to: "vs1" },
    { from: "Chorus", to: "vs1_2" },
  ]);
});

test("leaves compact page IDs and plain chord markers alone", () => {
  const simplified = simplifySongPageIds("[v1]\nline\n\n[G]\nline", "v1");
  assert.equal(simplified.lyrics, "[v1]\nline\n\n[G]\nline");
  assert.equal(simplified.verseOrder, "v1");
  assert.deepEqual(simplified.changes, []);
});

test("scans distinct page names from song lyrics", () => {
  const names = songPageNameCandidates(
    "[Verse 1]\nline\n\n[Chorus]\nline\n\n[Verse 1]\nline\r\n[Opening Prayer]\nline",
  );
  assert.deepEqual(names, ["Verse 1", "Chorus", "Opening Prayer"]);
});

test("recognises compact turnaround page IDs", () => {
  const lyrics = "[tr]\n[Ab] [Db/F] [Ab/Eb] [Ab] [Db2]";
  assert.equal(simplifySongPageIds(lyrics).lyrics, lyrics);
  assert.deepEqual(songPageNameCandidates(lyrics), ["tr"]);
});

test("lists pages in source order for a set-list verse order", () => {
  assert.equal(
    songPageOrder(
      "[Verse 1]\nline\n\n[Chorus]\nline\n\n[Verse 2]\nline\n\n[Chorus]\nline\n\n[Tag]\nline\n\n[tr]\n[Ab] [Db/F]",
    ),
    "v1 c v2 c t tr",
  );
  assert.equal(songPageOrder("[v1]\nline\n\n[c]\nline\n\n[i]\nline\n\n[o]\nline"), "v1 c i o");
  assert.equal(songPageOrder("[Opening Prayer]\nline\n\n[Verse 1]\nline"), "op v1");
  assert.equal(songPageOrder("[C]\nline\n\n[G/B]\nline\n\n[Verse 1]\nline"), "v1");
});
