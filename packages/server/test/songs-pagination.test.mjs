import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("song lists support limit and offset pagination", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-songs-page-"));
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

    const now = new Date().toISOString();
    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
    const { token } = createSession(admin.id);
    const cookie = COOKIE_NAME + "=" + token;
    for (const [id, title] of [
      ["song-a", "Alpha"],
      ["song-b", "Bravo"],
      ["song-c", "Charlie"],
    ]) {
      db.prepare(
        "INSERT INTO songs (id, title, lyrics, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, title, title + " lyrics", now, now);
    }
    db.prepare(
      "INSERT INTO songs (id, title, lyrics, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("song-archived", "Archived", "Old lyrics", now, now, now);

    const app = Fastify();
    await app.register(songRoutes);
    const get = async (url) => {
      const response = await app.inject({
        method: "GET",
        url,
        headers: { cookie },
      });
      return JSON.parse(response.body).songs;
    };
    console.log(JSON.stringify({
      all: (await get("/api/songs")).map((song) => song.id),
      firstPage: (await get("/api/songs?limit=2&offset=0")).map((song) => song.id),
      secondPage: (await get("/api/songs?limit=2&offset=2")).map((song) => song.id),
      beyondEnd: (await get("/api/songs?limit=2&offset=10")).map((song) => song.id),
    }));
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

  assert.deepEqual(data.all, ["song-a", "song-b", "song-c"]);
  assert.deepEqual(data.firstPage, ["song-a", "song-b"]);
  assert.deepEqual(data.secondPage, ["song-c"]);
  assert.deepEqual(data.beyondEnd, []);
});
