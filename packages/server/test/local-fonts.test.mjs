import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("detects local font files and reconciles removed files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-local-fonts-"));
  const fontsDir = path.join(dir, "fonts");
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  fs.mkdirSync(path.join(fontsDir, "sub"), { recursive: true });
  fs.mkdirSync(path.join(fontsDir, "google-cached"), { recursive: true });
  fs.mkdirSync(path.join(fontsDir, "_local", "ignored"), { recursive: true });
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");
  fs.writeFileSync(path.join(fontsDir, "MyFont-Bold.ttf"), "not-a-real-font");
  fs.writeFileSync(path.join(fontsDir, "MyFont-Regular.woff2"), "not-a-real-font");
  fs.writeFileSync(path.join(fontsDir, "sub", "OtherFont-Italic.otf"), "not-a-real-font");
  fs.writeFileSync(path.join(fontsDir, "google-cached", "fonts.css"), "/* generated */");
  fs.writeFileSync(path.join(fontsDir, "google-cached", "sample.woff2"), "generated");
  fs.writeFileSync(path.join(fontsDir, "_local", "ignored", "fonts.css"), "/* generated */");

  const script = `
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { listFonts } = await import(process.env.SM_MODULE_BASE + "fonts.js");
    const initial = listFonts()
      .filter((font) => font.source === "local")
      .map((font) => ({ id: font.id, label: font.label, family: font.family }));
    const cssPath = path.join(process.env.SM_FONTS_DIR, "_local", "local-my-font", "fonts.css");
    const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, "utf8") : null;
    const otherCssPath = path.join(
      process.env.SM_FONTS_DIR,
      "_local",
      "local-other-font",
      "fonts.css",
    );
    const otherCss = fs.existsSync(otherCssPath)
      ? fs.readFileSync(otherCssPath, "utf8")
      : null;
    fs.rmSync(path.join(process.env.SM_FONTS_DIR, "MyFont-Bold.ttf"));
    fs.rmSync(path.join(process.env.SM_FONTS_DIR, "MyFont-Regular.woff2"));
    const afterRemoval = listFonts()
      .filter((font) => font.source === "local")
      .map((font) => ({ id: font.id, label: font.label }));
    console.log(JSON.stringify({ initial, css, otherCss, afterRemoval }));
  `;

  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SM_ENV_FILE: emptyEnv,
      SM_CONFIG_FILE: emptyConfig,
      SM_DATA_DIR: path.join(dir, "data"),
      SM_FONTS_DIR: fontsDir,
      SM_GIT_ENABLED: "false",
      SM_MODULE_BASE: moduleBase,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);

  assert.deepEqual(
    data.initial.map((font) => font.label),
    ["My Font", "Other Font"],
  );
  assert.equal(data.initial[0].id, "local-my-font");
  assert.match(data.initial[0].family, /^"My Font", system-ui, sans-serif$/);
  assert.ok(data.css.includes('font-weight: 700;'));
  assert.ok(data.css.includes('font-weight: 400;'));
  assert.ok(data.otherCss.includes('font-style: italic;'));
  assert.ok(data.css.includes("/display/fonts/MyFont-Bold.ttf"));
  assert.ok(!data.css.includes("google-cached"));
  assert.deepEqual(
    data.afterRemoval.map((font) => font.label),
    ["Other Font"],
  );
});
