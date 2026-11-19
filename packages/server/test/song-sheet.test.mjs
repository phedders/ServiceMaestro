import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("builds a printable PDF song sheet without chords or slide labels", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-song-sheet-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");

  const script = `
    const { db } = await import(process.env.SM_MODULE_BASE + "db.js");
    const { buildSongSheetPdf, songSheetLines } = await import(
      process.env.SM_MODULE_BASE + "song-sheet.js"
    );
    const { PDFDocument } = await import("pdf-lib");
    const now = new Date().toISOString();
    const lyrics = [
      "[Verse 1]",
      "A[C]mazing **grace**",
      "",
      "[Chorus]",
      "How sweet the sound",
    ].join("\\n");
    db.prepare(
      "INSERT INTO songs (id, title, author, copyright, ccli, lyrics, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "song-pdf",
      "Amazing Grace",
      "John Newton",
      "Public domain",
      "12345",
      lyrics,
      now,
      now,
    );
    db.prepare(
      "INSERT INTO setlists (id, name, service_date, service_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("setlist-pdf", "Sunday Service", "2026-11-15", "10:30", now, now);
    db.prepare(
      "INSERT INTO setlist_items (id, setlist_id, position, kind, song_id, title) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("item-pdf", "setlist-pdf", 0, "song", "song-pdf", "Amazing Grace");

    const lines = songSheetLines(lyrics);
    const result = await buildSongSheetPdf("setlist-pdf");
    const pdf = await PDFDocument.load(result.buffer);
    console.log(JSON.stringify({
      lines,
      filename: result.filename,
      bytes: result.buffer.length,
      pageCount: pdf.getPageCount(),
      header: result.buffer.subarray(0, 5).toString("utf8"),
    }));
  `;

  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SM_ENV_FILE: emptyEnv,
      SM_CONFIG_FILE: emptyConfig,
      SM_DATA_DIR: dir,
      SM_GIT_ENABLED: "false",
      SM_MODULE_BASE: moduleBase,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);

  assert.deepEqual(data.lines, ["Amazing grace", "", "How sweet the sound"]);
  assert.equal(data.filename, "sunday-service-2026-11-15-songs.pdf");
  assert.equal(data.header, "%PDF-");
  assert.ok(data.bytes > 1000);
  assert.equal(data.pageCount, 1);
});

test("builds a media PDF and falls back to lyrics for missing assets", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-media-sheet-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");

  const script = `
    const { db } = await import(process.env.SM_MODULE_BASE + "db.js");
    const { saveAsset } = await import(process.env.SM_MODULE_BASE + "assets.js");
    const { buildMediaSheetPdf } = await import(process.env.SM_MODULE_BASE + "song-sheet.js");
    const { PDFDocument } = await import("pdf-lib");
    const now = new Date().toISOString();
    for (const [id, title] of [["song-vocal", "Vocal Song"], ["song-lyrics", "Lyrics Song"]]) {
      db.prepare(
        "INSERT INTO songs (id, title, lyrics, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, title, "[Verse 1]\\n" + title + " lyric line", now, now);
    }
    db.prepare(
      "INSERT INTO setlists (id, name, service_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("setlist-media", "Media Service", "2026-11-16", now, now);
    for (const [id, songId, title, position] of [
      ["item-vocal", "song-vocal", "Vocal Song", 0],
      ["item-lyrics", "song-lyrics", "Lyrics Song", 1],
    ]) {
      db.prepare(
        "INSERT INTO setlist_items (id, setlist_id, position, kind, song_id, title) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(id, "setlist-media", position, "song", songId, title);
    }
    const assetPdf = await PDFDocument.create();
    assetPdf.addPage([300, 300]);
    saveAsset({
      songId: "song-vocal",
      buffer: Buffer.from(await assetPdf.save()),
      filename: "vocal.pdf",
      mime: "application/pdf",
      kind: "score_pdf",
      title: "Vocal sheet",
      userId: null,
    });
    const result = await buildMediaSheetPdf("setlist-media", "vocal");
    const pdf = await PDFDocument.load(result.buffer);
    console.log(JSON.stringify({
      filename: result.filename,
      header: result.buffer.subarray(0, 5).toString("utf8"),
      pages: pdf.getPageCount(),
    }));
  `;

  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SM_ENV_FILE: emptyEnv,
      SM_CONFIG_FILE: emptyConfig,
      SM_DATA_DIR: dir,
      SM_GIT_ENABLED: "false",
      SM_MODULE_BASE: moduleBase,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.header, "%PDF-");
  assert.match(data.filename, /media-service-2026-11-16-vocal\.pdf/);
  assert.ok(data.pages >= 2);
});

test("builds a chords PDF and rejects set lists without chord songs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-chord-sheet-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");

  const script = `
    const { db } = await import(process.env.SM_MODULE_BASE + "db.js");
    const { buildChordSheetPdf, chordSheetLines } = await import(
      process.env.SM_MODULE_BASE + "song-sheet.js"
    );
    const { PDFDocument } = await import("pdf-lib");
    const now = new Date().toISOString();
    const chords = "[V1]\\nA[C]mazing [G]grace\\n[C] [G]\\n[Chorus]\\nHow [F]sweet the [C]sound";
    const words = "[V1]\\nAmazing grace how sweet the sound";
    db.prepare(
      "INSERT INTO songs (id, title, lyrics, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("song-chords", "Chord Song", chords, now, now);
    db.prepare(
      "INSERT INTO songs (id, title, lyrics, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("song-words", "Words Only", words, now, now);
    db.prepare(
      "INSERT INTO setlists (id, name, service_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("setlist-chords", "Chord Service", "2026-11-15", now, now);
    db.prepare(
      "INSERT INTO setlist_items (id, setlist_id, position, kind, song_id, title, transpose) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("item-chords", "setlist-chords", 0, "song", "song-chords", "Chord Song", 2);
    db.prepare(
      "INSERT INTO setlist_items (id, setlist_id, position, kind, song_id, title) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("item-words", "setlist-chords", 1, "song", "song-words", "Words Only");
    db.prepare(
      "INSERT INTO setlists (id, name, service_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("setlist-no-chords", "No Chords", "2026-11-15", now, now);
    db.prepare(
      "INSERT INTO setlist_items (id, setlist_id, position, kind, song_id, title) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("item-no-chords", "setlist-no-chords", 0, "song", "song-words", "Words Only");

    const parsed = chordSheetLines(chords);
    const result = await buildChordSheetPdf("setlist-chords");
    const pdf = await PDFDocument.load(result.buffer);
    const portraitSize = pdf.getPage(0).getSize();
    const allSongs = await buildChordSheetPdf("setlist-no-chords", {
      orientation: "landscape",
      chordsOnly: false,
    });
    const allSongsPdf = await PDFDocument.load(allSongs.buffer);
    const landscapeSize = allSongsPdf.getPage(0).getSize();
    let noChordError = null;
    try {
      await buildChordSheetPdf("setlist-no-chords");
    } catch (error) {
      noChordError = error.message;
    }
    console.log(JSON.stringify({
      parsed,
      filename: result.filename,
      header: result.buffer.subarray(0, 5).toString("utf8"),
      pageCount: pdf.getPageCount(),
      portraitSize,
      landscapeSize,
      allSongsPages: allSongsPdf.getPageCount(),
      noChordError,
    }));
  `;

  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SM_ENV_FILE: emptyEnv,
      SM_CONFIG_FILE: emptyConfig,
      SM_DATA_DIR: dir,
      SM_GIT_ENABLED: "false",
      SM_MODULE_BASE: moduleBase,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);

  assert.deepEqual(data.parsed[0], { text: "", chords: [], section: "V1" });
  assert.deepEqual(data.parsed[1].chords, [
    { index: 1, chord: "C" },
    { index: 8, chord: "G" },
  ]);
  assert.equal(data.parsed[1].text, "Amazing grace");
  assert.deepEqual(data.parsed[2], {
    text: "",
    chords: [
      { index: 0, chord: "C" },
      { index: 1, chord: "G" },
    ],
    section: null,
  });
  assert.equal(data.parsed[3].section, "Chorus");
  assert.equal(data.filename, "chord-service-2026-11-15-chords.pdf");
  assert.equal(data.header, "%PDF-");
  assert.ok(data.pageCount >= 1);
  assert.ok(Math.abs(data.portraitSize.width - 595.28) < 0.01);
  assert.ok(Math.abs(data.portraitSize.height - 841.89) < 0.01);
  assert.ok(Math.abs(data.landscapeSize.width - 841.89) < 0.01);
  assert.ok(Math.abs(data.landscapeSize.height - 595.28) < 0.01);
  assert.ok(data.allSongsPages >= 1);
  assert.equal(data.noChordError, "This set list has no songs with chords");
});

test("multi-column song sheets use fewer pages than single-column output", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-song-columns-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");

  const script = `
    const { db } = await import(process.env.SM_MODULE_BASE + "db.js");
    const { buildSongSheetPdf } = await import(process.env.SM_MODULE_BASE + "song-sheet.js");
    const { PDFDocument } = await import("pdf-lib");
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO setlists (id, name, service_date, service_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("setlist-columns", "Column Test", "2026-11-15", null, now, now);
    for (let song = 0; song < 8; song += 1) {
      const id = "song-" + song;
      const lines = Array.from({ length: 18 }, (_, index) => "line " + (index + 1) + " of song " + (song + 1)).join("\\n");
      db.prepare(
        "INSERT INTO songs (id, title, lyrics, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, "Song " + (song + 1), lines, now, now);
      db.prepare(
        "INSERT INTO setlist_items (id, setlist_id, position, kind, song_id, title) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("item-" + song, "setlist-columns", song, "song", id, "Song " + (song + 1));
    }
    const single = await buildSongSheetPdf("setlist-columns", { fontSize: 15, columns: 1 });
    const multi = await buildSongSheetPdf("setlist-columns", { fontSize: 10, columns: 3 });
    const singlePdf = await PDFDocument.load(single.buffer);
    const multiPdf = await PDFDocument.load(multi.buffer);
    console.log(JSON.stringify({
      singlePages: singlePdf.getPageCount(),
      multiPages: multiPdf.getPageCount(),
    }));
  `;

  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SM_ENV_FILE: emptyEnv,
      SM_CONFIG_FILE: emptyConfig,
      SM_DATA_DIR: dir,
      SM_GIT_ENABLED: "false",
      SM_MODULE_BASE: moduleBase,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.ok(data.singlePages > data.multiPages, JSON.stringify(data));
});

test("prints repeated choruses and exports DOCX/ODF big-print and chord sheets", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-song-docs-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");

  const script = `
    const { db } = await import(process.env.SM_MODULE_BASE + "db.js");
    const { unzipSync, strFromU8 } = await import("fflate");
    const {
      songSheetLayout,
      isChorusSectionLabel,
      buildSongSheetDocument,
      buildChordSheetDocument,
    } = await import(process.env.SM_MODULE_BASE + "song-sheet.js");
    const now = new Date().toISOString();
    const lyrics = [
      "[Verse 1]",
      "A[C]mazing grace how sweet the sound",
      "That saved a wretch like me",
      "",
      "[Chorus]",
      "How [F]sweet the sound",
      "That saved a wretch",
      "",
      "[Verse 2]",
      "I once was lost but now am found",
      "",
      "[Chorus]",
      "How [F]sweet the sound",
      "That saved a wretch",
    ].join("\\n");
    db.prepare(
      "INSERT INTO songs (id, title, author, copyright, ccli, lyrics, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "song-docs",
      "Amazing Grace",
      "John Newton",
      "Public domain",
      "12345",
      lyrics,
      now,
      now,
    );
    db.prepare(
      "INSERT INTO setlists (id, name, service_date, service_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("setlist-docs", "Sunday Service", "2026-11-22", "10:30", now, now);
    db.prepare(
      "INSERT INTO setlist_items (id, setlist_id, position, kind, song_id, title) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("item-docs", "setlist-docs", 0, "song", "song-docs", "Amazing Grace");

    const read = (buffer, name) => strFromU8(unzipSync(new Uint8Array(buffer))[name]);
    const songsDocx = await buildSongSheetDocument("setlist-docs", "docx", { fontSize: 15 });
    const songsDocxPlain = await buildSongSheetDocument("setlist-docs", "docx", {
      fontSize: 15,
      boldText: false,
      chorusItalic: false,
    });
    const songsOdf = await buildSongSheetDocument("setlist-docs", "odf", { fontSize: 15 });
    const chordsDocx = await buildChordSheetDocument("setlist-docs", "docx", { fontSize: 15 });
    const chordsOdf = await buildChordSheetDocument("setlist-docs", "odf", { fontSize: 15 });

    console.log(JSON.stringify({
      layout: songSheetLayout(lyrics),
      chorus: isChorusSectionLabel("Chorus"),
      c: isChorusSectionLabel("c"),
      c2: isChorusSectionLabel("c2"),
      verse: isChorusSectionLabel("Verse 1"),
      songsDocx: read(songsDocx.buffer, "word/document.xml"),
      songsDocxPlain: read(songsDocxPlain.buffer, "word/document.xml"),
      songsOdf: read(songsOdf.buffer, "content.xml"),
      chordsDocx: read(chordsDocx.buffer, "word/document.xml"),
      chordsOdf: read(chordsOdf.buffer, "content.xml"),
      songsDocxName: songsDocx.filename,
      songsOdfType: songsOdf.contentType,
      chordsOdfName: chordsOdf.filename,
    }));
  `;

  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SM_ENV_FILE: emptyEnv,
      SM_CONFIG_FILE: emptyConfig,
      SM_DATA_DIR: dir,
      SM_GIT_ENABLED: "false",
      SM_MODULE_BASE: moduleBase,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);

  assert.equal(data.chorus, true);
  assert.equal(data.c, true);
  assert.equal(data.c2, true);
  assert.equal(data.verse, false);
  assert.equal(
    data.layout.filter((line) => line.text === "<CHORUS>").length,
    1,
  );
  assert.match(data.songsDocxName, /sunday-service-2026-11-22-songs\.docx/);
  assert.match(data.chordsOdfName, /sunday-service-2026-11-22-chords\.odf/);
  assert.equal(data.songsOdfType, "application/vnd.oasis.opendocument.text");

  // Page title 140%, song title 120%, metadata 8pt (sizes are half-points in DOCX).
  assert.match(data.songsDocx, /<w:sz w:val="42"\/>/);
  assert.match(data.songsDocx, /<w:sz w:val="36"\/>/);
  assert.match(data.songsDocx, /<w:sz w:val="16"\/>/);
  assert.match(data.songsDocx, /<w:b\/>/);
  assert.match(data.songsDocx, /<w:i\/>/);
  assert.match(data.songsDocx, /&lt;CHORUS&gt;/);
  assert.doesNotMatch(data.songsDocxPlain, /<w:i\/>/);
  assert.doesNotMatch(data.songsDocxPlain, /<w:b\/>/);

  assert.match(data.songsOdf, /fo:font-size="21pt"/);
  assert.match(data.songsOdf, /fo:font-size="18pt"/);
  assert.match(data.songsOdf, /fo:font-size="8pt"/);
  assert.match(data.songsOdf, /fo:font-weight="bold"/);
  assert.match(data.songsOdf, /fo:font-style="italic"/);
  assert.match(data.songsOdf, /&lt;CHORUS&gt;/);

  assert.match(data.chordsDocx, /Chorus/);
  assert.match(data.chordsDocx, /&lt;CHORUS&gt;/);
  assert.match(data.chordsOdf, /&lt;CHORUS&gt;/);
});
