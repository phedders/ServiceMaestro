import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("stores SongSelect info separately from song lyrics", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-songselect-info-"));
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

    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
    const { token } = createSession(admin.id);
    const cookie = COOKIE_NAME + "=" + token;
    const app = Fastify();
    await app.register(songRoutes);
    const call = async (method, url, body) => {
      const response = await app.inject({
        method,
        url,
        headers: { cookie, "content-type": "application/json" },
        payload: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.statusCode, body: JSON.parse(response.body) };
    };

    const created = await call("POST", "/api/songs", {
      title: "SongSelect song",
      lyrics: "[Verse 1]\\nAmazing grace",
      songSelectInfo: "CCLI Song # 123\\n© Example Music | Admin Publishing",
    });
    const read = await call("GET", "/api/songs/" + created.body.song.id);
    const patched = await call("PATCH", "/api/songs/" + created.body.song.id, {
      songSelectInfo: "Imported from SongSelect",
    });
    console.log(JSON.stringify({
      created: created.body.song.songSelectInfo,
      read: read.body.song.songSelectInfo,
      patched: patched.body.song.songSelectInfo,
      lyrics: read.body.song.lyrics,
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
  assert.equal(
    data.created,
    "CCLI Song # 123\n© Example Music | Admin Publishing",
  );
  assert.equal(data.read, data.created);
  assert.equal(data.patched, "Imported from SongSelect");
  assert.match(data.lyrics, /Amazing grace/);
  assert.doesNotMatch(data.lyrics, /Example Music/);
});
