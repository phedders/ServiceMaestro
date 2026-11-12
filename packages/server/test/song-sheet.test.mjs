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
