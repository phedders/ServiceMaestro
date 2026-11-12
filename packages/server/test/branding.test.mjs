import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("stores instance branding colour and logo", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-branding-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");

  const script = `
    const fs = await import("node:fs");
    const {
      brandingLogo,
      deleteBrandingLogo,
      getBranding,
      saveBranding,
      saveBrandingLogo,
    } = await import(process.env.SM_MODULE_BASE + "branding.js");
    const initial = getBranding();
    const coloured = saveBranding({ navBackground: "#123456" });
    const withLogo = saveBrandingLogo(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'),
      "logo.svg",
    );
    const logo = brandingLogo();
    const logoExists = logo ? fs.existsSync(logo.path) : false;
    const cleared = deleteBrandingLogo();
    console.log(JSON.stringify({
      initial,
      coloured,
      withLogo,
      logo: logo ? { mime: logo.mime, exists: logoExists } : null,
      cleared,
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

  assert.equal(data.initial.navBackground, null);
  assert.equal(data.initial.logoUrl, null);
  assert.equal(data.coloured.navBackground, "#123456");
  assert.match(data.withLogo.logoUrl, /^\/branding\/logo\?v=/);
  assert.equal(data.logo.mime, "image/svg+xml");
  assert.equal(data.logo.exists, true);
  assert.equal(data.cleared.logoUrl, null);
});

test("uses branding defaults from the environment/config fallback", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-branding-config-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  const logoFile = path.join(dir, "configured.svg");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");
  fs.writeFileSync(logoFile, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');

  const script = `
    const { brandingLogo, getBranding } = await import(process.env.SM_MODULE_BASE + "branding.js");
    const logo = brandingLogo();
    console.log(JSON.stringify({
      branding: getBranding(),
      logoPath: logo?.path ?? null,
      logoMime: logo?.mime ?? null,
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
      SM_BRANDING_NAV_BACKGROUND: "#abcdef",
      SM_BRANDING_LOGO_FILE: logoFile,
      SM_MODULE_BASE: moduleBase,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.branding.navBackground, "#abcdef");
  assert.match(data.branding.logoUrl, /^\/branding\/logo\?v=/);
  assert.equal(data.logoPath, logoFile);
  assert.equal(data.logoMime, "image/svg+xml");
});
