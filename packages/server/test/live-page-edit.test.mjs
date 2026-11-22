import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("page edits can be saved in the queue, set list or source item", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-live-page-edit-"));
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
    db.prepare(
      "INSERT INTO songs (id, title, lyrics, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("edit-song", "Edit song", lyrics, now, now);
    db.prepare(
      "INSERT INTO setlists (id, name, service_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("edit-set", "Edit set", "2026-11-22", now, now);
    db.prepare(
      "INSERT INTO setlist_items (id, setlist_id, position, kind, song_id, title, max_lines) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("edit-item-song", "edit-set", 0, "song", "edit-song", "Edit song", 4);
    db.prepare(
      "INSERT INTO setlist_items (id, setlist_id, position, kind, title, content, text_format, max_lines) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("edit-item-text", "edit-set", 1, "text", "Edit text", "first text page\\nsecond line", "text", 4);

    const started = live.start("edit-set", "live");
    const initialPage = started.pages[0];

    const queueEdit = live.command({
      type: "editPage",
      itemIndex: 0,
      pageIndex: 0,
      source: "[Chorus]\\nQueue saved line",
      target: "queue",
    });
    const queueReloaded = live.command({ type: "goto", pageIndex: 0 });

    const setlistEdit = live.command({
      type: "editPage",
      itemIndex: 0,
      pageIndex: 1,
      source: "Set list saved line",
      target: "setlist",
    });
    const setlistReloaded = live.command({ type: "goto", pageIndex: 1 });

    const sourceEdit = live.command({
      type: "editPage",
      itemIndex: 0,
      pageIndex: 0,
      source: "[Verse 1]\\nSource saved line",
      target: "source",
    });
    const sourceReloaded = live.command({ type: "goto", pageIndex: 0 });

    const queued = live.command({ type: "queueItem", itemIndex: 1 });
    const queuedEdit = live.command({
      type: "editPage",
      itemIndex: 1,
      pageIndex: 0,
      source: "Queued text edit",
      target: "queue",
    });
    const queuedReloaded = live.command({ type: "goto", itemIndex: 1 });

    const preview = live.previewPageSource(0, "[Bridge]\\nPreview line");

    console.log(JSON.stringify({
      initial: {
        source: initialPage.source,
        itemIndex: initialPage.itemIndex,
        sourcePageIndex: initialPage.sourcePageIndex,
        itemKind: initialPage.itemKind,
      },
      queueEdit: {
        stale: queueEdit.outOfDatePages,
        pageSource: queueEdit.pages[0].source,
      },
      queueReloaded: {
        stale: queueReloaded.outOfDatePages,
        source: queueReloaded.pages[0].source,
        edited: queueReloaded.pages[0].edited,
        html: queueReloaded.pages[0].html,
      },
      setlistEdit: {
        stale: setlistEdit.outOfDatePages,
        pageSource: setlistEdit.pages[1].source,
      },
      setlistReloaded: {
        stale: setlistReloaded.outOfDatePages,
        source: setlistReloaded.pages[1].source,
      },
      setlistRow: db.prepare("SELECT page_overrides_json FROM setlist_items WHERE id = ?").get("edit-item-song"),
      sourceEdit: {
        stale: sourceEdit.outOfDatePages,
        setlistRow: db.prepare("SELECT page_overrides_json FROM setlist_items WHERE id = ?").get("edit-item-song"),
        songRow: db.prepare("SELECT page_overrides_json FROM songs WHERE id = ?").get("edit-song"),
      },
      sourceReloaded: {
        stale: sourceReloaded.outOfDatePages,
        source: sourceReloaded.pages[0].source,
      },
      queued: {
        source: queued.queuedPages[0].source,
        queuedItemIndex: queued.queuedItemIndex,
      },
      queuedEdit: {
        stale: queuedEdit.queuedOutOfDatePages,
        pageSource: queuedEdit.queuedPages[0].source,
      },
      queuedReloaded: {
        itemIndex: queuedReloaded.itemIndex,
        queuedItemIndex: queuedReloaded.queuedItemIndex,
        source: queuedReloaded.pages[0].source,
        html: queuedReloaded.pages[0].html,
      },
      preview,
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

  assert.deepEqual(data.initial, {
    source: "line 1\nline 2\nline 3\nline 4",
    itemIndex: 0,
    sourcePageIndex: 0,
    itemKind: "song",
  });
  assert.deepEqual(data.queueEdit, {
    stale: [0],
    pageSource: "line 1\nline 2\nline 3\nline 4",
  });
  assert.deepEqual(data.queueReloaded, {
    stale: [],
    source: "[Chorus]\nQueue saved line",
    edited: true,
    html: '<div class="slide-inner"><div class="section-label">Chorus</div><div class="line">Queue saved line</div></div>',
  });
  assert.deepEqual(data.setlistEdit, {
    stale: [1],
    pageSource: "line 5\nline 6\nline 7\nline 8",
  });
  assert.deepEqual(data.setlistReloaded, {
    stale: [],
    source: "Set list saved line",
  });
  const setlistRow = JSON.parse(data.setlistRow.page_overrides_json);
  assert.equal(setlistRow["1"].source, "Set list saved line");

  assert.deepEqual(data.sourceEdit.stale, [0]);
  const sourceSetlist = JSON.parse(data.sourceEdit.setlistRow.page_overrides_json);
  assert.equal(sourceSetlist["0"], undefined);
  const songRow = JSON.parse(data.sourceEdit.songRow.page_overrides_json);
  assert.equal(songRow["0"].source, "[Verse 1]\nSource saved line");
  assert.deepEqual(data.sourceReloaded, {
    stale: [],
    source: "[Verse 1]\nSource saved line",
  });

  assert.deepEqual(data.queued, {
    source: "first text page\nsecond line",
    queuedItemIndex: 1,
  });
  assert.deepEqual(data.queuedEdit, {
    stale: [0],
    pageSource: "first text page\nsecond line",
  });
  assert.deepEqual(data.queuedReloaded, {
    itemIndex: 1,
    queuedItemIndex: null,
    source: "Queued text edit",
    html: '<div class="slide-inner" style="text-align:left"><div class="line">Queued text edit</div></div>',
  });
  assert.deepEqual(data.preview, {
    section: "Bridge",
    html: '<div class="slide-inner"><div class="section-label">Bridge</div><div class="line">Preview line</div></div>',
  });
});
