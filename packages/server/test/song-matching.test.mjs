import test from "node:test";
import assert from "node:assert/strict";
import {
  findSongAlternatives,
  findSongMatches,
  matchSummary,
} from "../dist/song-matching.js";

function song(id, title, alternateTitles = null, lyrics = "[Verse 1]\nFirst line\nSecond line") {
  return {
    id,
    title,
    alternate_titles: alternateTitles,
    author: "Test Author",
    copyright: null,
    ccli: `CCLI-${id}`,
    key: "G",
    lyrics,
    verse_order: null,
    lyrics_markdown: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

test("finds multiple similar songs and ranks exact titles first", () => {
  const songs = [
    song("plain", "Amazing Grace"),
    song("extended", "Amazing Grace (My Chains Are Gone)"),
    song("other", "Grace Alone"),
  ];
  const matches = findSongMatches("Amazing Grace (My Chains Are Gone)", songs);
  assert.equal(matches[0].song.id, "extended");
  assert.ok(matches.some((match) => match.song.id === "plain"));
  const summary = matchSummary(matches[1]);
  assert.equal(summary.author, "Test Author");
  assert.match(summary.firstLines, /First line/);
  assert.ok(summary.reasons.length > 0);
});

test("matches alternate titles and shared title words", () => {
  const songs = [
    song("alt", "Different Main Title", "Amazing Grace"),
    song("shared", "Great Is Your Faithfulness"),
  ];
  assert.equal(findSongMatches("Amazing Grace", songs)[0].song.id, "alt");
  assert.equal(findSongMatches("Great Is Thy Faithfulness", songs)[0].song.id, "shared");
});

test("alternatives exclude the current song and include full lyrics", () => {
  const current = song("current", "Amazing Grace");
  const songs = [
    current,
    song("extended", "Amazing Grace (My Chains Are Gone)", null, "[Verse 1]\nOther lyric"),
  ];
  const alternatives = findSongAlternatives(current, songs);
  assert.equal(alternatives.length, 1);
  assert.equal(alternatives[0].id, "extended");
  assert.match(alternatives[0].lyrics, /Other lyric/);
});
