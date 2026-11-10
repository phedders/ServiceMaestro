import test from "node:test";
import assert from "node:assert/strict";
import { detectFormat, parseSongFile } from "../dist/importers/index.js";

const OPENLP = `<?xml version="1.0" encoding="UTF-8"?>
<song xmlns="http://openlyrics.info/namespace/2009/song" version="0.8">
  <properties>
    <titles><title>Amazing Grace</title><title>Amazing Grace (alternate)</title></titles>
    <copyright>Public Domain</copyright>
    <verseOrder>v1 c1 v2</verseOrder>
    <authors><author>John Newton</author></authors>
  </properties>
  <lyrics>
    <verse name="v1"><lines>Amazing grace, how sweet the sound<br/>That saved a wretch like me</lines></verse>
    <verse name="c1"><lines>My chains are gone<br/>I've been set free</lines></verse>
    <verse name="v2"><lines>'Twas grace that taught my heart to fear<br/>And grace my fears relieved</lines></verse>
  </lyrics>
</song>`;

const CHORDPRO = `{title: Test Song}
{artist: Writer One, Writer Two}
{key: G}
{ccli: 123456}
{verse_order: V1 C V2 C}
{footer: For use solely with the SongSelect Terms of Use.}

{comment: V1}
A[C]mazing grace, how [G]sweet the sound
[|][G]line with a bar marker [D]

{comment: C}
My [C]chains are gone, I've been set [G]free

{comment: V2}
'Twas [C]grace that taught my heart to [G]fear

CCLI Song # 123456
© Public Domain
`;

const TEXT = `Test Text Song

First line of the verse
Second line of the verse

Second stanza line
`;

test("detects formats", () => {
  assert.equal(detectFormat("song.xml", OPENLP), "openlp");
  assert.equal(detectFormat("song.txt", CHORDPRO), "chordpro");
  assert.equal(detectFormat("song.txt", TEXT), "text");
});

test("imports OpenLyrics and follows verseOrder", () => {
  const song = parseSongFile("amazing.xml", OPENLP);
  assert.equal(song.format, "openlp");
  assert.equal(song.title, "Amazing Grace");
  assert.equal(song.author, "John Newton");
  assert.equal(song.copyright, "Public Domain");
  assert.match(song.lyrics, /\[Verse 1\]/);
  assert.match(song.lyrics, /\[Chorus 1\]/);
  const verse1 = song.lyrics.indexOf("[Verse 1]");
  const chorus = song.lyrics.indexOf("[Chorus 1]");
  const verse2 = song.lyrics.indexOf("[Verse 2]");
  assert.ok(verse1 < chorus && chorus < verse2);
});

test("imports ChordPro sections, order, chords and removes legal footer", () => {
  const song = parseSongFile("test.txt", CHORDPRO);
  assert.equal(song.format, "chordpro");
  assert.equal(song.title, "Test Song");
  assert.equal(song.author, "Writer One, Writer Two");
  assert.equal(song.key, "G");
  assert.equal(song.ccli, "123456");
  assert.match(song.lyrics, /\[C\]/);
  assert.doesNotMatch(song.lyrics, /\[\|\]/);
  assert.doesNotMatch(song.lyrics, /CCLI Song #/);
  assert.doesNotMatch(song.lyrics, /For use solely/);
  const v1 = song.lyrics.indexOf("[V1]");
  const c = song.lyrics.indexOf("[C]");
  const v2 = song.lyrics.indexOf("[V2]");
  assert.ok(v1 < c && c < v2);
  // The chorus is repeated by verse_order.
  assert.equal((song.lyrics.match(/\[C\]\n/g) ?? []).length, 2);
});

test("imports plain text with a title line", () => {
  const song = parseSongFile("test.txt", TEXT);
  assert.equal(song.format, "text");
  assert.equal(song.title, "Test Text Song");
  assert.match(song.lyrics, /First line of the verse/);
  assert.match(song.lyrics, /\n\n/);
});

test("converts HTML text and warns", () => {
  const song = parseSongFile("notes.txt", "<p>First line<br>Second line</p>");
  assert.equal(song.format, "text");
  assert.match(song.lyrics, /First line\nSecond line/);
  assert.ok(song.warnings.length > 0);
});
