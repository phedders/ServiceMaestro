import test from "node:test";
import assert from "node:assert/strict";
import { parseCcliText } from "../dist/importers/ccli.js";

test("parses SongSelect downloader text with inline labels and separators", () => {
  const parsed = parseCcliText(
    "Amazing Grace.txt",
    `Amazing Grace

[Verse 1] Amazing grace how sweet the sound
That saved a wretch like me
//
[Chorus] My chains are gone
I've been set free

John Newton
© 2020
CCLI Song # 22025`,
  );
  assert.equal(parsed.title, "Amazing Grace");
  assert.equal(parsed.author, "John Newton");
  assert.equal(parsed.copyright, "© 2020");
  assert.equal(parsed.ccli, "22025");
  assert.match(parsed.lyrics, /\[Verse 1\]\nAmazing grace how sweet the sound/);
  assert.match(parsed.lyrics, /\[Chorus\]\nMy chains are gone/);
  assert.doesNotMatch(parsed.lyrics, /^\/\/$/m);
  assert.doesNotMatch(parsed.lyrics, /CCLI Song/);
});

test("accepts bare section labels and cleans generated filename suffixes", () => {
  const parsed = parseCcliText(
    "Way_Maker_2-zeilig.txt",
    `Verse 1
Way maker, miracle worker
//
Verse 2
Even when I don't see it`,
  );
  assert.equal(parsed.title, "Way Maker");
  assert.match(parsed.lyrics, /\[Verse 1\]\nWay maker/);
  assert.match(parsed.lyrics, /\[Verse 2\]\nEven when/);
});

test("adds default verse tags when no labels are present", () => {
  const parsed = parseCcliText(
    "Simple.txt",
    "First stanza line\nAnother line\n\nSecond stanza line",
  );
  assert.match(parsed.lyrics, /\[V1\]/);
  assert.match(parsed.lyrics, /\[V2\]/);
});
