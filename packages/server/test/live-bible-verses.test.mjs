import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("Bible verse numbers are shown by default and can be toggled from transport", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-live-bible-verses-"));
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
    ).run("bible-setlist", "Bible service", "2026-11-16", now, now);
    db.prepare(
      "INSERT INTO setlist_items (id, setlist_id, position, kind, title, content, content_source, text_format, max_lines) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "bible-item",
      "bible-setlist",
      0,
      "text",
      "1 Corinthians 14:33b-40",
      '<sup class="sm-bible-verse">33</sup> as in all the churches of the saints.',
      "bible",
      "text",
      4,
    );

    const started = live.start("bible-setlist", "live");
    const shown = live.command({ type: "bibleVerseNumbers", value: false });
    const hidden = live.command({ type: "bibleVerseNumbers", value: true });
    console.log(JSON.stringify({
      started: started.bibleVerseNumbers,
      shown: shown.bibleVerseNumbers,
      hidden: hidden.bibleVerseNumbers,
      pageHtml: started.pages[0]?.html ?? "",
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

  assert.equal(data.started, true);
  assert.equal(data.shown, false);
  assert.equal(data.hidden, true);
  assert.match(data.pageHtml, /<sup class="sm-bible-verse">33<\/sup>/);
});
