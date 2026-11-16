import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("auto show reveals the output only when a page change succeeds", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-live-auto-show-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");

  const script = `
    const base = process.env.SM_MODULE_BASE;
    const { db } = await import(base + "db.js");
    const { live } = await import(base + "live.js");
    const { getAppSettings, saveAppSettings } = await import(base + "settings.js");
    const now = new Date().toISOString();
    const lyrics = Array.from({ length: 30 }, (_, index) => "line " + (index + 1)).join("\\n");
    db.prepare(
      "INSERT INTO songs (id, title, lyrics, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("auto-show-song", "Auto show song", lyrics, now, now);
    db.prepare(
      "INSERT INTO setlists (id, name, service_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("auto-show-setlist", "Auto show service", "2026-11-16", now, now);
    db.prepare(
      "INSERT INTO setlist_items (id, setlist_id, position, kind, song_id, title, max_lines) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("auto-show-item", "auto-show-setlist", 0, "song", "auto-show-song", "Auto show song", 4);

    saveAppSettings({
      ...getAppSettings(),
      pageNavigation: "stop",
      autoShowOnPageChange: false,
    });
    live.start("auto-show-setlist", "live");
    live.command({ type: "goto", itemIndex: 0 });
    live.command({ type: "blank", value: true });
    const disabled = live.command({ type: "page", delta: 1 });

    saveAppSettings({
      ...getAppSettings(),
      autoShowOnPageChange: true,
    });
    live.command({ type: "blank", value: true });
    const enabled = live.command({ type: "page", delta: 1 });

    live.command({ type: "blank", value: true });
    live.command({ type: "goto", pageIndex: enabled.pageCount - 1 });
    live.command({ type: "blank", value: true });
    const heldAtBoundary = live.command({ type: "page", delta: 1 });

    console.log(JSON.stringify({
      disabled: {
        pageIndex: disabled.pageIndex,
        pageCount: disabled.pageCount,
        blank: disabled.blank,
      },
      enabled: {
        pageIndex: enabled.pageIndex,
        pageCount: enabled.pageCount,
        blank: enabled.blank,
      },
      heldAtBoundary: {
        pageIndex: heldAtBoundary.pageIndex,
        blank: heldAtBoundary.blank,
      },
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

  assert.ok(data.disabled.pageCount > 2, "test song should have several pages");
  assert.equal(data.disabled.pageIndex, 1);
  assert.equal(data.disabled.blank, true, "disabled setting must keep the output blank");
  assert.equal(data.enabled.pageIndex, 2);
  assert.equal(data.enabled.blank, false, "enabled setting reveals the page after navigation");
  assert.equal(data.heldAtBoundary.pageIndex, data.enabled.pageCount - 1);
  assert.equal(data.heldAtBoundary.blank, true, "no page change leaves the output blank");
});
