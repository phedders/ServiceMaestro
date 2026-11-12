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
    const {
      logActivity,
      listActivity,
      moduleForPath,
      exportActivityCsv,
      getActivityRetentionDays,
      saveActivityRetentionDays,
    } = await import(process.env.SM_MODULE_BASE + "activity.js");
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO users (id, username, password_hash, role, permissions_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("activity-user", "activity-user", "x", "editor", null, now);
    const user = mapUser(getUserById("activity-user"));
    logActivity({ user, action: "login", module: "auth", status: 200, detail: "Password login" });
    logActivity({ user, action: "create", module: "songs", path: "/api/songs", status: 201 });
    logActivity({ user, action: "download_pdf", module: "setlists", status: 200, detail: "Big Print PDF" });
    logActivity({ user, action: "export", module: "settings", status: 200, detail: 'a, "quoted"\\nline' });
    const beforePrune = {
      all: listActivity(),
      songs: listActivity({ module: "songs" }),
      search: listActivity({ q: "Print" }),
    };
    const retentionDefault = getActivityRetentionDays();
    db.prepare("UPDATE activity_log SET created_at = ? WHERE detail = ?").run(
      new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
      "Big Print PDF",
    );
    const retentionSaved = saveActivityRetentionDays(30);
    const afterPrune = listActivity({ q: "Print" });
    console.log(JSON.stringify({
      ...beforePrune,
      settingsCsv: exportActivityCsv({ module: "settings" }),
      retentionDefault,
      retentionSaved,
      retentionAfter: getActivityRetentionDays(),
      afterPruneTotal: afterPrune.total,
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

  assert.equal(data.all.total, 4);
  assert.equal(data.all.entries.length, 4);
  assert.equal(data.all.entries[0].username, "activity-user");
  assert.equal(data.songs.total, 1);
  assert.equal(data.songs.entries[0].path, "/api/songs");
  assert.equal(data.search.total, 1);
  assert.equal(data.search.entries[0].action, "download_pdf");
  assert.match(
    data.settingsCsv,
    /^id,created_at,username,action,module,method,path,status,detail,ip,user_agent\r\n/,
  );
  assert.match(data.settingsCsv, /a, ""quoted""\nline/);
  assert.match(data.settingsCsv, /activity-user/);
  assert.equal(data.retentionDefault, 0);
  assert.equal(data.retentionSaved.retentionDays, 30);
  assert.equal(data.retentionSaved.deleted, 1);
  assert.equal(data.retentionAfter, 30);
  assert.equal(data.afterPruneTotal, 0);
  assert.deepEqual(data.pathModules, ["songs", "setlists", "users"]);
});
