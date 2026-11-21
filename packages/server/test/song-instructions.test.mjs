import test from "node:test";
import assert from "node:assert/strict";
import { removeSongInstructions, songInstructionAnalysis } from "@sm/shared";

const LYRICS = `[in]
 [Am] [F] [C] [Dm7]

[v1]
To Him be the [Am]glory

[v2]
To Him be the [Am]glory again

[c1a]
Oh [C]look and see
And now we're free (Last time to Chorus 1b)
We sing (Oh oh)

[tr]
 [Am] [F]

[v3]
To Him be the [Am]glory, He's coming

[c1b]
Oh [C]look and see our God (Last time to Outro)

[b]
[Am]Glory, glory
(1st Ending) [Am]Glory, glory (To Bridge)
(2nd Ending) [Am]Glory, glory (To Chorus 1a)

[out]
 [Am] [F] [C]`;

test("finds SongSelect instructions and suggests a last-time verse order", () => {
  const analysis = songInstructionAnalysis(LYRICS);

  assert.equal(analysis.instructions.length, 6);
  assert.deepEqual(analysis.instructions[0], {
    text: "(Last time to Chorus 1b)",
    inner: "Last time to Chorus 1b",
    line: 12,
    section: "c1a",
    target: "c1b",
    kind: "last-time",
  });
  assert.equal(
    analysis.suggestedVerseOrder,
    "in v1 c1a v2 c1a v3 c1a c1b tr b out",
  );
  assert.match(analysis.suggestedOrderReason ?? "", /repeat c1a after each verse/);
});

test("removes instructions but keeps ordinary lyric parentheses", () => {
  const result = removeSongInstructions(LYRICS);

  assert.equal(result.removed.length, 6);
  assert.equal(result.lyrics.includes("Last time"), false);
  assert.equal(result.lyrics.includes("1st Ending"), false);
  assert.equal(result.lyrics.includes("To Chorus"), false);
  assert.equal(result.lyrics.includes("(Oh oh)"), true);
  assert.match(result.lyrics, /And now we're free\nWe sing \(Oh oh\)/);
});
