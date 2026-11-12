import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("temporarily overrides image-list playback settings without changing the item", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-live-autoplay-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");

  const script = `
    const { db } = await import(process.env.SM_MODULE_BASE + "db.js");
    const { live } = await import(process.env.SM_MODULE_BASE + "live.js");
    const now = new Date().toISOString();
    const setlistId = "setlist-autoplay";
    const content = JSON.stringify({
      folder: "slides",
      images: ["slides/one.png", "slides/two.png", "slides/three.png"],
      autoplay: true,
      mode: "loop",
      delaySeconds: 30,
    });
    db.prepare(
      "INSERT INTO setlists (id, name, service_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run(setlistId, "Autoplay service", "2026-11-12", now, now);
    db.prepare(
      "INSERT INTO setlist_items (id, setlist_id, position, kind, title, content) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("item-autoplay", setlistId, 0, "image_list", "Slideshow", content);
    db.prepare(
      "INSERT INTO setlist_items (id, setlist_id, position, kind, title, content) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      "item-tarp",
      setlistId,
      1,
      "tarp",
      "Tarp slides",
      JSON.stringify({
        presentationId: "presentation-1",
        autoplay: false,
        mode: "single",
        delaySeconds: 8,
      }),
    );

    live.start(setlistId, "live");
    const initial = live.getState().autoplay;
    const changed = live.command({ type: "autoplay", mode: "bounce", delaySeconds: 4 }).autoplay;
    const stopped = live.command({ type: "autoplay", autoplay: false }).autoplay;
    const reset = live.command({ type: "autoplay", reset: true });
    const stored = db
      .prepare("SELECT content FROM setlist_items WHERE id = ?")
      .get("item-autoplay");
    live.command({ type: "goto", itemIndex: 1 });
    const tarpInitial = live.getState().autoplay;
    const tarpChanged = live.command({
      type: "autoplay",
      autoplay: true,
      delaySeconds: 10,
    }).autoplay;
    live.command({ type: "autoplay", reset: true });
    const tarpReset = live.getState().autoplay;
    live.stop();

    console.log(JSON.stringify({
      initial,
      changed,
      stopped,
      reset: reset.autoplay,
      resetOverrides: reset.autoplayOverrides ?? {},
      storedContent: JSON.parse(stored.content),
      tarpInitial,
      tarpChanged,
      tarpReset,
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
    itemIndex: 0,
    itemKind: "image_list",
    autoplay: true,
    mode: "loop",
    delaySeconds: 30,
    overridden: false,
  });
  assert.equal(data.changed.overridden, true);
  assert.equal(data.changed.mode, "bounce");
  assert.equal(data.changed.delaySeconds, 4);
  assert.equal(data.stopped.autoplay, false);
  assert.equal(data.stopped.mode, "bounce");
  assert.equal(data.stopped.delaySeconds, 4);
  assert.deepEqual(data.reset, data.initial);
  assert.deepEqual(data.resetOverrides, {});
  assert.equal(data.storedContent.autoplay, true);
  assert.equal(data.storedContent.mode, "loop");
  assert.equal(data.storedContent.delaySeconds, 30);

  assert.deepEqual(data.tarpInitial, {
    itemIndex: 1,
    itemKind: "tarp",
    autoplay: false,
    mode: "single",
    delaySeconds: 8,
    overridden: false,
  });
  assert.equal(data.tarpChanged.overridden, true);
  assert.equal(data.tarpChanged.autoplay, true);
  assert.equal(data.tarpChanged.delaySeconds, 10);
  assert.deepEqual(data.tarpReset, data.tarpInitial);
});
