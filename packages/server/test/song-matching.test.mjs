import test from "node:test";
import assert from "node:assert/strict";
import {
  findDuplicateGroups,
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
    priority: 0,
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

test("groups duplicate songs by similar titles, CCLI and identical lyrics", () => {
  const songs = [
    song("plain", "Amazing Grace"),
    song("extended", "Amazing Grace (My Chains Are Gone)"),
    { ...song("ccli-a", "First title", null, "[Verse 1]\nA different lyric"), ccli: "12345" },
    { ...song("ccli-b", "Second title", null, "[Verse 1]\nAnother lyric"), ccli: "12345" },
    {
      ...song(
        "lyrics-a",
        "A song name",
        null,
        "[Verse 1]\nExactly the same words here and they continue for long enough to be compared as identical lyrics",
      ),
      ccli: null,
    },
    {
      ...song(
        "lyrics-b",
        "Another song name",
        null,
        "[Verse 1]\nExactly the same words here and they continue for long enough to be compared as identical lyrics",
      ),
      ccli: null,
    },
    song("unrelated", "Grace Alone"),
  ];
  const groups = findDuplicateGroups(songs);
  const ids = groups.map((group) => group.songs.map((item) => item.id));
  assert.ok(ids.some((group) => group.includes("plain") && group.includes("extended")));
  assert.ok(ids.some((group) => group.includes("ccli-a") && group.includes("ccli-b")));
  assert.ok(ids.some((group) => group.includes("lyrics-a") && group.includes("lyrics-b")));
  assert.ok(!ids.some((group) => group.includes("unrelated")));
  assert.ok(groups.every((group) => group.songs.length > 1));
});

test("does not group songs marked as different", () => {
  const songs = [
    {
      ...song("first", "Amazing Grace"),
      ccli: "12345",
      different_from_ids: JSON.stringify(["second"]),
    },
    {
      ...song("second", "Amazing Grace"),
      ccli: "12345",
      different_from_ids: JSON.stringify(["first"]),
    },
  ];
  assert.equal(findDuplicateGroups(songs).length, 0);
});

test("preferred songs rank ahead of otherwise identical matches", () => {
  const songs = [
    { ...song("plain", "Amazing Grace"), priority: 0 },
    { ...song("preferred", "Amazing Grace"), priority: 1 },
  ];
  assert.equal(findSongMatches("Amazing Grace", songs)[0].song.id, "preferred");
  assert.equal(findSongAlternatives(songs[0], songs)[0].id, "preferred");
});
