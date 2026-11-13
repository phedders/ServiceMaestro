import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("reads, applies and merges the shared settings file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-shared-settings-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");

  const script = `
    const fs = await import("node:fs");
    const path = await import("node:path");
    const base = process.env.SM_MODULE_BASE;
    const {
      applySharedSettings,
      localSharedAdapterSettings,
      mergeSharedFonts,
      missingSharedFonts,
      readSharedSettings,
      sharedSettingsEqual,
      sharedSettingsPayload,
    } = await import(base + "shared-settings.js");
    const { getAppSettings } = await import(base + "settings.js");
    const { getDisplayConfig } = await import(base + "display-config.js");
    const { getBackgroundColors } = await import(base + "backgrounds.js");
    const { saveIntegrationSettings } = await import(base + "integrations.js");
    const { getMqttSettings, saveMqttSettings } = await import(base + "mqtt-settings.js");

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
    const appSettings = {
      ...getAppSettings(),
      pageNavigation: "next-item",
      churchsuiteEmptyTypes: ["Welcome", "Prayer"],
      defaultBibleTranslation: "ESV",
      pageIdShortcuts: { "Verse 1": "v1" },
    };
    const displayConfig = {
      ...getDisplayConfig(),
      fontFamily: '"Lora", Georgia, serif',
      textColor: "#112233",
      maxLines: 6,
      maxWords: 70,
      smartPageSplits: false,
      smartWrapMinWords: 20,
      smartWrapModules: ["songs", "bible"],
      lowerThirdFontFamily: '"Inter", system-ui, sans-serif',
      lowerThirdTextScale: 1.4,
    };
    const backgroundColors = {
      background: "#010203",
      primary: "#040506",
      secondary: "#070809",
      accent: "#0a0b0c",
    };
    saveIntegrationSettings({
      songSelect: "shared",
      churchSuite: "local",
      mqtt: "shared",
    });
    saveMqttSettings({
      brokerUrl: "mqtt://shared.example:1883",
      incomingPrefix: "team/in",
      outgoingPrefix: "team/out",
      mappings: [],
      controls: [],
    });
    const adapters = localSharedAdapterSettings();
    const repo = path.join(process.env.SM_DATA_DIR, "repos", "setlists");
    fs.mkdirSync(path.join(repo, "settings"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, "settings", "shared.json"),
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: "2026-02-02T00:00:00.000Z",
        fonts: merged,
        appSettings,
        displayConfig,
        backgroundColors,
        adapters,
      }),
    );
    const read = readSharedSettings();
    applySharedSettings(read);
    const applied = {
      appSettings: getAppSettings(),
      displayConfig: getDisplayConfig(),
      backgroundColors: getBackgroundColors(),
      mqttBroker: getMqttSettings().brokerUrl,
      adapters: localSharedAdapterSettings(),
    };
    const payload = sharedSettingsPayload(
      merged,
      applied.appSettings,
      applied.displayConfig,
      applied.backgroundColors,
    );
    const previous = sharedSettingsPayload(
      read.fonts,
      read.appSettings,
      read.displayConfig,
      read.backgroundColors,
    );
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
      applied,
      missing,
      equal: sharedSettingsEqual(previous, payload),
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
  assert.equal(data.read.appSettings.pageNavigation, "next-item");
  assert.deepEqual(data.read.appSettings.churchsuiteEmptyTypes, ["Welcome", "Prayer"]);
  assert.equal(data.read.appSettings.pageIdShortcuts["Verse 1"], "v1");
  assert.equal(data.read.displayConfig.fontFamily, '"Lora", Georgia, serif');
  assert.equal(data.read.displayConfig.maxLines, 6);
  assert.equal(data.read.backgroundColors.primary, "#040506");
  assert.equal(data.applied.appSettings.pageNavigation, "next-item");
  assert.equal(data.applied.displayConfig.maxWords, 70);
  assert.equal(data.applied.backgroundColors.accent, "#0a0b0c");
  assert.equal(data.applied.mqttBroker, "mqtt://shared.example:1883");
  assert.equal(data.applied.adapters.songSelect, true);
  assert.equal(data.applied.adapters.churchSuite, undefined);
  assert.equal(data.applied.adapters.mqtt.incomingPrefix, "team/in");
  assert.equal(data.equal, true);
  assert.deepEqual(
    data.missing.map((font) => font.id),
    ["google-lora"],
  );
});
