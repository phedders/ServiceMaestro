import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("records and filters user activity", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-activity-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");

  const script = `
    const { db } = await import(process.env.SM_MODULE_BASE + "db.js");
    const { getUserById, mapUser } = await import(process.env.SM_MODULE_BASE + "users.js");
    const { logActivity, listActivity, moduleForPath } = await import(
      process.env.SM_MODULE_BASE + "activity.js"
    );
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO users (id, username, password_hash, role, permissions_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("activity-user", "activity-user", "x", "editor", null, now);
    const user = mapUser(getUserById("activity-user"));
    logActivity({ user, action: "login", module: "auth", status: 200, detail: "Password login" });
    logActivity({ user, action: "create", module: "songs", path: "/api/songs", status: 201 });
    logActivity({ user, action: "download_pdf", module: "setlists", status: 200, detail: "Big Print PDF" });
    console.log(JSON.stringify({
      all: listActivity(),
      songs: listActivity({ module: "songs" }),
      search: listActivity({ q: "Print" }),
      pathModules: [
        moduleForPath("/api/songs/123"),
        moduleForPath("/api/setlists/123/songs.pdf"),
        moduleForPath("/api/users"),
      ],
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

  assert.equal(data.all.total, 3);
  assert.equal(data.all.entries.length, 3);
  assert.equal(data.all.entries[0].username, "activity-user");
  assert.equal(data.songs.total, 1);
  assert.equal(data.songs.entries[0].path, "/api/songs");
  assert.equal(data.search.total, 1);
  assert.equal(data.search.entries[0].action, "download_pdf");
  assert.deepEqual(data.pathModules, ["songs", "setlists", "users"]);
});
