import test from "node:test";
import assert from "node:assert/strict";
import {
  isSongChordToken,
  songHasChords,
  songKeyWithoutChords,
  songLinesDifferingApartFromSplits,
  songLyricsWithoutChords,
} from "@sm/shared";

test("recognises embedded chords but not section labels", () => {
  assert.equal(isSongChordToken("C"), true);
  assert.equal(isSongChordToken("C/G"), true);
  assert.equal(isSongChordToken("Am7"), true);
  assert.equal(isSongChordToken("N.C."), true);
  assert.equal(isSongChordToken("Chorus"), false);
  assert.equal(isSongChordToken("Pre-Chorus 2"), false);
  assert.equal(isSongChordToken("Verse 1"), false);
  assert.equal(isSongChordToken("|"), false);

  assert.equal(songHasChords("[Verse 1]\nAmazing grace"), false);
  assert.equal(songHasChords("[Verse 1]\nA[C]mazing [G]grace"), true);
  assert.equal(songHasChords("[Chorus]\nAmazing grace"), false);
});

test("compares lyric text with chords and section labels removed", () => {
  const plain = "[Verse 1]\nAmazing grace how sweet the sound\nThat saved a wretch like me";
  const chords =
    "[Verse 1]\nA[C]mazing [G]grace how [Am]sweet the [F]sound\nThat [C]saved a [G]wretch like [C]me";
  assert.equal(songKeyWithoutChords(plain), songKeyWithoutChords(chords));
  assert.equal(
    songLyricsWithoutChords(chords),
    "Amazing grace how sweet the sound\nThat saved a wretch like me",
  );

  const different = "[Verse 1]\nAmazing grace how sweet the sound\nThat saved a soul like me";
  assert.notEqual(songKeyWithoutChords(plain), songKeyWithoutChords(different));
  assert.notEqual(songKeyWithoutChords(""), songKeyWithoutChords(chords));
});

test("estimates line differences without counting word or line splits", () => {
  const reference =
    "[Verse 1]\nAmazing grace how sweet the sound\nThat saved a wretch like me";
  const rewrapped =
    "[Verse 1]\nAmazing grace how sweet\nThe sound that saved a wretch\nlike me";
  const splitWords =
    "[Verse 1]\nA[C]mazing grace how sweet the sound\nThat saved a wretch like me";
  const different =
    "[Verse 1]\nAmazing grace how sweet the sound\nThat saved a soul like me";

  assert.equal(songLinesDifferingApartFromSplits(reference, rewrapped), 0);
  assert.equal(songLinesDifferingApartFromSplits(reference, splitWords), 0);
  assert.equal(
    songLinesDifferingApartFromSplits(
      "[Verse 1]\nI can - not believe it",
      "[Verse 1]\nI cannot believe it",
    ),
    0,
  );
  assert.equal(songLinesDifferingApartFromSplits(reference, different), 1);
  assert.equal(
    songLinesDifferingApartFromSplits(reference, `${reference}\nAnd grace will lead me home`),
    1,
  );
});
