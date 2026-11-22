import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("display config lines/page is the default for a newly loaded queue", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-live-default-lines-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");

  const script = `
    const base = process.env.SM_MODULE_BASE;
    const { db } = await import(base + "db.js");
    const { getDisplayConfig, saveDisplayConfig } = await import(base + "display-config.js");
    const { live } = await import(base + "live.js");
    const now = new Date().toISOString();
    const lyrics = Array.from({ length: 8 }, (_, index) => "line " + (index + 1)).join("\\n");
    for (const id of ["default-song-a", "default-song-b"]) {
      db.prepare(
        "INSERT INTO songs (id, title, lyrics, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, "Song " + id, lyrics, now, now);
    }
    for (const id of ["default-set-a", "default-set-b"]) {
      db.prepare(
        "INSERT INTO setlists (id, name, service_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, "Set " + id, "2026-11-22", now, now);
    }
    db.prepare(
      "INSERT INTO setlist_items (id, setlist_id, position, kind, song_id, title, max_lines) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("default-item-a", "default-set-a", 0, "song", "default-song-a", "Song A", 2);
    db.prepare(
      "INSERT INTO setlist_items (id, setlist_id, position, kind, song_id, title, max_lines) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("default-item-b", "default-set-b", 0, "song", "default-song-b", "Song B", 2);

    saveDisplayConfig({ ...getDisplayConfig(), maxLines: 6 });
    const started = live.start("default-set-a", "live");
    const transport = live.command({ type: "maxLines", value: 7 });

    saveDisplayConfig({ ...getDisplayConfig(), maxLines: 8 });
    const savedConfig = getDisplayConfig();
    const configUpdated = live.updateDisplayConfig(savedConfig);

    const appliedNow = live.applyCurrent("default-set-b", "now", null);

    const afterTransport = live.command({ type: "maxLines", value: 9 });
    const queuedApply = live.applyCurrent("default-set-a", "next", null);
    let appliedPending = queuedApply;
    for (let step = 0; step < 50 && appliedPending.pendingUpdate; step += 1) {
      appliedPending = live.command({ type: "next" });
    }
    const restarted = live.start("default-set-a", "live");

    console.log(JSON.stringify({
      started: started.maxLines,
      transport: transport.maxLines,
      savedDefault: savedConfig.maxLines,
      configUpdated: configUpdated.maxLines,
      configMaxLines: configUpdated.displayConfig.maxLines,
      appliedNow: appliedNow.maxLines,
      afterTransport: afterTransport.maxLines,
      appliedPending: appliedPending.maxLines,
      pendingUpdate: appliedPending.pendingUpdate,
      restarted: restarted.maxLines,
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

  assert.equal(data.started, 6);
  assert.equal(data.transport, 7);
  assert.equal(data.savedDefault, 8);
  assert.equal(data.configUpdated, 7);
  assert.equal(data.configMaxLines, 8);
  assert.equal(data.appliedNow, 8);
  assert.equal(data.afterTransport, 9);
  assert.equal(data.pendingUpdate, false);
  assert.equal(data.appliedPending, 8);
  assert.equal(data.restarted, 8);
});
