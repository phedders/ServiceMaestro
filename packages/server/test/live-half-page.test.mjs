import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("next half scrolls through half-page steps and resets on normal navigation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-live-half-page-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");

  const script = `
    const base = process.env.SM_MODULE_BASE;
    const { db } = await import(base + "db.js");
    const { live } = await import(base + "live.js");
    const now = new Date().toISOString();
    const lyrics = Array.from({ length: 16 }, (_, index) => "line " + (index + 1)).join("\\n");
    db.prepare(
      "INSERT INTO songs (id, title, lyrics, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("half-song", "Half Page Song", lyrics, now, now);
    db.prepare(
      "INSERT INTO setlists (id, name, service_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("half-setlist", "Half Page Service", "2026-11-21", now, now);
    db.prepare(
      "INSERT INTO setlist_items (id, setlist_id, position, kind, song_id, title, max_lines) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("half-item", "half-setlist", 0, "song", "half-song", "Half Page Song", 2);

    const started = live.start("half-setlist", "live");
    const scrollMode = live.command({ type: "transition", value: "scroll" });
    const fadeMode = live.command({ type: "transition", value: "fade" });
    live.command({ type: "goto", itemIndex: 0 });
    const firstHalf = live.command({ type: "nextHalf" });
    const secondHalf = live.command({ type: "nextHalf" });
    const backHalf = live.command({ type: "prevHalf" });
    const backFull = live.command({ type: "prevHalf" });
    const atStart = live.command({ type: "prevHalf" });
    live.command({ type: "nextHalf" });
    live.command({ type: "nextHalf" });
    const normalNext = live.command({ type: "next" });
    const prevFromFull = live.command({ type: "prevHalf" });
    live.command({ type: "goto", itemIndex: 0 });
    let finalHalf = live.command({ type: "nextHalf" });
    for (let step = 0; step < 100 && finalHalf.halfPageMode; step += 1) {
      finalHalf = live.command({ type: "nextHalf" });
    }
    console.log(JSON.stringify({
      started: {
        transition: started.transition,
        halfPageMode: started.halfPageMode,
        halfPageOffset: started.halfPageOffset,
      },
      scrollMode: scrollMode.transition,
      fadeMode: fadeMode.transition,
      pageCount: firstHalf.pageCount,
      firstHalf: {
        pageIndex: firstHalf.pageIndex,
        halfPageMode: firstHalf.halfPageMode,
        halfPageOffset: firstHalf.halfPageOffset,
        blank: firstHalf.blank,
      },
      secondHalf: {
        pageIndex: secondHalf.pageIndex,
        halfPageMode: secondHalf.halfPageMode,
        halfPageOffset: secondHalf.halfPageOffset,
      },
      backHalf: {
        pageIndex: backHalf.pageIndex,
        halfPageMode: backHalf.halfPageMode,
        halfPageOffset: backHalf.halfPageOffset,
      },
      backFull: {
        pageIndex: backFull.pageIndex,
        halfPageMode: backFull.halfPageMode,
        halfPageOffset: backFull.halfPageOffset,
      },
      atStart: {
        pageIndex: atStart.pageIndex,
        halfPageMode: atStart.halfPageMode,
        halfPageOffset: atStart.halfPageOffset,
      },
      finalHalf: {
        pageIndex: finalHalf.pageIndex,
        pageCount: finalHalf.pageCount,
        halfPageMode: finalHalf.halfPageMode,
        halfPageOffset: finalHalf.halfPageOffset,
      },
      normalNext: {
        pageIndex: normalNext.pageIndex,
        halfPageMode: normalNext.halfPageMode,
        halfPageOffset: normalNext.halfPageOffset,
      },
      prevFromFull: {
        pageIndex: prevFromFull.pageIndex,
        halfPageMode: prevFromFull.halfPageMode,
        halfPageOffset: prevFromFull.halfPageOffset,
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
    transition: "fade",
    halfPageMode: false,
    halfPageOffset: 0,
  });
  assert.equal(data.scrollMode, "scroll");
  assert.equal(data.fadeMode, "fade");
  assert.ok(data.pageCount > 2);
  assert.deepEqual(data.firstHalf, {
    pageIndex: 0,
    halfPageMode: true,
    halfPageOffset: 1,
    blank: false,
  });
  assert.deepEqual(data.secondHalf, {
    pageIndex: 1,
    halfPageMode: true,
    halfPageOffset: 1,
  });
  assert.deepEqual(data.backHalf, {
    pageIndex: 0,
    halfPageMode: true,
    halfPageOffset: 1,
  });
  assert.deepEqual(data.backFull, {
    pageIndex: 0,
    halfPageMode: false,
    halfPageOffset: 0,
  });
  assert.deepEqual(data.atStart, {
    pageIndex: 0,
    halfPageMode: false,
    halfPageOffset: 0,
  });
  assert.equal(data.finalHalf.pageIndex, data.finalHalf.pageCount - 1);
  assert.equal(data.finalHalf.halfPageMode, false);
  assert.equal(data.finalHalf.halfPageOffset, 0);
  assert.deepEqual(data.normalNext, {
    pageIndex: 2,
    halfPageMode: false,
    halfPageOffset: 0,
  });
  assert.deepEqual(data.prevFromFull, {
    pageIndex: 1,
    halfPageMode: true,
    halfPageOffset: 1,
  });
});
