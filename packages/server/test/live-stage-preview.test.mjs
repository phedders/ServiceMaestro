import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("stage preview is only enabled for a queued, not-live item", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-live-stage-preview-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");

  const script = `
    const base = process.env.SM_MODULE_BASE;
    const { db } = await import(base + "db.js");
    const { live } = await import(base + "live.js");
    const now = new Date().toISOString();
    const lyrics = Array.from({ length: 8 }, (_, index) => "line " + (index + 1)).join("\\n");
    for (const id of ["preview-song-a", "preview-song-b"]) {
      db.prepare(
        "INSERT INTO songs (id, title, lyrics, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, "Song " + id, lyrics, now, now);
    }
    db.prepare(
      "INSERT INTO setlists (id, name, service_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("preview-set", "Preview set", "2026-11-22", now, now);
    db.prepare(
      "INSERT INTO setlist_items (id, setlist_id, position, kind, song_id, title, max_lines) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("preview-item-a", "preview-set", 0, "song", "preview-song-a", "Song A", 4);
    db.prepare(
      "INSERT INTO setlist_items (id, setlist_id, position, kind, song_id, title, max_lines) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("preview-item-b", "preview-set", 1, "song", "preview-song-b", "Song B", 4);

    const started = live.start("preview-set", "live");
    const queued = live.command({ type: "queueItem", itemIndex: 1 });
    const preview = live.command({ type: "stagePreview" });
    const otherQueue = live.command({ type: "queueItem", itemIndex: 0 });
    const sameItemPreview = live.command({ type: "stagePreview" });
    const queuedAgain = live.command({ type: "queueItem", itemIndex: 1 });
    const previewAgain = live.command({ type: "stagePreview" });
    const wentLive = live.command({ type: "goto", itemIndex: 1 });

    console.log(JSON.stringify({
      started: {
        itemIndex: started.itemIndex,
        queuedItemIndex: started.queuedItemIndex,
        stagePreview: started.stagePreview,
      },
      queued: {
        itemIndex: queued.itemIndex,
        queuedItemIndex: queued.queuedItemIndex,
        stagePreview: queued.stagePreview,
      },
      preview: {
        itemIndex: preview.itemIndex,
        pageIndex: preview.pageIndex,
        queuedItemIndex: preview.queuedItemIndex,
        stagePreview: preview.stagePreview,
        pagesChanged: preview.pages.length !== started.pages.length,
      },
      otherQueue: {
        queuedItemIndex: otherQueue.queuedItemIndex,
        stagePreview: otherQueue.stagePreview,
      },
      sameItemPreview: sameItemPreview.stagePreview,
      queuedAgain: {
        queuedItemIndex: queuedAgain.queuedItemIndex,
        stagePreview: queuedAgain.stagePreview,
      },
      previewAgain: previewAgain.stagePreview,
      wentLive: {
        itemIndex: wentLive.itemIndex,
        queuedItemIndex: wentLive.queuedItemIndex,
        stagePreview: wentLive.stagePreview,
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

  assert.deepEqual(data.started, {
    itemIndex: 0,
    queuedItemIndex: null,
    stagePreview: false,
  });
  assert.deepEqual(data.queued, {
    itemIndex: 0,
    queuedItemIndex: 1,
    stagePreview: false,
  });
  assert.deepEqual(data.preview, {
    itemIndex: 0,
    pageIndex: 0,
    queuedItemIndex: 1,
    stagePreview: true,
    pagesChanged: false,
  });
  assert.deepEqual(data.otherQueue, {
    queuedItemIndex: 0,
    stagePreview: false,
  });
  assert.equal(data.sameItemPreview, false);
  assert.deepEqual(data.queuedAgain, {
    queuedItemIndex: 1,
    stagePreview: false,
  });
  assert.equal(data.previewAgain, true);
  assert.deepEqual(data.wentLive, {
    itemIndex: 1,
    queuedItemIndex: null,
    stagePreview: false,
  });
});
