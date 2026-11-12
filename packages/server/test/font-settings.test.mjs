import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("merges and reads the shared font manifest", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-font-settings-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");

  const script = `
    const fs = await import("node:fs");
    const path = await import("node:path");
    const {
      mergeSharedFonts,
      missingSharedFonts,
      readSharedFontSettings,
      sharedFontsEqual,
    } = await import(process.env.SM_MODULE_BASE + "font-settings.js");

    const existing = [{
      id: "google-inter",
      label: "Inter",
      family: '"Inter", system-ui, sans-serif',
      cssUrl: "https://fonts.googleapis.com/css2?family=Inter",
      importedAt: "2026-01-01T00:00:00.000Z",
    }];
    const local = [
      {
        id: "google-lora",
        label: "Lora",
        family: '"Lora", Georgia, serif',
        cssUrl: null,
        importedAt: null,
      },
      {
        id: "google-inter",
        label: "Inter",
        family: '"Inter", system-ui, sans-serif',
        cssUrl: "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700",
        importedAt: "2026-02-02T00:00:00.000Z",
      },
    ];
    const merged = mergeSharedFonts(existing, local);
    const repo = path.join(process.env.SM_DATA_DIR, "repos", "setlists");
    fs.mkdirSync(path.join(repo, "settings"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, "settings", "fonts.json"),
      JSON.stringify({ schemaVersion: 1, updatedAt: "2026-02-02T00:00:00.000Z", fonts: merged }),
    );
    const read = readSharedFontSettings();
    const missing = missingSharedFonts([
      {
        id: "google-inter",
        label: "Inter",
        family: '"Inter", system-ui, sans-serif',
        source: "google",
        cssUrl: "https://fonts.googleapis.com/css2?family=Inter",
        importedAt: "2026-02-02T00:00:00.000Z",
      },
    ], read.fonts);
    console.log(JSON.stringify({
      merged,
      read,
      missing,
      equal: sharedFontsEqual(merged, read.fonts),
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

  assert.deepEqual(
    data.merged.map((font) => font.id),
    ["google-inter", "google-lora"],
  );
  assert.equal(
    data.merged.find((font) => font.id === "google-inter").cssUrl,
    "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700",
  );
  assert.deepEqual(data.read.fonts, data.merged);
  assert.equal(data.equal, true);
  assert.deepEqual(
    data.missing.map((font) => font.id),
    ["google-lora"],
  );
});
