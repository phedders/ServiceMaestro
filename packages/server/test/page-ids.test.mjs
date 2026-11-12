import test from "node:test";
import assert from "node:assert/strict";
import { simplifySongPageIds, songPageNameCandidates } from "@sm/shared";

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
