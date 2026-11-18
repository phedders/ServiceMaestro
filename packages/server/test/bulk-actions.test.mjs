import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("bulk archives songs and archives or deletes set lists", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-bulk-actions-"));
  const emptyEnv = path.join(dir, "empty.env");
  const config = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(config, "{}\n");

  const script = `
    const { default: Fastify } = await import("fastify");
    const base = process.env.SM_MODULE_BASE;
    const { db } = await import(base + "db.js");
    const { createSession } = await import(base + "auth.js");
    const { COOKIE_NAME } = await import(base + "config.js");
    const { songRoutes } = await import(base + "routes/songs.js");
    const { setlistRoutes } = await import(base + "routes/setlists.js");

    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
    const { token } = createSession(admin.id);
    const cookie = COOKIE_NAME + "=" + token;
    const now = new Date().toISOString();
    for (const [id, title] of [["song-a", "Alpha"], ["song-b", "Bravo"]]) {
      db.prepare(
        "INSERT INTO songs (id, title, lyrics, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, title, title + " lyrics", now, now);
    }
    for (const [id, name] of [["setlist-a", "Keep me"], ["setlist-b", "Delete me"]]) {
      db.prepare(
        "INSERT INTO setlists (id, name, service_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, name, "2026-11-16", now, now);
    }

    const app = Fastify();
    await app.register(songRoutes);
    await app.register(setlistRoutes);
    const post = async (url, body) => {
      const response = await app.inject({
        method: "POST",
        url,
        headers: { cookie, "content-type": "application/json" },
        payload: JSON.stringify(body),
      });
      return { status: response.statusCode, body: JSON.parse(response.body) };
    };

    const archivedSongs = await post("/api/songs/bulk-archive", { ids: ["song-a", "song-b"] });
    const archivedSetlists = await post("/api/setlists/bulk-archive", { ids: ["setlist-a"] });
    const deletedSetlists = await post("/api/setlists/bulk-delete", { ids: ["setlist-b"] });
    const songs = db.prepare("SELECT id, archived_at FROM songs ORDER BY id").all();
    const setlists = db.prepare("SELECT id, archived_at FROM setlists ORDER BY id").all();
    console.log(JSON.stringify({ archivedSongs, archivedSetlists, deletedSetlists, songs, setlists }));
  `;

  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SM_ENV_FILE: emptyEnv,
      SM_CONFIG_FILE: config,
      SM_DATA_DIR: dir,
      SM_GIT_ENABLED: "false",
      SM_MODULE_BASE: moduleBase,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);

  assert.equal(data.archivedSongs.status, 200);
  assert.equal(data.archivedSongs.body.archived, 2);
  assert.equal(data.archivedSetlists.status, 200);
  assert.equal(data.archivedSetlists.body.archived, 1);
  assert.equal(data.deletedSetlists.status, 200);
  assert.equal(data.deletedSetlists.body.deleted, 1);
  assert.ok(data.songs.every((song) => song.archived_at));
  assert.deepEqual(data.setlists, [{ id: "setlist-a", archived_at: data.setlists[0].archived_at }]);
});
