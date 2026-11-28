import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const moduleBase = new URL("../dist/", import.meta.url).href;
const bibleDir = fileURLToPath(new URL("../../../samples/bible/", import.meta.url));

test("splits a combined ChurchSuite reading into separate readings", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-churchsuite-readings-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");

  const script = `
    const base = process.env.SM_MODULE_BASE;
    const { readingsForItem } = await import(base + "churchsuite-import.js");
    const readings = readingsForItem(
      {
        id: 7,
        order: 1,
        type_id: 3,
        type: "item",
        name: "Isaiah 7:10-17 and Matthew 1:18-25",
        comment: null,
        notes: null,
        question_responses: [],
        arrangement_id: null,
      },
      "Bible Reading",
    );
    console.log(JSON.stringify(readings.map((reading) => ({
      reference: reading.reference,
      bookName: reading.bookName,
      chapter: reading.chapter,
      from: reading.from,
      to: reading.to,
      verseCount: reading.verseCount,
      hasPreview: Boolean(reading.preview),
    }))));
  `;

  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SM_ENV_FILE: emptyEnv,
      SM_CONFIG_FILE: emptyConfig,
      SM_DATA_DIR: dir,
      SM_BIBLE_DIR: bibleDir,
      SM_GIT_ENABLED: "false",
      SM_MODULE_BASE: moduleBase,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const readings = JSON.parse(result.stdout);
  assert.equal(readings.length, 2);
  assert.deepEqual(
    readings.map((reading) => reading.reference),
    ["Isaiah 7:10–17", "Matthew 1:18–25"],
  );
  assert.ok(readings[0].verseCount > 0);
  assert.ok(readings[1].verseCount > 0);
  assert.ok(readings.every((reading) => reading.hasPreview));
});
