import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("builds a paginated fullscreen preview without a live socket", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-song-preview-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");

  const script = `
    const base = process.env.SM_MODULE_BASE;
    const { createSongPreview } = await import(base + "song-preview.js");
    const { readPreview } = await import(base + "preview-store.js");
    const result = createSongPreview({
      title: "Preview Song",
      lyrics: [
        "[Verse 1]",
        "A[C]mazing grace, how [G]sweet the sound",
        "That saved a [D]wretch like [A]me",
        "",
        "[Verse 2]",
        "Twas [C]grace that taught my [G]heart to fear",
        "And [D]grace my fears re[A]lieved",
        "",
        "[Verse 3]",
        "How [C]precious did that [G]grace appear",
        "The [D]hour I first be[A]lieved",
      ].join("\\n"),
      lyricsMarkdown: false,
      verseOrder: null,
      key: "G",
    });
    const token = result.url.split("/").pop();
    const html = readPreview(token);
    console.log(JSON.stringify({
      url: result.url,
      pageCount: result.pageCount,
      hasPreviewState: html?.includes("sm-preview-state") ?? false,
      hasBootstrap: html?.includes("preview-bootstrap.js") ?? false,
      hasSocketClient: html?.includes("socket.io.js") ?? false,
      hasLyrics: html?.includes("mazing grace") ?? false,
      hasSecondPage: html?.includes("Twas") ?? false,
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

  assert.match(data.url, /^\/display\/song-preview\/[a-f0-9-]+$/);
  assert.ok(data.pageCount > 1);
  assert.equal(data.hasPreviewState, true);
  assert.equal(data.hasBootstrap, true);
  assert.equal(data.hasSocketClient, false);
  assert.equal(data.hasLyrics, true);
  assert.equal(data.hasSecondPage, true);
});
