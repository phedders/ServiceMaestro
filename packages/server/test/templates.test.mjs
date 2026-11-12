import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("full-screen uses its own whole-screen template", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-templates-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");

  const script = `
    const { resolveTemplate } = await import(process.env.SM_MODULE_BASE + "templates.js");
    const full = resolveTemplate("full", null);
    const twoThirds = resolveTemplate("two_thirds", null);
    console.log(JSON.stringify({ full, twoThirds }));
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
  assert.match(data.full.html, /sm-full/);
  assert.doesNotMatch(data.full.html, /sm-two-thirds/);
  assert.match(data.full.css, /\.sm-full/);
  assert.match(data.full.css, /width:\s*100vw/);
  assert.match(data.full.css, /border:\s*0/);
  assert.notEqual(data.full.html, data.twoThirds.html);
});
