import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("quick text and images append to the live queue and become active", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-live-quick-append-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  const imagesDir = path.join(dir, "images");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.writeFileSync(path.join(imagesDir, "quick-test.png"), "not-a-real-png");

  const script = `
    const base = process.env.SM_MODULE_BASE;
    const { db } = await import(base + "db.js");
    const { live } = await import(base + "live.js");
    const now = new Date().toISOString();
    const lyrics = Array.from({ length: 8 }, (_, index) => "line " + (index + 1)).join("\\n");
    for (const id of ["quick-song-a", "quick-song-b"]) {
      db.prepare(
        "INSERT INTO songs (id, title, lyrics, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, "Song " + id, lyrics, now, now);
    }
    db.prepare(
      "INSERT INTO setlists (id, name, service_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("quick-set", "Quick set", "2026-11-22", now, now);
    db.prepare(
      "INSERT INTO setlist_items (id, setlist_id, position, kind, song_id, title, max_lines) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("quick-item-a", "quick-set", 0, "song", "quick-song-a", "Song A", 4);
    db.prepare(
      "INSERT INTO setlist_items (id, setlist_id, position, kind, song_id, title, max_lines) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("quick-item-b", "quick-set", 1, "song", "quick-song-b", "Song B", 4);

    const started = live.start("quick-set", "live");
    const appended = live.command({ type: "appendItem", itemIndex: 1 });
    const text = live.quickText("Quick line 1\\nQuick line 2");
    const textPage = text.pages[text.pageIndex];
    const previousFromText = live.command({ type: "page", delta: -1 });
    const image = live.quickImage("quick-test.png", "Quick test image");
    const imagePage = image.pages[image.pageIndex];
    const previousToText = live.command({ type: "page", delta: -1 });
    const previousToSong = live.command({ type: "page", delta: -1 });
    const reloaded = live.command({ type: "goto", itemIndex: 0 });

    console.log(JSON.stringify({
      started: {
        pageCount: started.pageCount,
        pageIndex: started.pageIndex,
      },
      appended: {
        pageCount: appended.pageCount,
        appendedItems: appended.appendedItems,
      },
      text: {
        pageCount: text.pageCount,
        pageIndex: text.pageIndex,
        mode: text.mode,
        title: text.title,
        appendedItems: text.appendedItems,
        pageKind: textPage.itemKind,
        pageTitle: textPage.itemTitle,
        html: textPage.html,
      },
      previousFromText: {
        pageIndex: previousFromText.pageIndex,
        mode: previousFromText.mode,
        title: previousFromText.title,
      },
      image: {
        pageCount: image.pageCount,
        pageIndex: image.pageIndex,
        mode: image.mode,
        title: image.title,
        appendedItems: image.appendedItems,
        pageKind: imagePage.itemKind,
        pageTitle: imagePage.itemTitle,
        html: imagePage.html,
      },
      previousToText: {
        pageIndex: previousToText.pageIndex,
        mode: previousToText.mode,
        title: previousToText.title,
      },
      previousToSong: {
        pageIndex: previousToSong.pageIndex,
        mode: previousToSong.mode,
        title: previousToSong.title,
      },
      reloaded: {
        itemIndex: reloaded.itemIndex,
        pageCount: reloaded.pageCount,
        pageIndex: reloaded.pageIndex,
        appendedItems: reloaded.appendedItems,
        mode: reloaded.mode,
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
      SM_IMAGES_DIR: imagesDir,
      SM_GIT_ENABLED: "false",
      SM_MODULE_BASE: moduleBase,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);

  assert.deepEqual(data.started, { pageCount: 2, pageIndex: 0 });
  assert.deepEqual(data.appended, { pageCount: 4, appendedItems: [1] });
  assert.deepEqual(data.text, {
    pageCount: 5,
    pageIndex: 4,
    mode: "text",
    title: "Quick text",
    appendedItems: [1],
    pageKind: "text",
    pageTitle: "Quick text",
    html: '<div class="slide-inner" style="text-align:left"><div class="line">Quick line 1</div><div class="line">Quick line 2</div></div>',
  });
  assert.deepEqual(data.previousFromText, {
    pageIndex: 3,
    mode: "song",
    title: "Song B",
  });
  assert.deepEqual(data.image, {
    pageCount: 6,
    pageIndex: 5,
    mode: "image",
    title: "Quick test image",
    appendedItems: [1],
    pageKind: "image",
    pageTitle: "Quick test image",
    html: '<div class="slide-image fit-scale"><img src="/display/images/file?path=quick-test.png&amp;token=dev-output" alt="Quick test image" /></div>',
  });
  assert.deepEqual(data.previousToText, {
    pageIndex: 4,
    mode: "text",
    title: "Quick text",
  });
  assert.deepEqual(data.previousToSong, {
    pageIndex: 3,
    mode: "song",
    title: "Song B",
  });
  assert.deepEqual(data.reloaded, {
    itemIndex: 0,
    pageCount: 2,
    pageIndex: 0,
    appendedItems: [],
    mode: "song",
  });
});
