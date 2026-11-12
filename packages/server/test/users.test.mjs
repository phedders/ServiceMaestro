import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("normalizes module permissions and legacy role defaults", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-users-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");

  const script = `
    const { db } = await import(process.env.SM_MODULE_BASE + "db.js");
    const {
      getUserById,
      hasPermission,
      mapUser,
      normalizePermissions,
    } = await import(process.env.SM_MODULE_BASE + "users.js");
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO users (id, username, password_hash, role, permissions_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("editor-legacy", "editor-legacy", "x", "editor", null, now);
    db.prepare(
      "INSERT INTO users (id, username, password_hash, role, permissions_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      "custom-user",
      "custom-user",
      "x",
      "operator",
      JSON.stringify({ songs: true, live: true }),
      now,
    );
    const editor = mapUser(getUserById("editor-legacy"));
    const custom = mapUser(getUserById("custom-user"));
    console.log(JSON.stringify({
      editor,
      custom,
      editorCanSongs: hasPermission(editor, "songs"),
      editorCanSettings: hasPermission(editor, "settings"),
      customCanSongs: hasPermission(custom, "songs"),
      customCanLive: hasPermission(custom, "live"),
      customCanImages: hasPermission(custom, "images"),
      normalized: normalizePermissions({ songs: true, tarp: true }, "viewer"),
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

  assert.equal(data.editor.permissions.songs, true);
  assert.equal(data.editor.permissions.settings, false);
  assert.equal(data.editorCanSongs, true);
  assert.equal(data.editorCanSettings, false);

  assert.equal(data.custom.permissions.songs, true);
  assert.equal(data.custom.permissions.live, true);
  assert.equal(data.custom.permissions.images, false);
  assert.equal(data.customCanSongs, true);
  assert.equal(data.customCanLive, true);
  assert.equal(data.customCanImages, false);

  assert.equal(data.normalized.songs, true);
  assert.equal(data.normalized.tarp, true);
  assert.equal(data.normalized.settings, false);
});
