import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("next commits a queued item at page zero without changing the current output first", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-live-queue-next-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");

  const script = `
    const base = process.env.SM_MODULE_BASE;
    const { db } = await import(base + "db.js");
    const { live } = await import(base + "live.js");
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO setlists (id, name, service_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("queue-next-setlist", "Queue next service", "2026-11-16", now, now);
    db.prepare(
      "INSERT INTO setlist_items (id, setlist_id, position, kind, title, content) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("queue-first", "queue-next-setlist", 0, "text", "First item", "First item page");
    db.prepare(
      "INSERT INTO setlist_items (id, setlist_id, position, kind, title, content) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("queue-second", "queue-next-setlist", 1, "text", "Second item", "Second item page");

    live.start("queue-next-setlist", "live");
    live.command({ type: "goto", itemIndex: 0 });
    const queued = live.command({ type: "queueItem", itemIndex: 1 });
    const beforeNext = {
      itemIndex: queued.itemIndex,
      pageIndex: queued.pageIndex,
      title: queued.title,
      blank: queued.blank,
      queuedItemIndex: queued.queuedItemIndex,
      queuedTitle: queued.queuedTitle,
    };
    const afterPage = live.command({ type: "page", delta: 1 });
    const pageState = {
      itemIndex: afterPage.itemIndex,
      pageIndex: afterPage.pageIndex,
      title: afterPage.title,
      queuedItemIndex: afterPage.queuedItemIndex,
    };

    live.command({ type: "goto", itemIndex: 0 });
    live.command({ type: "queueItem", itemIndex: 1 });
    const afterNext = live.command({ type: "next" });
    const nextState = {
      itemIndex: afterNext.itemIndex,
      pageIndex: afterNext.pageIndex,
      title: afterNext.title,
      queuedItemIndex: afterNext.queuedItemIndex,
    };

    console.log(JSON.stringify({ beforeNext, pageState, nextState }));
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

  assert.deepEqual(data.beforeNext, {
    itemIndex: 0,
    pageIndex: 0,
    title: "First item",
    blank: false,
    queuedItemIndex: 1,
    queuedTitle: "Second item",
  });
  assert.deepEqual(data.pageState, {
    itemIndex: 1,
    pageIndex: 0,
    title: "Second item",
    queuedItemIndex: null,
  });
  assert.deepEqual(data.nextState, {
    itemIndex: 1,
    pageIndex: 0,
    title: "Second item",
    queuedItemIndex: null,
  });
});
