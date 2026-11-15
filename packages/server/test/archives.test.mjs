import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("archives hide songs, set lists and Tarp presentations, then restore and delete them", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-archives-"));
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
    const { archiveRoutes } = await import(base + "routes/archives.js");
    const { tarpRoutes } = await import(base + "routes/tarp.js");

    const now = new Date().toISOString();
    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
    const { token } = createSession(admin.id);
    const cookie = COOKIE_NAME + "=" + token;
    db.prepare(
      "INSERT INTO songs (id, title, lyrics, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("active-song", "Active song", "Active lyrics", null, now, now);
    db.prepare(
      "INSERT INTO songs (id, title, lyrics, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("archived-song", "Archived song", "Old lyrics", now, now, now);
    db.prepare(
      "INSERT INTO setlists (id, name, service_date, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("active-setlist", "Active set list", "2026-11-15", null, now, now);
    db.prepare(
      "INSERT INTO setlists (id, name, service_date, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("archived-setlist", "Archived set list", "2026-11-08", now, now, now);
    db.prepare(
      "INSERT INTO tarp_presentations (id, name, aspect, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("active-tarp", "Active Tarp", "16:9", null, now, now);
    db.prepare(
      "INSERT INTO tarp_presentations (id, name, aspect, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("archived-tarp", "Archived Tarp", "16:9", now, now, now);

    const app = Fastify();
    await app.register(songRoutes);
    await app.register(setlistRoutes);
    await app.register(archiveRoutes);
    await app.register(tarpRoutes);
    const auth = { cookie };
    const get = async (url) => {
      const response = await app.inject({ method: "GET", url, headers: auth });
      return JSON.parse(response.body);
    };
    const post = async (url, payload) => {
      const response = await app.inject({
        method: "POST",
        url,
        headers: { ...auth, "content-type": "application/json" },
        payload: JSON.stringify(payload ?? {}),
      });
      return { status: response.statusCode, body: JSON.parse(response.body) };
    };

    const before = { songs: (await get("/api/songs")).songs, setlists: (await get("/api/setlists")).setlists };
    const archivesBefore = await get("/api/archives");
    const archivedSong = await post("/api/songs/active-song/archive");
    const archivedSetlist = await post("/api/setlists/active-setlist/archive");
    const archivedTarp = await post("/api/tarp/presentations/active-tarp/archive");
    const afterArchive = {
      songs: (await get("/api/songs")).songs,
      setlists: (await get("/api/setlists")).setlists,
      tarpPresentations: (await get("/api/tarp/presentations")).presentations,
    };
    const archivesAfterArchive = await get("/api/archives");
    const restoredSongs = await post("/api/archives/songs/restore", { ids: ["active-song"] });
    const restoredSetlists = await post("/api/archives/setlists/restore", { ids: ["active-setlist"] });
    const restoredTarp = await post("/api/archives/tarp/restore", { ids: ["active-tarp"] });
    const afterRestore = {
      songs: (await get("/api/songs")).songs,
      setlists: (await get("/api/setlists")).setlists,
      tarpPresentations: (await get("/api/tarp/presentations")).presentations,
    };
    const deletedSongs = await post("/api/archives/songs/delete", { ids: ["archived-song"] });
    const deletedSetlists = await post("/api/archives/setlists/delete", { ids: ["archived-setlist"] });
    const deletedTarp = await post("/api/archives/tarp/delete", { ids: ["archived-tarp"] });
    const finalArchives = await get("/api/archives");

    await app.close();
    console.log(JSON.stringify({
      before,
      archivesBefore,
      archivedSong,
      archivedSetlist,
      archivedTarp,
      afterArchive,
      archivesAfterArchive,
      restoredSongs,
      restoredSetlists,
      restoredTarp,
      afterRestore,
      deletedSongs,
      deletedSetlists,
      deletedTarp,
      finalArchives,
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

  assert.deepEqual(data.before.songs.map((song) => song.id), ["active-song"]);
  assert.deepEqual(data.before.setlists.map((setlist) => setlist.id), ["active-setlist"]);
  assert.deepEqual(data.archivesBefore.songs.map((song) => song.id), ["archived-song"]);
  assert.deepEqual(data.archivesBefore.setlists.map((setlist) => setlist.id), ["archived-setlist"]);
  assert.deepEqual(
    data.archivesBefore.tarpPresentations.map((presentation) => presentation.id),
    ["archived-tarp"],
  );
  assert.equal(data.archivedSong.status, 200);
  assert.equal(data.archivedSetlist.status, 200);
  assert.equal(data.archivedTarp.status, 200);
  assert.deepEqual(data.afterArchive.songs, []);
  assert.deepEqual(data.afterArchive.setlists, []);
  assert.deepEqual(data.afterArchive.tarpPresentations, []);
  assert.deepEqual(
    data.archivesAfterArchive.songs.map((song) => song.id).sort(),
    ["active-song", "archived-song"],
  );
  assert.deepEqual(
    data.archivesAfterArchive.setlists.map((setlist) => setlist.id).sort(),
    ["active-setlist", "archived-setlist"],
  );
  assert.deepEqual(
    data.archivesAfterArchive.tarpPresentations.map((presentation) => presentation.id).sort(),
    ["active-tarp", "archived-tarp"],
  );
  assert.equal(data.restoredSongs.body.restored, 1);
  assert.equal(data.restoredSetlists.body.restored, 1);
  assert.equal(data.restoredTarp.body.restored, 1);
  assert.deepEqual(data.afterRestore.songs.map((song) => song.id), ["active-song"]);
  assert.deepEqual(data.afterRestore.setlists.map((setlist) => setlist.id), ["active-setlist"]);
  assert.deepEqual(
    data.afterRestore.tarpPresentations.map((presentation) => presentation.id),
    ["active-tarp"],
  );
  assert.equal(data.deletedSongs.body.deleted, 1);
  assert.equal(data.deletedSetlists.body.deleted, 1);
  assert.equal(data.deletedTarp.body.deleted, 1);
  assert.deepEqual(data.finalArchives, { songs: [], setlists: [], tarpPresentations: [] });
});
