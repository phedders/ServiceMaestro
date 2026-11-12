import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("next/previous navigates a quick song and resumes the queue at the end", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-live-nav-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");

  const script = `
    const { db } = await import(process.env.SM_MODULE_BASE + "db.js");
    const { live } = await import(process.env.SM_MODULE_BASE + "live.js");
    const now = new Date().toISOString();
    const songId = "song-quick";
    const setlistId = "setlist-quick";
    const itemId = "item-quick";
    const lyrics = [
      "[V1]", "one", "two", "three", "four", "five",
      "", "[V2]", "six", "seven", "eight", "nine", "ten",
      "", "[V3]", "eleven", "twelve", "thirteen", "fourteen", "fifteen"
    ].join("\\n");
    db.prepare(
      "INSERT INTO songs (id, title, lyrics, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run(songId, "Quick song", lyrics, now, now);
    db.prepare(
      "INSERT INTO setlists (id, name, service_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run(setlistId, "Test service", "20261112", now, now);
    db.prepare(
      "INSERT INTO setlist_items (id, setlist_id, position, kind, song_id, title) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(itemId, setlistId, 0, "song", songId, "Set list song");
    db.prepare(
      "INSERT INTO setlist_items (id, setlist_id, position, kind, title, content) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("item-second", setlistId, 1, "text", "Second set item", "Second set item page");

    live.start(setlistId, "live");
    live.command({ type: "goto", itemIndex: 1 });
    const initial = live.quickSong(songId);
    const before = {
      title: initial.title,
      pageIndex: initial.pageIndex,
      pageCount: initial.pageCount,
      blank: initial.blank,
      itemIndex: initial.itemIndex,
    };
    const next = live.command({ type: "next" });
    const afterNext = {
      title: next.title,
      pageIndex: next.pageIndex,
      pageCount: next.pageCount,
      blank: next.blank,
      itemIndex: next.itemIndex,
    };
    const previous = live.command({ type: "prev" });
    const atStart = {
      title: previous.title,
      pageIndex: previous.pageIndex,
      blank: previous.blank,
      itemIndex: previous.itemIndex,
    };
    const beforeStart = live.command({ type: "prev" });
    const heldAtStart = {
      title: beforeStart.title,
      pageIndex: beforeStart.pageIndex,
      blank: beforeStart.blank,
      itemIndex: beforeStart.itemIndex,
    };

    let last = live.getState();
    for (let i = 0; i < 20 && last.pageIndex < last.pageCount - 1; i += 1) {
      last = live.command({ type: "next" });
    }
    const atEnd = {
      title: last.title,
      pageIndex: last.pageIndex,
      pageCount: last.pageCount,
      blank: last.blank,
      itemIndex: last.itemIndex,
    };
    const afterEnd = live.command({ type: "next" });
    const resumedQueue = {
      title: afterEnd.title,
      pageIndex: afterEnd.pageIndex,
      blank: afterEnd.blank,
      itemIndex: afterEnd.itemIndex,
    };

    console.log(JSON.stringify({ before, afterNext, atStart, heldAtStart, atEnd, resumedQueue }));
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
  const states = JSON.parse(result.stdout);

  assert.equal(states.before.title, "Quick song");
  assert.equal(states.before.itemIndex, -1);
  assert.ok(states.before.pageCount > 1, "quick song should have multiple pages");
  assert.equal(states.before.blank, false);

  assert.equal(states.afterNext.title, "Quick song");
  assert.equal(states.afterNext.itemIndex, -1);
  assert.equal(states.afterNext.pageIndex, 1);
  assert.equal(states.afterNext.blank, false);

  assert.equal(states.atStart.title, "Quick song");
  assert.equal(states.atStart.itemIndex, -1);
  assert.equal(states.atStart.pageIndex, 0);

  assert.equal(states.heldAtStart.title, "Quick song");
  assert.equal(states.heldAtStart.itemIndex, -1);
  assert.equal(states.heldAtStart.pageIndex, 0);
  assert.equal(states.heldAtStart.blank, false);

  assert.equal(states.atEnd.title, "Quick song");
  assert.equal(states.atEnd.itemIndex, -1);
  assert.equal(states.atEnd.pageIndex, states.atEnd.pageCount - 1);

  assert.equal(states.resumedQueue.title, "Second set item");
  assert.equal(states.resumedQueue.itemIndex, 1);
  assert.equal(states.resumedQueue.pageIndex, 0);
  assert.equal(states.resumedQueue.blank, false);
});
