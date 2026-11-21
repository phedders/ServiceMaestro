import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("reports lowercase chords after a SongSelect import", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-site-lowercase-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");

  const script = `
    const base = process.env.SM_MODULE_BASE;
    const { db } = await import(base + "db.js");
    const { registerSiteScraperAdapter, saveSiteCredentials } = await import(base + "site-scraping.js");
    const { importSiteSong } = await import(base + "site-scraping-import.js");
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO users (id, username, password_hash, role, permissions_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("user-1", "user-1", "x", "editor", null, now);
    saveSiteCredentials("user-1", "songselect", { cookie: "test-cookie" });
    registerSiteScraperAdapter({
      id: "songselect",
      search: async () => [],
      download: async () => [
        {
          kind: "chord",
          filename: "lowercase.cho",
          mime: "text/plain",
          data: Buffer.from("[c]Lord O my [G]soul\\n[am]azing grace\\n"),
        },
      ],
    });
    const result = await importSiteSong(
      "user-1",
      "songselect",
      {
        provider: "songselect",
        songNumber: "12345",
        slug: "lowercase",
        title: "Lowercase",
        authors: [],
        availableKinds: ["chord"],
      },
      ["chord"],
      "user-1",
    );
    const stored = db.prepare("SELECT lyrics FROM songs WHERE id = ?").get(result.song.id);
    console.log(JSON.stringify({
      created: result.created,
      lyrics: stored.lyrics,
      lowercaseChords: result.lowercaseChords,
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

  assert.equal(data.created, true);
  assert.match(data.lyrics, /\[c\]Lord O my \[G\]soul/);
  assert.match(data.lyrics, /\[am\]azing grace/);
  assert.equal(data.lowercaseChords.count, 2);
  assert.deepEqual(data.lowercaseChords.changes, [
    { from: "am", to: "Am", count: 1 },
    { from: "c", to: "C", count: 1 },
  ]);
});
